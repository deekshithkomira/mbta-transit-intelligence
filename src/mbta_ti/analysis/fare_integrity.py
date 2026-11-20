"""Fare integrity: where evasion exposure concentrates and how to deploy limited
inspection capacity against it.

What this module does NOT claim
-------------------------------
The MBTA does not publish station-level evasion counts, and a fare gate only
records riders who *paid*.  So nothing here "measures" evasion.  Instead it
combines (a) real demand data — 13.7M half-hourly gate-tap records — with
(b) evasion rates published by the MBTA and peer agencies (cited in
``docs/research_evidence.md``) to build *decision tools* whose conclusions are
robust to the unknown parameters.  Each assumption is an explicit argument.

1. Deterrence break-even
   A rider deciding whether to pay faces expected penalty  p * F  (inspection
   probability x fine).  Paying is the cheaper choice when p * F >= fare, so the
   break-even inspection probability is  p* = fare / F.

2. Inspector deployment optimizer  (diminishing-returns water-filling)
   Cells c = station x hour.  Expected evasions deterred with coverage x_c:
       D_c(x_c) = E_c * r * (1 - exp(-k * x_c))
   where E_c = average entries (real data), r = base evasion rate, k =
   deterrence responsiveness.  Maximise sum D_c subject to sum x_c = H
   (inspector-hours) and 0 <= x_c <= 1.  KKT conditions give a closed form:
       x_c = clip( ln(k * E_c * r / lambda) / k , 0, 1 )
   with lambda found by bisection.  Because r multiplies every cell equally,
   the *ranking of strategies is independent of r* — only k matters, and we
   report a sensitivity sweep over k.  We compare against two status-quo
   heuristics: "uniform" (spread evenly) and "busiest-first" (fill the highest-
   volume cells to 100% coverage).  Randomised daily rosters are sampled from the
   optimal marginal coverage, so patrols stay unpredictable (the core idea of
   Stackelberg security games used in transit fare inspection research).

3. Revenue-at-risk scenarios
   unpaid = paid_entries * r / (1 - r)  (gate counts are paid entries only),
   valued at the base subway fare, across a range of published evasion rates.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from mbta_ti.analysis.common import df, pct, records

SUBWAY_FARE = 2.40          # MBTA adult CharlieCard/contactless subway fare, USD
DEFAULT_K = 3.0             # deterrence responsiveness (sensitivity-tested 0.5-10)
MBTA_FINES = (50, 100)      # 1st-3rd citation / 4th+ (MBTA, Aug-2025; docs/research_evidence.md)

# Published evasion rates used as scenario anchors (see docs/research_evidence.md).
EVASION_ANCHORS = (
    (0.030, "Gated benchmark", "3% industry leakage benchmark for gated systems (cited by MBTA, 2026)"),
    (0.035, "London 2025/26", "TfL London, all modes 2025/26"),
    (0.098, "NYC subway Q1-25", "NYC subway, Q1 2025 (NY State Comptroller)"),
    (0.128, "NYC subway 2024", "NYC subway, 2024 (NY State Comptroller)"),
)

# Relative evasion propensity by hour, from the only measured MBTA time-of-day
# profile: MassDOT bus fare-compliance study (2019 data) non-interaction rates
# AM peak 19%, midday 22%, PM peak 22%, evening 28%.  Used as a *shape* only.
def hour_propensity(hour: int) -> float:
    if 6 <= hour < 9:
        return 0.19
    if 9 <= hour < 15:
        return 0.22
    if 15 <= hour < 19:
        return 0.22
    return 0.28


def break_even_curve(fare: float, fines: list[float]) -> list[dict]:
    return [{"fine": f, "break_even_inspection_rate": fare / f} for f in fines]


def optimal_coverage(entries: np.ndarray, hours: float, k: float, r: float = 0.1) -> np.ndarray:
    """Closed-form water-filling solution; see module docstring."""
    e = np.maximum(entries, 1e-9)
    if hours >= len(e):
        return np.ones_like(e)

    def cov(lam: float) -> np.ndarray:
        return np.clip(np.log(k * e * r / lam) / k, 0, 1)

    lo, hi = 1e-12, k * e.max() * r
    for _ in range(200):
        mid = np.sqrt(lo * hi)
        if cov(mid).sum() > hours:
            lo = mid
        else:
            hi = mid
    return cov(hi)


def deterred(entries: np.ndarray, x: np.ndarray, k: float, r: float = 0.1) -> float:
    return float(np.sum(entries * r * (1 - np.exp(-k * x))))


def busiest_first(entries: np.ndarray, hours: float) -> np.ndarray:
    x = np.zeros_like(entries)
    order = np.argsort(-entries)
    full = int(hours)
    x[order[:full]] = 1.0
    if full < len(x):
        x[order[full]] = hours - full
    return x


def sample_roster(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Systematic sampling: integer roster whose inclusion probabilities equal x."""
    cum = np.concatenate([[0], np.cumsum(x)])
    u = rng.uniform()
    picks = np.floor(cum[1:] - u) - np.floor(cum[:-1] - u)
    return picks.astype(int)


def cells() -> pd.DataFrame:
    return df("""
        SELECT p.stop_id, any_value(s.station) AS station, p.hour, p.avg_entries
        FROM mart_station_hourly_profile p
        JOIN (SELECT stop_id, any_value(station) station FROM mart_station_monthly GROUP BY 1) s
          USING (stop_id)
        WHERE p.day_class = 'weekday' AND p.avg_entries > 0
        GROUP BY p.stop_id, p.hour, p.avg_entries""")


