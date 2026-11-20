"""Ridership recovery and a backtested 12-month forecast.

Forecasting design
------------------
* Target: system-wide average weekday unlinked trips (bus + heavy rail + light
  rail + commuter rail + ferry), monthly.
* Training window starts 2022-01 so the model learns the post-pandemic regime,
  not the 2020 collapse.
* Three candidate models are compared with a rolling-origin backtest
  (12 origins, 1-to-6-month horizons): seasonal-naive, Holt-Winters additive
  (damped trend) and SARIMA(1,0,0)(0,1,1,12) with drift.  The winner by MAPE produces the
  published forecast, with 80% prediction intervals from the residual spread.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX

from mbta_ti.analysis.common import df, pct, records

MODES = ("All Bus", "Heavy Rail", "Light Rail", "Commuter Rail", "Ferry")
LINES = ("Red Line", "Orange Line", "Blue Line", "Green Line", "Silver Line", "Bus",
         "Commuter Rail", "Ferry")


def system_series() -> pd.Series:
    frame = df(f"""
        SELECT month, sum(weekday_riders) AS riders FROM mart_ridership_monthly
        WHERE line IN {MODES} GROUP BY month
        HAVING count(*) = {len(MODES)}  -- only months where every mode reported
        ORDER BY month""")
    s = frame.set_index(pd.to_datetime(frame["month"]))["riders"].asfreq("MS")
    # A month where one mode failed to report becomes a gap; interpolate it so
    # the seasonal models see a regular monthly index.
    return s.interpolate(limit=2)


def _fit_predict(name: str, train: pd.Series, h: int) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if name == "seasonal_naive":
            return np.array([train.iloc[-12 + (i % 12)] for i in range(h)])
        if name == "holt_winters":
            m = ExponentialSmoothing(train, trend="add", damped_trend=True,
                                     seasonal="add", seasonal_periods=12).fit()
            return m.forecast(h).to_numpy()
        if name == "sarima":
            m = SARIMAX(train, order=(1, 0, 0), seasonal_order=(0, 1, 1, 12),
                        trend="c").fit(disp=False)
            return m.forecast(h).to_numpy()
    raise ValueError(name)


def backtest(s: pd.Series, origins: int = 12, horizon: int = 6) -> pd.DataFrame:
    rows = []
    for k in range(origins, 0, -1):
        cut = len(s) - k - horizon + 1
        train, test = s.iloc[:cut], s.iloc[cut:cut + horizon]
        for name in ("seasonal_naive", "holt_winters", "sarima"):
            pred = _fit_predict(name, train, len(test))
            for h, (actual, p) in enumerate(zip(test.to_numpy(), pred, strict=True), 1):
                rows.append({"model": name, "origin": train.index[-1], "h": h,
                             "actual": actual, "pred": p, "ape": abs(p - actual) / actual})
    return pd.DataFrame(rows)


def run() -> dict:
    lines = df(f"""SELECT month, line, weekday_riders, recovery_vs_2019
                   FROM mart_ridership_monthly WHERE line IN {LINES} ORDER BY month""")
    last = lines["month"].max()
    trailing = df(f"""
        SELECT line, avg(weekday_riders) AS riders_12m, avg(riders_2019) AS riders_2019,
               avg(weekday_riders) / avg(riders_2019) AS recovery
        FROM mart_ridership_monthly
        WHERE line IN {LINES} AND month > DATE '{last:%Y-%m-%d}' - INTERVAL 12 MONTH
          AND riders_2019 IS NOT NULL
        GROUP BY line ORDER BY recovery DESC""")

    s = system_series()
    post = s[s.index >= "2022-01-01"]
    bt = backtest(post)
    scores = (bt.groupby("model")["ape"].mean().sort_values()
              .rename("mape").reset_index())
    best = scores.iloc[0]["model"]

    fc = _fit_predict(best, post, 12)
    resid = bt[bt.model == best]
    spread = resid.assign(err=(resid.pred - resid.actual) / resid.actual)["err"]
    lo_q, hi_q = np.quantile(spread, [0.1, 0.9])
    idx = pd.date_range(post.index[-1] + pd.offsets.MonthBegin(), periods=12, freq="MS")
    forecast = pd.DataFrame({"month": idx, "forecast": fc,
                             "lo80": fc * (1 - hi_q), "hi80": fc * (1 - lo_q)})

    rec = trailing.set_index("line")["recovery"]
    findings = [
        f"Over the 12 months to {last:%b %Y}, systemwide recovery is uneven: "
        f"Commuter Rail is at {pct(rec['Commuter Rail'])} of 2019 weekday ridership, "
        f"buses at {pct(rec['Bus'])}, but the Red Line only {pct(rec['Red Line'])}.",
        f"Best forecaster in a 12-origin rolling backtest: {best.replace('_', ' ')} "
        f"(MAPE {pct(scores.iloc[0]['mape'])} vs. seasonal-naive "
        f"{pct(scores.set_index('model').loc['seasonal_naive', 'mape'])}).",
    ]
    return {
        "lines": records(lines),
        "trailing_recovery": records(trailing),
        "system": records(s.rename("riders").reset_index().rename(columns={"index": "month"})),
        "backtest_scores": records(scores),
        "forecast_model": best,
        "forecast": records(forecast),
        "as_of": f"{last:%Y-%m-%d}",
        "findings": findings,
    }
