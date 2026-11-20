"""Short-Hop distance fare: whole line = $2.40, proportional below, $0.80 minimum."""
from __future__ import annotations

import pytest

from mbta_ti.analysis import short_hop as sh

STOPS = {s: {"lat": 42.35 + i * 0.01, "lon": -71.06} for i, s in enumerate("ABCDEFXY")}
def _pat(route, name, stations, cum):
    return {"route": route, "name": name, "stations": stations, "cum_m": cum, "length_m": cum[-1]}


PATTERNS = [
    _pat("Red", "A - D", ["A", "B", "C", "D"], [0, 1000, 2500, 4000]),
    _pat("Red", "A - F", ["A", "B", "E", "F"], [0, 1000, 3000, 10000]),
    _pat("Orange", "X - Y", ["X", "C", "Y"], [0, 800, 1600]),
]
sh.add_line_miles(PATTERNS, STOPS)


def test_minimum_is_washington_ratio():
    assert pytest.approx(0.80) == sh.MIN_FARE                       # 2.40 x 2.25 / 6.75


def test_composite_mile_is_average_of_rail_and_straight_line():
    assert sh.composite_miles(2 * sh.METERS_PER_MILE, sh.METERS_PER_MILE) == pytest.approx(1.5)


@pytest.mark.parametrize("trip,line,expected", [
    (0, 10, 0.0),
    (10, 10, 2.40),        # end to end = $2.40
    (9.85, 10, 2.40),      # within the direction tolerance
    (5, 10, 1.20),         # half the line = half the fare
    (7.3, 10, 1.80),       # 1.752 -> rounds UP to 1.80
    (0.5, 10, 0.80),       # never below the minimum
    (25, 10, 2.40),        # longer (transfer) trips capped
])
def test_proportional_fare(trip, line, expected):
    assert sh.fare(trip, line) == pytest.approx(expected)


def test_reduced_fare_is_half_rounded_down():
    assert sh.fare(7.3, 10, reduced=True) == pytest.approx(0.90)
    assert sh.fare(5.25, 10, reduced=True) == pytest.approx(0.65)  # 1.26 -> 1.30 -> 0.65


def test_every_end_to_end_trip_costs_the_cap():
    adj = sh.build_graph(PATTERNS)
    for p in PATTERNS:
        q = sh.quote(adj, STOPS, PATTERNS, p["stations"][0], p["stations"][-1])
        assert q["fare"] == sh.MAX_FARE, p["name"]


def test_whole_line_prefers_a_pattern_serving_both_ends():
    assert sh.whole_line(PATTERNS, "A", "F")["name"] == "A - F"
    assert sh.whole_line(PATTERNS, "X", "Y")["name"] == "X - Y"


def test_no_trip_ever_costs_more_than_today():
    assert all(sh.fare(m / 10, 7) <= sh.FLAT_FARE for m in range(1, 400))
