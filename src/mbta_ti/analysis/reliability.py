"""Bus and Commuter Rail reliability, with empirical-Bayes route rankings.

Why shrinkage?  A route observed 40 times with 50% on-time is not credibly
"worse" than one observed 40,000 times at 55%.  We fit a Beta(a, b) prior to
all routes' on-time proportions by method of moments, then rank routes by the
posterior mean (on_time + a) / (observed + a + b), and report a 90% credible
interval from the Beta posterior.  This is the same idea used in baseball
batting-average ranking and in hospital quality league tables.

Methodology break: MBTA moved to an "adjusted" bus OTP definition in Aug-2025.
The route ranking uses only the trailing 12 months, all on one definition.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from mbta_ti.analysis.common import df, pct, records


def beta_prior(on_time: np.ndarray, observed: np.ndarray) -> tuple[float, float]:
    p = on_time / observed
    w = observed / observed.sum()
    mean = float(np.sum(w * p))
    var = float(np.sum(w * (p - mean) ** 2))
    # method-of-moments; guard against a degenerate variance
    common = max(mean * (1 - mean) / max(var, 1e-6) - 1, 1.0)
    return mean * common, (1 - mean) * common


def shrink(frame: pd.DataFrame) -> pd.DataFrame:
    a, b = beta_prior(frame["on_time"].to_numpy(), frame["observed"].to_numpy())
    post_a = frame["on_time"] + a
    post_b = frame["observed"] - frame["on_time"] + b
    out = frame.copy()
    out["raw_otp"] = frame["on_time"] / frame["observed"]
    out["eb_otp"] = post_a / (post_a + post_b)
    out["ci_lo"] = stats.beta.ppf(0.05, post_a, post_b)
    out["ci_hi"] = stats.beta.ppf(0.95, post_a, post_b)
    return out


def run() -> dict:
    last = df("SELECT max(month) m FROM mart_bus_otp_monthly")["m"].iloc[0]
    routes = df(f"""
        SELECT route_id, any_value(route_class) AS route_class,
               sum(on_time) AS on_time, sum(observed) AS observed
        FROM mart_bus_otp_monthly
        WHERE month > DATE '{last:%Y-%m-%d}' - INTERVAL 12 MONTH
        GROUP BY route_id HAVING sum(observed) >= 500""")
    ranked = shrink(routes).sort_values("eb_otp")

    bus_trend = df("""
        SELECT month, sum(on_time)/sum(observed) AS otp, bool_or(adjusted_method) AS adjusted
        FROM mart_bus_otp_monthly GROUP BY month ORDER BY month""")
    key = df(f"""
        SELECT route_class, sum(on_time)/sum(observed) AS otp, count(DISTINCT route_id) AS routes
        FROM mart_bus_otp_monthly
        WHERE month > DATE '{last:%Y-%m-%d}' - INTERVAL 12 MONTH GROUP BY 1 ORDER BY 2""")
    cr = df("""SELECT month, line, otp, cancelled FROM mart_cr_otp_monthly ORDER BY month""")
    cr_sys = df("""SELECT month, sum(on_time)/sum(observed) AS otp
                   FROM mart_cr_otp_monthly GROUP BY 1 ORDER BY 1""")
    cr_last = cr["month"].max()
    cr_lines = df(f"""
        SELECT line, sum(on_time)/sum(observed) AS otp, sum(cancelled) AS cancelled
        FROM mart_cr_otp_monthly WHERE month > DATE '{cr_last:%Y-%m-%d}' - INTERVAL 12 MONTH
        GROUP BY 1 ORDER BY 2""")

    worst = ranked.head(10)
    findings = [
        f"Trailing-12-month bus on-time performance: worst route after Bayesian shrinkage is "
        f"route {worst.iloc[0].route_id} at {pct(worst.iloc[0].eb_otp)} "
        f"(90% CI {pct(worst.iloc[0].ci_lo)}–{pct(worst.iloc[0].ci_hi)}).",
        f"Least reliable Commuter Rail line over the last 12 months: {cr_lines.iloc[0].line} "
        f"at {pct(cr_lines.iloc[0].otp)} on time.",
    ]
    return {
        "bus_routes_ranked": records(ranked),
        "bus_trend": records(bus_trend),
        "bus_by_class": records(key),
        "cr_trend": records(cr_sys),
        "cr_lines": records(cr_lines),
        "cr_by_line": records(cr),
        "as_of": f"{last:%Y-%m-%d}",
        "findings": findings,
    }
