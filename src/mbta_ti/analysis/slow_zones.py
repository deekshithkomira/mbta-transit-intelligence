"""Slow zones: how much track was restricted, how fast it was fixed, and what it cost riders.

* Kaplan-Meier survival curves of "days until a speed restriction is cleared",
  by line, treating still-active restrictions as right-censored.
* Rider impact: monthly excess minutes per heavy-rail rider regressed on the
  share of that line's track under restriction, with line fixed effects and
  HC1-robust errors.  This is an association, not a causal estimate; it controls
  for stable line differences but not for other time-varying shocks.
"""
from __future__ import annotations

import pandas as pd
import statsmodels.formula.api as smf
from lifelines import KaplanMeierFitter

from mbta_ti.analysis.common import df, pct, records

HEAVY = {"Red Line": "Red", "Orange Line": "Orange", "Blue Line": "Blue"}


def survival() -> tuple[list[dict], pd.DataFrame]:
    life = df("SELECT * FROM mart_slow_zone_lifetimes")
    data_end = df("SELECT max(calendar_date) d FROM stg_speed_restrictions")["d"].iloc[0]
    life["end"] = life["cleared"].fillna(pd.NaT)
    life["event"] = life["cleared"].notna()
    # Censor still-open restrictions at the end of the data window.
    life["end"] = pd.to_datetime(life["end"]).fillna(pd.Timestamp(data_end))
    life["days"] = (life["end"] - pd.to_datetime(life["opened"])).dt.days.clip(lower=1)
    curves, medians = [], []
    for line, g in life.groupby("line"):
        km = KaplanMeierFitter().fit(g["days"], g["event"])
        sf = km.survival_function_.reset_index()
        sf.columns = ["days", "survival"]
        sf = sf[sf["days"] <= 730]
        curves.append({"line": line, "points": records(sf)})
        medians.append({"line": line, "n": len(g), "median_days": km.median_survival_time_,
                        "open_now": int((~g["event"]).sum())})
    return curves, pd.DataFrame(medians)


def impact() -> tuple[dict, pd.DataFrame]:
    sz = df("""SELECT date_trunc('month', calendar_date)::DATE AS month, line,
                      avg(restricted_miles / line_track_miles) AS restricted_share
               FROM mart_slow_zones_daily GROUP BY ALL""")
    sz["line"] = sz["line"].map(HEAVY)
    et = df("SELECT month, line, excess_min_per_rider FROM mart_excess_time_monthly")
    panel = sz.dropna().merge(et, on=["month", "line"])
    panel["restricted_pct"] = panel["restricted_share"] * 100
    fit = smf.ols("excess_min_per_rider ~ restricted_pct + C(line)", data=panel).fit(
        cov_type="HC1")
    coef = fit.params["restricted_pct"]
    lo, hi = fit.conf_int().loc["restricted_pct"]
    return ({"coef_min_per_pct": coef, "ci_lo": lo, "ci_hi": hi,
             "p_value": fit.pvalues["restricted_pct"], "r2": fit.rsquared,
             "n_obs": int(fit.nobs)}, panel)


def run() -> dict:
    daily = df("""SELECT calendar_date, line, restricted_miles, active_zones,
                         restricted_miles / line_track_miles AS restricted_share
                  FROM mart_slow_zones_daily ORDER BY calendar_date""")
    system = df("""SELECT calendar_date, sum(restricted_miles) AS miles,
                          sum(active_zones) AS zones FROM mart_slow_zones_daily
                   GROUP BY 1 ORDER BY 1""")
    peak = system.loc[system["miles"].idxmax()]
    latest = system.iloc[-1]
    reasons = df("""SELECT coalesce(reason,'Unspecified') AS reason, count(*) AS n
                    FROM mart_slow_zone_lifetimes GROUP BY 1 ORDER BY 2 DESC""")
    current = df("""
        SELECT restriction_id, line, branch, location, stop_ids, speed_mph, miles, reason
        FROM stg_speed_restrictions
        WHERE calendar_date = (SELECT max(calendar_date) FROM stg_speed_restrictions)""")
    all_zones = df("""
        SELECT restriction_id, any_value(line) line, any_value(stop_ids) stop_ids,
               max(miles) miles, min(calendar_date) first_day, max(calendar_date) last_day
        FROM stg_speed_restrictions GROUP BY 1""")
    curves, medians = survival()
    reg, panel = impact()
    delay = df("""SELECT month, line, excess_rider_hours, excess_min_per_rider, share_5min_late
                  FROM mart_excess_time_monthly ORDER BY month""")
    yearly = df("""SELECT year(month) AS year, sum(excess_rider_hours) AS rider_hours
                   FROM mart_excess_time_monthly GROUP BY 1 ORDER BY 1""")
    y = yearly.set_index("year")["rider_hours"]

    findings = [
        f"Slow zones peaked on {peak.calendar_date:%d %b %Y} at {peak.miles:.1f} restricted "
        f"track-miles across {int(peak.zones)} restrictions; on {latest.calendar_date:%d %b %Y} "
        f"there were {latest.miles:.2f} miles ({int(latest.zones)} restrictions).",
        f"Heavy-rail riders lost {y.get(2023, 0):,.0f} rider-hours to excess trip time in 2023 "
        f"vs {y.get(2025, 0):,.0f} in 2025 — a {pct(1 - y.get(2025, 0) / y.get(2023, 1), 0)} "
        f"reduction.",
        f"Each extra 1% of a line's track under restriction is associated with "
        f"+{reg['coef_min_per_pct']:.3f} excess minutes per rider-trip "
        f"(95% CI {reg['ci_lo']:.3f}–{reg['ci_hi']:.3f}, line fixed effects, "
        f"n={reg['n_obs']} line-months).",
    ]
    return {
        "system_daily": records(system),
        "by_line_daily": records(daily),
        "reasons": records(reasons),
        "current": records(current),
        "zones": records(all_zones),
        "survival": curves,
        "survival_medians": records(medians),
        "regression": reg,
        "regression_panel": records(panel),
        "delay_monthly": records(delay),
        "delay_yearly": records(yearly),
        "findings": findings,
    }
