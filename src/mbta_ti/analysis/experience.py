"""Rider experience beyond on-time: accessibility outages, prediction trust, crowding,
satisfaction, and fare equity (2025 System-Wide Passenger Survey)."""
from __future__ import annotations

import re

from mbta_ti.analysis.common import df, pct, records


def _station(header: str) -> str:
    m = re.match(r"^(.*?)\s+(Elevator|Escalator)\b", header or "")
    return m.group(1).strip() if m else "Unknown"


def accessibility() -> dict:
    out = df("SELECT * FROM mart_accessibility_outages WHERE asset <> 'Other'")
    out["station"] = out["header"].map(_station)
    by_station = (out.groupby(["station", "asset"])
                  .agg(outages=("alert_id", "count"), hours=("hours_out", "sum"))
                  .reset_index().sort_values("hours", ascending=False))
    totals = out.groupby("asset").agg(outages=("alert_id", "count"),
                                      median_hours=("hours_out", "median"),
                                      total_hours=("hours_out", "sum")).reset_index()
    monthly = (out.assign(month=out["start_ts"].dt.to_period("M").dt.to_timestamp())
               .groupby(["month", "asset"]).size().rename("outages").reset_index())
    return {"by_station": records(by_station.head(25)), "totals": records(totals),
            "monthly": records(monthly)}


def predictions() -> dict:
    p = df("""SELECT week, mode, bin,
                     sum(num_accurate_predictions)/sum(num_predictions) AS accuracy
              FROM stg_prediction_accuracy GROUP BY ALL ORDER BY week""")
    yearly = df("""SELECT year(week) AS year, mode,
                          sum(num_accurate_predictions)/sum(num_predictions) AS accuracy
                   FROM stg_prediction_accuracy GROUP BY ALL ORDER BY 1, 2""")
    return {"weekly": records(p), "yearly": records(yearly)}


def crowding() -> dict:
    c = df("""SELECT season, year, mode,
                     sum(sdp_uncomfortable_minutes_total)/sum(passenger_minutes_total)
                         AS uncomfortable_share
              FROM stg_comfort WHERE day_type = 'Weekday' GROUP BY ALL ORDER BY year, season""")
    worst = df("""SELECT mode, route_id,
                         sum(sdp_uncomfortable_minutes_total)/sum(passenger_minutes_total) AS share
                  FROM stg_comfort
                  WHERE day_type='Weekday' AND year = (SELECT max(year) FROM stg_comfort)
                  GROUP BY ALL ORDER BY share DESC LIMIT 15""")
    return {"by_season": records(c), "worst_routes": records(worst)}


def satisfaction() -> dict:
    s = df("""SELECT survey_date, question, satisfied_share, n FROM stg_satisfaction
              ORDER BY survey_date""")
    return {"series": records(s)}


def fare_equity() -> dict:
    """Low-income riders vs reduced-fare uptake, by mode — an affordability gap that the
    fare-evasion literature links to evasion (see docs/research_evidence.md)."""
    sv = df("""
        SELECT aggregation_level, service_mode, reporting_group, measure, category,
               weighted_percent AS share, n, margin_of_error AS moe
        FROM stg_passenger_survey
        WHERE measure IN ('Title VI Low-Income', 'Reduced Fares', 'Fare Product', 'Smartphone')
          AND aggregation_level IN ('Systemwide', 'Service Mode')""")
    sys_ = sv[sv.aggregation_level == "Systemwide"]

    def share(frame, measure, cat):
        r = frame[(frame.measure == measure) & (frame.category == cat)]
        return float(r.share.iloc[0]) if len(r) else None

    low_income = share(sys_, "Title VI Low-Income", "Yes")
    full_fare = share(sys_, "Reduced Fares", "Full Fare")
    reduced = sys_[(sys_.measure == "Reduced Fares")
                   & ~sys_.category.isin(["Full Fare", "Full Fare - Subsidized by Employer",
                                          "Did not answer"])]["share"].sum()
    modes = []
    for mode, g in sv[sv.aggregation_level == "Service Mode"].groupby("service_mode"):
        modes.append({"mode": mode,
                      "low_income": share(g, "Title VI Low-Income", "Yes"),
                      "full_fare": share(g, "Reduced Fares", "Full Fare"),
                      "pay_as_you_go": share(g, "Fare Product", "Pay-as-you-go"),
                      "no_smartphone": share(g, "Smartphone", "No")})
    return {"systemwide": {"low_income": low_income, "full_fare": full_fare,
                           "any_reduced_fare": reduced,
                           "n": int(sys_[sys_.measure == "Title VI Low-Income"].n.iloc[0])},
            "by_mode": modes, "rows": records(sv)}


def run() -> dict:
    acc, pred, crowd, sat, eq = accessibility(), predictions(), crowding(), satisfaction(), \
        fare_equity()
    tot = {r["asset"]: r for r in acc["totals"]}
    se = eq["systemwide"]
    findings = [
        f"In 2025 the MBTA posted {tot['Elevator']['outages']:,} elevator outage alerts and "
        f"{tot['Escalator']['outages']:,} escalator outage alerts — "
        f"{tot['Elevator']['total_hours']:,.0f} elevator-hours unavailable.",
        f"2025 passenger survey: {pct(se['low_income'])} of riders meet the MBTA Title VI "
        f"low-income definition, yet only {pct(se['any_reduced_fare'])} ride on any reduced "
        f"fare and {pct(se['full_fare'])} pay full fare out of pocket (n={se['n']:,}).",
    ]
    return {"accessibility": acc, "predictions": pred, "crowding": crowd,
            "satisfaction": sat, "fare_equity": eq, "findings": findings}
