"""Short-Hop: a distance-based MBTA subway fare — end to end of a line costs today's $2.40.

The problem
-----------
Every MBTA subway trip costs the same $2.40 (MBTA fares page; unchanged since 2019).
One stop costs the same as thirteen, so the flat fare is the worst value exactly where
walking, cycling or evading is most tempting.

The rule
--------
Riding a line from its first stop to its last costs $2.40, and every shorter trip pays in
proportion to the distance travelled:

    fare = $2.40 x (trip composite miles / composite miles of the whole line)
           rounded UP to $0.05, never below $0.80, never above $2.40

The mechanics come from Washington Metrorail (WMATA Tariff 49, effective July 1, 2026):
* composite mile = average of (a) distance along the rail system and (b) straight-line
  distance between origin and destination;
* fares round UP to the nearest $0.05;
* the minimum fare is one third of the maximum, Washington's ratio ($2.25 / $6.75) -> $0.80;
* reduced fares are 50% of the regular fare, rounded DOWN to the nearest $0.05.

"The whole line" is the longest service pattern that serves both ends of the trip (e.g.
Heath Street - Medford/Tufts for a Green Line E trip), or, for a trip that changes lines,
the longest pattern serving either end.  Longer trips are capped at $2.40.

A missing tap-out is charged $2.40: MBTA gates validate entry only, so skipping the exit
tap must never be cheaper.  (Washington charges its base fare, because its exit gates
make tapping out unavoidable.)

What the data cannot say
------------------------
The MBTA does not publish station-to-station trip tables, so revenue impact is a
break-even condition, not a forecast: a trip priced at f instead of $2.40 breaks even only
if paying riders on it grow by 2.40/f - 1.
"""
from __future__ import annotations

import heapq
import json
import math

import pandas as pd

from mbta_ti import config
from mbta_ti.analysis.common import pct

FLAT_FARE = 2.40
METERS_PER_MILE = 1609.344

# Washington Metrorail (WMATA Tariff 49, effective 2026-07-01): mechanics and ratios used
WMATA = {"base": 2.25, "per_mile": 0.45, "max": 6.75, "base_miles": 3.0,
         "offpeak_min": 2.25, "offpeak_max": 2.50, "reduced_share": 0.5,
         "source": "https://www.wmata.com/content/dam/wmata-com/about/public-records/Tariff%2049.pdf"}

MAX_FARE = FLAT_FARE                                                  # whole line = $2.40
MIN_FARE = round(MAX_FARE * WMATA["base"] / WMATA["max"], 2)          # $0.80
REDUCED_SHARE = WMATA["reduced_share"]
MISSED_TAP_OUT = MAX_FARE
FULL_TOLERANCE = 0.98   # end-to-end trips measured either direction differ by a few metres

EXAMPLES = [
    ("place-coecl", "place-armnl"),   # Copley -> Arlington (next stop)
    ("place-coecl", "place-pktrm"),   # Copley -> Park Street
    ("place-coecl", "place-mdftf"),   # Copley -> Medford/Tufts
    ("place-hsmnl", "place-mdftf"),   # Heath Street -> Medford/Tufts (whole Green E)
    ("place-harsq", "place-cntsq"),   # Harvard -> Central
    ("place-alfcl", "place-brntn"),   # Alewife -> Braintree (whole Red)
    ("place-ogmnl", "place-forhl"),   # Oak Grove -> Forest Hills (whole Orange)
    ("place-wondl", "place-bomnl"),   # Wonderland -> Bowdoin (whole Blue)
    ("place-asmnl", "place-matt"),    # Ashmont -> Mattapan (whole Mattapan line)
]


def round_up_5c(x: float) -> float:
    return math.ceil(round(x * 20, 6)) / 20


def round_down_5c(x: float) -> float:
    return math.floor(round(x * 20, 6)) / 20


def composite_miles(rail_m: float, straight_m: float) -> float:
    return (rail_m + straight_m) / 2 / METERS_PER_MILE


