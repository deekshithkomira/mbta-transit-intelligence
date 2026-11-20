"""Unit tests for the analytical cores. They use synthetic inputs, so they run in CI
without downloading any data."""
from __future__ import annotations

import duckdb
import numpy as np
import pandas as pd
import pytest

from mbta_ti.analysis import fare_integrity as fi
from mbta_ti.analysis import reliability as rel
from mbta_ti.analysis.common import records
from mbta_ti.warehouse.build import SQL_DIR

RNG = np.random.default_rng(0)


# ---------------------------------------------------------------- optimiser
@pytest.mark.parametrize("hours", [1, 5, 20, 80])
@pytest.mark.parametrize("k", [0.5, 3, 10])
def test_optimal_coverage_respects_budget_and_bounds(hours, k):
    e = RNG.lognormal(5, 1.2, 300)
    x = fi.optimal_coverage(e, hours, k)
    assert np.all(x >= 0) and np.all(x <= 1)
    assert x.sum() == pytest.approx(hours, rel=1e-4)


@pytest.mark.parametrize("k", [0.5, 1, 3, 10])
def test_optimal_beats_heuristics(k):
    e = RNG.lognormal(5, 1.2, 300)
    h = 25
    opt = fi.deterred(e, fi.optimal_coverage(e, h, k), k)
    assert opt >= fi.deterred(e, np.full_like(e, h / len(e)), k) - 1e-9
    assert opt >= fi.deterred(e, fi.busiest_first(e, h), k) - 1e-9


def test_optimum_satisfies_kkt():
    """Interior cells must share one marginal value (the Lagrange multiplier)."""
    e, k = RNG.lognormal(5, 1, 200), 2.0
    x = fi.optimal_coverage(e, 30, k)
    interior = (x > 1e-6) & (x < 1 - 1e-6)
    marginal = k * e[interior] * 0.1 * np.exp(-k * x[interior])
    assert marginal.std() / marginal.mean() < 1e-3


def test_strategy_ranking_invariant_to_evasion_level():
    e, k, h = RNG.lognormal(5, 1, 100), 3, 10
    ratios = []
    for r in (0.02, 0.1, 0.3):
        x = fi.optimal_coverage(e, h, k, r)
        ratios.append(fi.deterred(e, x, k, r) / fi.deterred(e, fi.busiest_first(e, h), k, r))
    assert max(ratios) - min(ratios) < 1e-6


def test_roster_sampling_is_unbiased():
    x = np.array([0.2, 0.5, 0.9, 0.4, 1.0])
    rng = np.random.default_rng(1)
    draws = np.mean([fi.sample_roster(x, rng) for _ in range(20000)], axis=0)
    np.testing.assert_allclose(draws, x, atol=0.02)
    assert all(fi.sample_roster(x, rng).sum() in (3, 4) for _ in range(50))


def test_break_even():
    rows = fi.break_even_curve(2.40, [50, 100])
    assert rows[0]["break_even_inspection_rate"] == pytest.approx(0.048)


# --------------------------------------------------------- empirical Bayes
def test_shrinkage_pulls_small_samples_to_the_mean():
    frame = pd.DataFrame({"route_id": ["big", "small"] + [f"r{i}" for i in range(50)],
                          "on_time": [55_000, 2] + list(RNG.integers(600, 800, 50)),
                          "observed": [100_000, 10] + [1000] * 50})
    out = rel.shrink(frame).set_index("route_id")
    grand = frame.on_time.sum() / frame.observed.sum()
    assert abs(out.loc["small", "eb_otp"] - grand) < abs(out.loc["small", "raw_otp"] - grand)
    assert out.loc["big", "eb_otp"] == pytest.approx(out.loc["big", "raw_otp"], abs=0.002)
    assert (out.ci_lo <= out.eb_otp).all() and (out.eb_otp <= out.ci_hi).all()


# --------------------------------------------------------------- warehouse
def test_flex_date_macro_parses_mixed_formats():
    sql = (SQL_DIR / "01_staging.sql").read_text()
    macro = sql[sql.index("CREATE OR REPLACE MACRO"):sql.index(";", sql.index("MACRO")) + 1]
    con = duckdb.connect()
    con.execute(macro)
    got = con.execute("SELECT flex_date('2025-06-25'), flex_date('1/15/25'), "
                      "flex_date('1/1/2016'), flex_date('garbage')").fetchone()
    assert [str(v) if v else None for v in got] == ["2025-06-25", "2025-01-15", "2016-01-01",
                                                    None]


def test_records_is_json_safe():
    frame = pd.DataFrame({"d": pd.to_datetime(["2024-01-01"]), "x": [np.nan],
                          "i": np.array([3], dtype=np.int64)})
    assert records(frame) == [{"d": "2024-01-01", "x": None, "i": 3}]
