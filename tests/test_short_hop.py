"""Distance-fare logic and track-graph construction (synthetic data, no downloads)."""
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


def test_shortest_path_uses_track_distance_and_transfers():
    adj = sh.build_graph(PATTERNS)
    d, path = sh.shortest(adj, "D", "Y")
    assert path == ["D", "C", "Y"] and d == pytest.approx(2300)
    d, path = sh.shortest(adj, "F", "D")
    assert path == ["F", "E", "B", "C", "D"] and d == pytest.approx(10000 - 1000 + 3000)


def test_whole_line_costs_the_cap():
    full, name = sh.full_length(PATTERNS, "A", "F")
    assert name == "A - F"
    assert sh.fare(10000, full) == sh.FLAT_FARE
    assert sh.fare(9850, full) == sh.FLAT_FARE          # within direction tolerance


@pytest.mark.parametrize("d,expected", [(0, 0.0), (100, sh.DEFAULT_FLOOR), (5000, 1.20),
                                        (20000, sh.FLAT_FARE)])
def test_fare_is_proportional_floored_and_capped(d, expected):
    assert sh.fare(d, 10000) == pytest.approx(expected)


def test_no_trip_ever_costs_more_than_today():
    assert all(sh.fare(d, 10000) <= sh.FLAT_FARE for d in range(1, 50000, 250))


def test_researched_floors():
    assert pytest.approx(0.80) == sh.DEFAULT_FLOOR       # WMATA 2.25/6.75 of $2.40
    assert pytest.approx(0.38) == sh.HYDERABAD_FLOOR     # Hyderabad 11/69 of $2.40
