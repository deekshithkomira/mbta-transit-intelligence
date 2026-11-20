"""Washington-model distance fare, Boston calibration (synthetic data, no downloads)."""
from __future__ import annotations

import pytest

from mbta_ti.analysis import short_hop as sh

PATTERNS = [
    {"route": "Red", "name": "A - D", "stations": ["A", "B", "C", "D"],
     "cum_m": [0, 1000, 2500, 4000], "length_m": 4000},
    {"route": "Red", "name": "A - F", "stations": ["A", "B", "E", "F"],
     "cum_m": [0, 1000, 3000, 10000], "length_m": 10000},
    {"route": "Orange", "name": "X - Y", "stations": ["X", "C", "Y"],
     "cum_m": [0, 800, 1600], "length_m": 1600},
]


def test_calibration_keeps_washington_ratios():
    assert pytest.approx(0.80) == sh.BASE_FARE                       # 2.40 / 3
    assert pytest.approx(0.16) == sh.PER_MILE                        # 20% of base
    assert pytest.approx(3.0) == sh.MAX_FARE / sh.BASE_FARE          # max = 3x base
    assert pytest.approx(0.90) == sh.OFFPEAK_MAX                     # 0.80 x 2.50/2.25, up


def test_shortest_path_uses_track_distance_and_transfers():
    adj = sh.build_graph(PATTERNS)
    d, path = sh.shortest(adj, "D", "Y")
    assert path == ["D", "C", "Y"] and d == pytest.approx(2300)


def test_composite_mile_is_average_of_rail_and_straight_line():
    assert sh.composite_miles(2 * sh.METERS_PER_MILE, 1 * sh.METERS_PER_MILE) == pytest.approx(1.5)


@pytest.mark.parametrize("mi,expected", [
    (0, 0.0), (0.4, 0.80), (3.0, 0.80),          # base covers the first 3 composite miles
    (3.1, 0.85),                                 # 0.80 + 0.016 = 0.816 -> rounds UP to 0.85
    (5.24, 1.20),                                # Copley -> Medford/Tufts
    (13.0, 2.40), (25.0, 2.40),                  # capped at today's fare
])
def test_peak_fare(mi, expected):
    assert sh.fare(mi) == pytest.approx(expected)


def test_offpeak_band_and_reduced_fare():
    assert sh.fare(0.5, period="offpeak") == pytest.approx(0.80)
    assert sh.fare(20, period="offpeak") == pytest.approx(0.90)
    assert sh.fare(5.24, reduced=True) == pytest.approx(0.60)       # half of 1.20
    assert sh.fare(3.1, reduced=True) == pytest.approx(0.40)        # half of 0.85 = 0.425 -> down


def test_no_trip_ever_costs_more_than_today():
    assert all(sh.fare(m / 10) <= sh.FLAT_FARE for m in range(1, 400))
