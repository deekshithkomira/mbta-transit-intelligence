-- ============================================================================
-- MARTS: analysis-ready, documented grain.  Every mart states its grain.
-- ============================================================================

-- grain: month x line   (average weekday ridership, the planning standard)
CREATE OR REPLACE TABLE mart_ridership_monthly AS
WITH base AS (
    SELECT month, route_or_line AS line, ridership_avg AS weekday_riders
    FROM stg_monthly_ridership WHERE day_type = 'Weekday'
),
baseline AS (   -- same calendar month in 2019 = pre-pandemic baseline
    SELECT line, month(month) AS m, weekday_riders AS riders_2019
    FROM base WHERE year(month) = 2019
)
SELECT b.month, b.line, b.weekday_riders, bl.riders_2019,
       b.weekday_riders / NULLIF(bl.riders_2019, 0) AS recovery_vs_2019
FROM base b LEFT JOIN baseline bl ON b.line = bl.line AND month(b.month) = bl.m;

-- grain: station x month   (weekday-average gated entries)
CREATE OR REPLACE TABLE mart_station_monthly AS
WITH daily AS (
    SELECT service_date, stop_id, any_value(station_name) AS station,
           string_agg(DISTINCT route_or_line, ' / ') AS lines, sum(entries) AS entries
    FROM stg_gated_entries GROUP BY ALL
)
SELECT date_trunc('month', service_date)::DATE AS month, stop_id,
       any_value(station) AS station, any_value(lines) AS lines,
       avg(entries) FILTER (WHERE dayofweek(service_date) BETWEEN 1 AND 5) AS weekday_entries,
       sum(entries) AS total_entries
FROM daily GROUP BY ALL;

-- grain: station x hour-of-day x day-class, trailing 12 months
CREATE OR REPLACE TABLE mart_station_hourly_profile AS
WITH recent AS (
    SELECT * FROM stg_gated_entries
    WHERE service_date > (SELECT max(service_date) FROM stg_gated_entries) - INTERVAL 365 DAY
),
d AS (
    SELECT service_date, stop_id, hour,
           CASE WHEN dayofweek(service_date) IN (0, 6) THEN 'weekend' ELSE 'weekday' END
               AS day_class,
           sum(entries) AS entries
    FROM recent GROUP BY ALL
)
SELECT stop_id, hour, day_class, avg(entries) AS avg_entries
FROM d GROUP BY ALL;

-- grain: day x line   (restricted track-miles, count of active slow zones)
CREATE OR REPLACE TABLE mart_slow_zones_daily AS
WITH cal AS (
    SELECT CAST(d AS DATE) AS calendar_date, l.line
    FROM range(DATE '2023-01-01', (SELECT max(calendar_date) + 1 FROM stg_speed_restrictions),
               INTERVAL 1 DAY) t(d)
    CROSS JOIN (SELECT DISTINCT line FROM stg_speed_restrictions) l
),
agg AS (
    SELECT calendar_date, line, count(DISTINCT restriction_id) AS active_zones,
           sum(miles) AS restricted_miles, max(line_track_miles) AS line_track_miles
    FROM stg_speed_restrictions GROUP BY ALL
)
-- Absence of a row means zero restrictions that day (the source only lists
-- active restrictions), so the calendar spine fills with 0, not NULL.
SELECT c.calendar_date, c.line,
       coalesce(a.active_zones, 0)     AS active_zones,
       coalesce(a.restricted_miles, 0) AS restricted_miles,
       max(a.line_track_miles) OVER (PARTITION BY c.line) AS line_track_miles
FROM cal c LEFT JOIN agg a USING (calendar_date, line);

-- grain: restriction   (lifetime of each slow zone, for survival analysis)
CREATE OR REPLACE TABLE mart_slow_zone_lifetimes AS
SELECT restriction_id, any_value(line) AS line, any_value(reason) AS reason,
       min(coalesce(reported_date, calendar_date)) AS opened,
       max(cleared_date)                           AS cleared,
       max(calendar_date)                          AS last_seen,
       max(miles)                                  AS miles,
       min(speed_mph)                              AS min_speed_mph
FROM stg_speed_restrictions GROUP BY restriction_id;

-- grain: month x line   (rider-hours lost to delay on heavy rail)
CREATE OR REPLACE TABLE mart_excess_time_monthly AS
SELECT date_trunc('month', service_date)::DATE AS month, line,
       sum(riders)                                   AS riders,
       sum(trip_pax_min - baseline_trip_pax_min) / 60.0  AS excess_rider_hours,
       sum(trip_pax_min - baseline_trip_pax_min) / NULLIF(sum(riders), 0)
                                                         AS excess_min_per_rider,
       1 - sum(riders_within_5min) / NULLIF(sum(riders), 0) AS share_5min_late
FROM stg_excess_trip_time GROUP BY ALL;

-- grain: month x route   (bus on-time performance, methodology-flagged)
CREATE OR REPLACE TABLE mart_bus_otp_monthly AS
SELECT date_trunc('month', service_date)::DATE AS month, route_id,
       any_value(route_class) AS route_class, bool_or(adjusted_method) AS adjusted_method,
       sum(on_time) AS on_time, sum(observed) AS observed,
       sum(on_time) / NULLIF(sum(observed), 0) AS otp
FROM stg_bus_otp WHERE observed > 0 GROUP BY ALL;

-- grain: month x commuter-rail route.  The long-name field has service-pattern
-- variants ("Franklin via Fairmount Line"); route_id is the stable key.
CREATE OR REPLACE TABLE mart_cr_otp_monthly AS
WITH names AS (
    SELECT route_id, mode(line) AS line FROM stg_cr_otp
    WHERE line NOT ILIKE '% via %' GROUP BY route_id
)
SELECT date_trunc('month', o.service_date)::DATE AS month, o.route_id,
       coalesce(n.line, o.route_id) AS line,
       sum(on_time) AS on_time, sum(observed) AS observed,
       sum(on_time) / NULLIF(sum(observed), 0) AS otp,
       sum(cancelled) AS cancelled
FROM stg_cr_otp o LEFT JOIN names n USING (route_id)
WHERE observed > 0 GROUP BY ALL;

-- grain: alert   (elevator / escalator outages = accessibility failures)
CREATE OR REPLACE TABLE mart_accessibility_outages AS
SELECT alert_id, header, start_ts, end_ts,
       date_diff('minute', start_ts, end_ts) / 60.0 AS hours_out,
       CASE WHEN header ILIKE '%escalator%' THEN 'Escalator'
            WHEN header ILIKE '%elevator%'  THEN 'Elevator' ELSE 'Other' END AS asset
FROM stg_alerts
WHERE effect = 'ACCESSIBILITY_ISSUE' AND start_ts IS NOT NULL AND end_ts IS NOT NULL
  AND end_ts > start_ts;