def fare(trip_mi: float, line_mi: float, *, reduced: bool = False) -> float:
    """Proportional distance fare: whole line = $2.40, minimum $0.80, round up to $0.05."""
    if trip_mi <= 0:
        return 0.0
    share = trip_mi / line_mi
    if share >= FULL_TOLERANCE:
        regular = MAX_FARE
    else:
        regular = min(MAX_FARE, max(MIN_FARE, round_up_5c(MAX_FARE * share)))
    return round_down_5c(regular * REDUCED_SHARE) if reduced else regular


def haversine_m(a: dict, b: dict) -> float:
    r = 6_371_000
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def load_patterns() -> list[dict]:
    """Ordered station sequences with cumulative meters, one per service pattern."""
    d = pd.read_parquet(config.RAW / "stop_distances.parquet")
    d = d[d.direction_id == 0].sort_values(["route_pattern_name", "cumulative_meters"])
    pats = []
    for (route, name), g in d.groupby(["route_id", "route_pattern_name"], sort=False):
        stations = [g.iloc[0].from_station_id] + list(g.to_station_id)
        cum = [0.0] + list(g.cumulative_meters)
        pats.append({"route": route, "name": name, "stations": stations, "cum_m": cum,
                     "length_m": float(cum[-1])})
    return pats


def add_line_miles(patterns: list[dict], stops: dict) -> None:
    """Composite miles of each whole line (first stop to last stop)."""
    for p in patterns:
        a, b = stops[p["stations"][0]], stops[p["stations"][-1]]
        p["composite_mi"] = composite_miles(p["length_m"], haversine_m(a, b))


def build_graph(patterns: list[dict]) -> dict[str, dict[str, float]]:
    adj: dict[str, dict[str, float]] = {}
    for p in patterns:
        for (a, b), (ca, cb) in zip(zip(p["stations"], p["stations"][1:], strict=False),
                                    zip(p["cum_m"], p["cum_m"][1:], strict=False), strict=True):
            w = cb - ca
            if a == b or w <= 0:
                continue
            for x, y in ((a, b), (b, a)):
                adj.setdefault(x, {})
                adj[x][y] = min(adj[x].get(y, float("inf")), w)
    return adj


def shortest(adj: dict[str, dict[str, float]], src: str, dst: str) -> tuple[float, list[str]]:
    dist, prev = {src: 0.0}, {src: None}
    pq = [(0.0, src)]
    while pq:
        du, u = heapq.heappop(pq)
        if u == dst:
            break
        if du > dist[u]:
            continue
        for v, w in adj[u].items():
            if du + w < dist.get(v, float("inf")):
                dist[v], prev[v] = du + w, u
                heapq.heappush(pq, (du + w, v))
    path, u = [], dst
    while u is not None:
        path.insert(0, u)
        u = prev[u]
    return dist[dst], path


def whole_line(patterns: list[dict], a: str, b: str) -> dict:
    """The line whose end-to-end trip costs $2.40 for this journey (see module docstring)."""
    both = [p for p in patterns if a in p["stations"] and b in p["stations"]]
    pool = both or [p for p in patterns if a in p["stations"] or b in p["stations"]]
    return max(pool, key=lambda p: p["composite_mi"])


def quote(adj, stops: dict, patterns: list[dict], a: str, b: str) -> dict:
    rail_m, path = shortest(adj, a, b)
    straight_m = haversine_m(stops[a], stops[b])
    cm = composite_miles(rail_m, straight_m)
    line = whole_line(patterns, a, b)
    return {"rail_mi": rail_m / METERS_PER_MILE, "straight_mi": straight_m / METERS_PER_MILE,
            "composite_mi": cm, "line": line["name"], "line_mi": line["composite_mi"],
            "stops": len(path) - 1, "path": path,
            "fare": fare(cm, line["composite_mi"]), "reduced": fare(cm, line["composite_mi"], reduced=True)}