def run(fines: tuple[float, ...] = (15, 25, 50, 100, 150, 250)) -> dict:
    c = cells()
    e = c["avg_entries"].to_numpy()
    # time-varying variant: exposure = entries x relative propensity(hour)
    prop = c["hour"].map(hour_propensity).to_numpy()
    e_tv = e * prop / prop.mean()
    budgets = [8, 16, 32, 64, 128]          # simultaneous inspector-hours per weekday
    ks = [0.5, 1, 2, 3, 5, 10]
    sweep = []
    for k in ks:
        for h in budgets:
            opt = optimal_coverage(e, h, k)
            uni = np.full_like(e, h / len(e))
            bus = busiest_first(e, h)
            d_opt, d_uni, d_bus = (deterred(e, x, k) for x in (opt, uni, bus))
            sweep.append({"k": k, "inspector_hours": h,
                          "gain_vs_uniform": d_opt / d_uni - 1,
                          "gain_vs_busiest": d_opt / d_bus - 1,
                          "cells_covered": int((opt > 0.01).sum())})

    h_ref = 32
    x = optimal_coverage(e, h_ref, DEFAULT_K)
    c["coverage"] = x
    rng = np.random.default_rng(2026)
    c["roster_example"] = sample_roster(x, rng)
    by_station = (c.groupby("station")
                  .agg(inspector_hours=("coverage", "sum"),
                       weekday_entries=("avg_entries", "sum"))
                  .reset_index().sort_values("inspector_hours", ascending=False))
    by_hour = c.groupby("hour")["coverage"].sum().reset_index()

    annual = df("""SELECT year(service_date) y, sum(entries) entries FROM stg_gated_entries
                   WHERE year(service_date) = (SELECT max(year(service_date)) - 1
                                               FROM stg_gated_entries) GROUP BY 1""")
    paid = float(annual["entries"].iloc[0])
    year = int(annual["y"].iloc[0])
    scenarios = [{"evasion_rate": r, "short": short, "anchor": label,
                  "unpaid_entries": paid * r / (1 - r),
                  "revenue_at_risk_usd": paid * r / (1 - r) * SUBWAY_FARE}
                 for r, short, label in EVASION_ANCHORS]

    # Does ignoring the time-of-day pattern cost anything?  Compare the volume-only
    # optimum against the propensity-aware optimum, both scored on e_tv.
    x_vol = optimal_coverage(e, h_ref, DEFAULT_K)
    x_tv = optimal_coverage(e_tv, h_ref, DEFAULT_K)
    tv_gain = deterred(e_tv, x_tv, DEFAULT_K) / deterred(e_tv, x_vol, DEFAULT_K) - 1
    weekday_taps = float(e.sum())
    checks_needed = weekday_taps * SUBWAY_FARE / MBTA_FINES[0]

    ref = next(s for s in sweep if s["k"] == DEFAULT_K and s["inspector_hours"] == h_ref)
    gains_uni = [s["gain_vs_uniform"] for s in sweep]
    gains_bus = [s["gain_vs_busiest"] for s in sweep]
    late = c[(c.hour >= 21) | (c.hour < 5)]["avg_entries"].sum() / e.sum()
    findings = [
        f"Optimised, randomised deployment of {h_ref} inspector-hours deters "
        f"{pct(ref['gain_vs_uniform'], 0)} more evasion than an even spread and "
        f"{pct(ref['gain_vs_busiest'], 0)} more than busiest-station-first (k={DEFAULT_K}); "
        f"across all {len(sweep)} sensitivity cases the gain ranges "
        f"{pct(min(gains_uni), 0)}–{pct(max(gains_uni), 0)} vs uniform and "
        f"{pct(min(gains_bus), 0)}–{pct(max(gains_bus), 0)} vs busiest-first.",
        f"At the ${SUBWAY_FARE:.2f} fare, the MBTA's ${MBTA_FINES[0]} citation deters a rational "
        f"evader only if at least {pct(SUBWAY_FARE / MBTA_FINES[0])} of trips are checked — "
        f"about {checks_needed:,.0f} checks every weekday at gated stations alone. For scale, "
        f"the MBTA reported 88 warnings and 0 citations for all of 2025.",
        f"Weighting exposure by the measured MBTA time-of-day evasion profile (evening 28% vs "
        f"AM peak 19%) changes the optimal plan only marginally (+{pct(tv_gain)}), so "
        f"volume-based targeting is robust to the time-of-day pattern.",
        f"{year} gated entries ({paid / 1e6:,.1f}M paid taps) imply between "
        f"${scenarios[0]['revenue_at_risk_usd'] / 1e6:,.1f}M and "
        f"${scenarios[-1]['revenue_at_risk_usd'] / 1e6:,.1f}M a year of subway fare at risk "
        f"if MBTA subway evasion sat anywhere between the 3% gated-system benchmark and New "
        f"York's 2024 subway rate of 12.8% (scenario, not measurement).",
        f"{pct(late)} of weekday gate entries happen 9pm–5am, when stations are least staffed.",
    ]
    return {
        "time_varying_gain": tv_gain,
        "weekday_gated_taps": weekday_taps,
        "checks_needed_per_weekday": checks_needed,
        "assumptions": {"subway_fare": SUBWAY_FARE, "default_k": DEFAULT_K,
                        "mbta_fines": MBTA_FINES,
                        "reference_inspector_hours": h_ref,
                        "deterrence_model": "D = E*r*(1-exp(-k*x))"},
        "sensitivity": sweep,
        "coverage_by_station": records(by_station.head(25)),
        "coverage_by_hour": records(by_hour),
        # station x hour demand cells, so the dashboard can re-solve interactively
        "cells": records(c[["station", "hour", "avg_entries"]], round_to=1),
        "break_even": break_even_curve(SUBWAY_FARE, list(fines)),
        "revenue_scenarios": scenarios,
        "scenario_year": year,
        "paid_entries": paid,
        "findings": findings,
    }
