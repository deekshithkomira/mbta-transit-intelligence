"""Station-level demand: recovery vs 2019 and time-of-day profiles from fare-gate taps."""
from __future__ import annotations

import json

from mbta_ti import config
from mbta_ti.analysis.common import df, pct, records


def run() -> dict:
    last = df("SELECT max(month) m FROM mart_station_monthly")["m"].iloc[0]
    rec = df(f"""
        WITH recent AS (
            SELECT stop_id, any_value(station) station, any_value(lines) lines,
                   avg(weekday_entries) AS recent
            FROM mart_station_monthly
            WHERE month > DATE '{last:%Y-%m-%d}' - INTERVAL 12 MONTH GROUP BY 1),
        base AS (
            SELECT stop_id, avg(weekday_entries) AS base2019
            FROM mart_station_monthly WHERE year(month) = 2019 GROUP BY 1)
        SELECT r.*, b.base2019, r.recent / b.base2019 AS recovery
        FROM recent r JOIN base b USING (stop_id)
        WHERE b.base2019 > 300 ORDER BY recovery""")
    net = json.loads((config.RAW / "v3_network.json").read_text())
    rec["lat"] = rec["stop_id"].map(lambda s: net["stops"].get(s, {}).get("lat"))
    rec["lon"] = rec["stop_id"].map(lambda s: net["stops"].get(s, {}).get("lon"))

    profile = df("""
        SELECT hour, day_class, sum(avg_entries) AS entries
        FROM mart_station_hourly_profile GROUP BY ALL ORDER BY day_class, hour""")
    trend = df("""SELECT month, sum(weekday_entries) AS weekday_entries
                  FROM mart_station_monthly GROUP BY 1 ORDER BY 1""")
    # A station whose gate taps fell >80% did not lose 80% of riders: its fare
    # collection changed (e.g. Lechmere was rebuilt in 2022 as an ungated Green Line
    # Extension station, so riders pay on board).  Flag rather than rank these.
    rec["fare_collection_changed"] = rec["recovery"] < 0.2
    flagged = rec[rec.fare_collection_changed]
    rec_ok = rec[~rec.fare_collection_changed]
    busiest = rec_ok.sort_values("recent", ascending=False).head(15)
    lo, hi = rec_ok.iloc[0], rec_ok.iloc[-1]
    findings = [
        f"Of {len(rec_ok)} comparable gated stations, the slowest to recover is {lo.station} "
        f"({pct(lo.recovery)} of 2019 weekday taps); the strongest is {hi.station} "
        f"({pct(hi.recovery)}).",
        f"Median recovery across the 15 busiest stations is {pct(busiest.recovery.median())} "
        f"vs {pct(rec_ok.recovery.median())} across all comparable stations.",
        f"Excluded as fare-collection changes, not demand loss: "
        f"{', '.join(flagged.station)}.",
    ]
    return {"recovery": records(rec), "hourly_profile": records(profile),
            "trend": records(trend), "as_of": f"{last:%Y-%m-%d}", "findings": findings}
