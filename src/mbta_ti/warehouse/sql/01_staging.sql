-- ============================================================================
-- STAGING: one typed, cleaned view per raw source.  No business logic here.
-- {raw} is substituted with the absolute raw-data directory at build time.
-- ============================================================================

-- Some MBTA files mix ISO dates with M/D/YY or M/D/YYYY in the same column.
CREATE OR REPLACE MACRO flex_date(s) AS CASE
    -- a 2-digit year must be parsed with %y, or '1/15/25' silently becomes year 0025
    WHEN regexp_matches(s, '^\d{1,2}/\d{1,2}/\d{2}$')
        THEN TRY_CAST(TRY_STRPTIME(s, '%m/%d/%y') AS DATE)
    WHEN regexp_matches(s, '^\d{1,2}/\d{1,2}/\d{4}$')
        THEN TRY_CAST(TRY_STRPTIME(s, '%m/%d/%Y') AS DATE)
    ELSE TRY_CAST(s AS DATE) END;

CREATE OR REPLACE TABLE stg_monthly_ridership AS
SELECT
    CAST(make_timestamp(month_of_service * 1000) AT TIME ZONE 'America/New_York' AS DATE)
        AS month,
    route_or_line,
    daytype                       AS day_type,
    daycount                      AS day_count,
    CAST(ridership_total AS DOUBLE)   AS ridership_total,
    CAST(ridership_average AS DOUBLE) AS ridership_avg
FROM read_parquet('{raw}/monthly_ridership.parquet');

-- Gated station entries: half-hourly taps at fare gates, 2014 -> present.
-- Schemas differ slightly by year (column order), so union_by_name.
CREATE OR REPLACE TABLE stg_gated_entries AS
SELECT
    CAST(service_date AS DATE)                         AS service_date,
    CAST(regexp_extract(time_period, '(\d\d):(\d\d)', 1) AS INT) AS hour,
    stop_id,
    station_name,
    route_or_line,
    -- 30 rows (all 2023, sum = -21) carry small negative gate corrections; floor at 0.
    greatest(TRY_CAST(gated_entries AS DOUBLE), 0)     AS entries
FROM read_csv('{raw}/gse_by_year/GSE_by_year/GSE_*.csv', union_by_name = true,
              all_varchar = true)
WHERE TRY_CAST(gated_entries AS DOUBLE) IS NOT NULL;

-- Bus on-time performance.  MBTA switched to an "adjusted" methodology in
-- Aug-2025; we keep the flag so trend breaks are never silently mixed.
CREATE OR REPLACE TABLE stg_bus_otp AS
SELECT
    CAST(service_date AS DATE)  AS service_date,
    gtfs_route_id               AS route_id,
    gtfs_route_desc             AS route_class,
    peak_offpeak_ind            AS peak,
    metric_type ILIKE '%adjusted%' AS adjusted_method,
    TRY_CAST(otp_numerator AS DOUBLE)   AS on_time,
    TRY_CAST(otp_denominator AS DOUBLE) AS observed,
    TRY_CAST(cancelled_numerator AS DOUBLE) AS cancelled
FROM read_csv('{raw}/bus_reliability.csv', all_varchar = true, nullstr = 'NA');

CREATE OR REPLACE TABLE stg_cr_otp AS
SELECT
    flex_date(service_date) AS service_date,
    gtfs_route_id               AS route_id,
    gtfs_route_long_name        AS line,
    peak_offpeak_ind            AS peak,
    TRY_CAST(otp_numerator AS DOUBLE)   AS on_time,
    TRY_CAST(otp_denominator AS DOUBLE) AS observed,
    TRY_CAST(cancelled_numerator AS DOUBLE) AS cancelled
FROM read_csv('{raw}/cr_reliability.csv', all_varchar = true, nullstr = 'NA');

-- Speed restrictions ("slow zones"): one row per restriction per active day.
CREATE OR REPLACE TABLE stg_speed_restrictions AS
SELECT
    flex_date(Calendar_Date)               AS calendar_date,
    ID                                     AS restriction_id,
    Line                                   AS line,
    Branch                                 AS branch,
    Track_Direction                        AS direction,
    Location_Description                   AS location,
    Loc_GTFS_Stop_ID                       AS stop_ids,
    Restriction_Reason                     AS reason,
    TRY_CAST(regexp_extract(Restriction_Speed_MPH, '(\d+)', 1) AS INT) AS speed_mph,
    TRY_CAST(Restriction_Distance_Miles AS DOUBLE) AS miles,
    TRY_CAST(Line_Total_Track_Miles AS DOUBLE)     AS line_track_miles,
    flex_date(Date_Restriction_Reported)    AS reported_date,
    flex_date(Date_Restriction_Cleared)     AS cleared_date