def run() -> dict:
    net = json.loads((config.RAW / "v3_network.json").read_text())
    stops = net["stops"]
    names = {k: v["name"] for k, v in stops.items()}
    patterns = load_patterns()
    add_line_miles(patterns, stops)
    adj = build_graph(patterns)

    examples = []
    for a, b in EXAMPLES:
        q = quote(adj, stops, patterns, a, b)
        examples.append({"from": names[a], "to": names[b], "stops": q["stops"],
                         "rail_mi": q["rail_mi"], "straight_mi": q["straight_mi"],
                         "composite_mi": q["composite_mi"], "line": q["line"], "line_mi": q["line_mi"],
                         "fare": q["fare"], "reduced": q["reduced"],
                         "saving": round(FLAT_FARE - q["fare"], 2),
                         "breakeven_growth": FLAT_FARE / q["fare"] - 1})
    ex = {(e["from"], e["to"]): e for e in examples}
    one, far = ex[("Copley", "Arlington")], ex[("Copley", "Medford/Tufts")]
    whole = [e for e in examples if e["fare"] == MAX_FARE]
    whole_names = ", ".join(f"{e['from']} → {e['to']}" for e in whole[:4])

    findings = [
        f"Today Copley → Arlington (1 stop) and Copley → Medford/Tufts ({far['stops']} stops, "
        f"{far['rail_mi']:.1f} track miles) both cost ${FLAT_FARE:.2f}.",
        f"Short-Hop rule: riding a line end to end costs ${MAX_FARE:.2f}; shorter trips pay in "
        f"proportion to distance (Washington-style composite miles, rounded up to $0.05), minimum "
        f"${MIN_FARE:.2f}.",
        f"Copley → Medford/Tufts = {far['composite_mi']:.2f} of {far['line_mi']:.2f} composite miles "
        f"on the whole Green Line E = ${far['fare']:.2f}; Copley → Arlington = the ${one['fare']:.2f} "
        f"minimum. Every end-to-end trip ({whole_names}) "
        f"costs exactly ${MAX_FARE:.2f}.",
        f"Reduced fares (students, seniors) are half price; a missing tap-out is charged "
        f"${MISSED_TAP_OUT:.2f}.",
        f"Revenue break-even: a ${one['fare']:.2f} short trip must grow paying riders on it by "
        f"{pct(one['breakeven_growth'], 0)}; Copley → Medford/Tufts at ${far['fare']:.2f} needs "
        f"{pct(far['breakeven_growth'], 0)}. Pilot before system-wide rollout.",
    ]
    station_ids = sorted(adj)
    lines_at: dict[str, set] = {}
    for p in patterns:
        for s in p["stations"]:
            lines_at.setdefault(s, set()).add(p["route"].split("-")[0])
    return {
        "flat_fare": FLAT_FARE,
        "rules": {"model": "line-proportional", "max": MAX_FARE, "min": MIN_FARE,
                  "reduced_share": REDUCED_SHARE, "missed_tap_out": MISSED_TAP_OUT,
                  "full_tolerance": FULL_TOLERANCE},
        "research": {"wmata": WMATA, "mbta_fare_source": "https://www.mbta.com/fares/subway-fares"},
        "examples": examples,
        "lines": sorted(({"line": p["name"], "route": p["route"], "composite_mi": p["composite_mi"],
                          "usd_per_mi": MAX_FARE / p["composite_mi"]} for p in patterns),
                        key=lambda x: x["composite_mi"]),
        "graph": {"adj": {k: {v: round(w, 1) for v, w in nb.items()} for k, nb in adj.items()},
                  "stations": {s: {"name": names.get(s, s), "lat": stops[s]["lat"],
                                   "lon": stops[s]["lon"], "lines": sorted(lines_at.get(s, []))}
                               for s in station_ids if s in stops},
                  "patterns": [{"name": p["name"], "route": p["route"], "stations": p["stations"],
                                "length_m": round(p["length_m"], 1),
                                "composite_mi": round(p["composite_mi"], 4)} for p in patterns]},
        "findings": findings,
    }