FROM read_csv('{raw}/speed_restrictions/*.csv', union_by_name = true, all_varchar = true);

-- Heavy-rail excess trip time.  Per the MBTA data dictionary the weighted_*
-- columns are TOTAL passenger-MINUTES (divide by est_pax for per-rider), and the
-- *_thresh columns count riders who arrived WITHIN the threshold of baseline.
CREATE OR REPLACE TABLE stg_excess_trip_time AS
SELECT
    CAST(svc_date AS DATE) AS service_date,
    day                    AS day_type,
    hour(CAST(halfhour AS TIME)) AS hour,
    peak,
    route_id               AS line,
    dir_id                 AS direction,
    est_pax                AS riders,
    weighted_trip_time     AS trip_pax_min,
    weighted_bl_trip_time  AS baseline_trip_pax_min,
    weighted_wait_time     AS wait_pax_min,
    weighted_bl_wait_time  AS baseline_wait_pax_min,
    five_min_thresh        AS riders_within_5min,
    twenty_min_thresh      AS riders_within_20min
FROM read_csv('{raw}/excess_trip_time.csv');

CREATE OR REPLACE TABLE stg_prediction_accuracy AS
SELECT
    CAST(weekly AS DATE) AS week,
    mode,
    NULLIF(NULLIF(route_id, 'NA'), 'None') AS route_id,
    bin,
    num_predictions,
    num_accurate_predictions
FROM read_csv('{raw}/prediction_accuracy.csv', all_varchar = false);

-- Alerts: the raw file repeats an alert once per affected route/stop; we
-- collapse to one row per alert *version* and keep the affected-entity lists.
CREATE OR REPLACE TABLE stg_alerts AS
SELECT
    alert_id,
    any_value(cause)        AS cause,
    any_value(effect)       AS effect,
    any_value(severity)     AS severity,
    any_value(header)       AS header,
    min(TRY_CAST(active_period_start_dt AS TIMESTAMP)) AS start_ts,
    -- Unplanned outages (e.g. a broken elevator) carry no scheduled end; the
    -- real end is when the alert was closed, else its last modification.
    coalesce(max(TRY_CAST(active_period_end_dt AS TIMESTAMP)),
             max(TRY_CAST(closed_dt AS TIMESTAMP)),
             max(TRY_CAST(last_modified_dt AS TIMESTAMP))) AS end_ts,
    max(TRY_CAST(active_period_end_dt AS TIMESTAMP)) IS NULL AS unplanned_end,
    min(TRY_CAST(created_dt AS TIMESTAMP))             AS created_ts,
    list_distinct(list(route_id))                      AS routes,
    list_distinct(list(TRY_CAST(route_type AS INT)))   AS route_types,
    count(DISTINCT stop_id)                            AS n_stops
FROM read_csv('{raw}/alerts_2025/Alerts_2025/*.csv', union_by_name = true,
              all_varchar = true)
GROUP BY alert_id;

CREATE OR REPLACE TABLE stg_comfort AS
SELECT season,
       CAST(regexp_extract(season, '(\d{4})', 1) AS INT) AS year,
       sdp_mode AS mode, route_id, day_type,
       passenger_minutes_total, sdp_uncomfortable_minutes_total, crowding
FROM read_csv('{raw}/sdp_comfort.csv');

CREATE OR REPLACE TABLE stg_passenger_survey AS
SELECT * FROM read_parquet('{raw}/passenger_survey_2025.parquet');

CREATE OR REPLACE TABLE stg_satisfaction AS
SELECT flex_date(CAST(survey_date AS VARCHAR)) AS survey_date,
       question_description AS question, response_total AS n,
       -- top-3 box = Somewhat / Very / Extremely satisfied
       coalesce(response_5_percent,0)+coalesce(response_6_percent,0)
         +coalesce(response_7_percent,0) AS satisfied_share
FROM read_csv('{raw}/customer_satisfaction.csv', nullstr = 'NA');
