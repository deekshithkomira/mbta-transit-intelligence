"""Short-Hop: a distance-based subway fare where riding a whole line end to end costs
today's flat fare, and shorter trips cost proportionally less.

The problem
-----------
Every MBTA subway trip costs the same $2.40 (MBTA fares page; unchanged since 2019).
One stop costs the same as thirteen, so the flat fare is the worst value exactly where
walking, cycling or evading is most tempting.

The rule
--------
    fare = clamp( cap * d / D , floor, cap )

* d   = track distance actually travelled, from the MBTA Rapid Transit Stop Distances
        dataset (GTFS-derived meters between consecutive stations).
* D   = the distance that pays the full fare.  Default ("line" mode): the full length
        of the line being ridden, so **riding a line from its first stop to its last
        costs $2.40** and every shorter trip costs less in proportion.  Alternative
        ("uniform" mode): one network-wide reference distance, so a kilometre costs
        the same on every line.
* cap = $2.40, today's fare: no trip ever costs more than it does now.
* floor = minimum fare.  Default $0.80 = one third of the cap, the same min:max ratio
        as Washington Metrorail's distance fares ($2.25-$6.75).  Hyderabad Metro's
        ratio is 11/69 (Rs 11 within 2 km to Rs 69 beyond 24 km), i.e. $0.38.

What the data cannot say
------------------------
The MBTA does not publish station-to-station trip tables, so revenue impact is a
break-even condition, not a forecast: a trip priced at f instead of F breaks even
only if paying riders on it grow by F/f - 1.
"""
from __future__ import annotations

import heapq
import json

import pandas as pd

from mbta_ti import config
from mbta_ti.analysis.common import pct

FLAT_FARE = 2.40
DEFAULT_FLOOR = round(FLAT_FARE * 2.25 / 6.75, 2)          # WMATA min:max ratio -> $0.80
HYDERABAD_FLOOR = round(FLAT_FARE * 11 / 69, 2)             # Hyderabad min:max ratio -> $0.38
HYDERABAD_ZONES_INR = [(2, 11), (4, 17), (6, 28), (9, 37), (12, 47), (15, 51), (18, 56),
                       (21, 61), (24, 65), (None, 69)]       # L&T Metro press release, 23 May 2025
WMATA_RANGE = (2.25, 6.75)

EXAMPLES = [
    ("place-coecl", "place-armnl"),   # Copley -> Arlington (next stop)
    ("place-coecl", "place-pktrm"),   # Copley -> Park Street
    ("place-coecl", "place-mdftf"),   # Copley -> Medford/Tufts
    ("place-hsmnl", "place-mdftf"),   # Heath Street -> Medford/Tufts (whole Green E)
    ("place-harsq", "place-cntsq"),   # Harvard -> Central
    ("place-alfcl", "place-brntn"),   # Alewife -> Braintree (whole Red)
    ("place-ogmnl", "place-forhl"),   # Oak Grove -> Forest Hills (whole Orange)
    ("place-wondl", "place-bomnl"),   # Wonderland -> Bowdoin (whole Blue)
]


FULL_TOLERANCE = 0.98  # the two published directions of a line differ by a few metres


def fare(d_m: float, full_m: float, floor: float = DEFAULT_FLOOR, cap: float = FLAT_FARE) -> float:
    if d_m <= 0:
        return 0.0
    share = d_m / full_m
    if share >= FULL_TOLERANCE:
        return cap
    return round(min(cap, max(floor, cap * share)), 2)


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


def full_length(patterns: list[dict], a: str, b: str) -> tuple[float, str]:
    """Length that pays the full fare in 'line' mode: the longest pattern serving both
    ends (rider-friendly), else the longest pattern serving either end (transfer trip)."""
    both = [p for p in patterns if a in p["stations"] and b in p["stations"]]
    pool = both or [p for p in patterns if a in p["stations"] or b in p["stations"]]
    best = max(pool, key=lambda p: p["length_m"])
    return best["length_m"], best["name"]


def run() -> dict:
    net = json.loads((config.RAW / "v3_network.json").read_text())
    names = {k: v["name"] for k, v in net["stops"].items()}
    patterns = load_patterns()
    adj = build_graph(patterns)

    examples = []
    for a, b in EXAMPLES:
        d, path = shortest(adj, a, b)
        full_m, pat = full_length(patterns, a, b)
        f = fare(d, full_m)
        examples.append({"from": names[a], "to": names[b], "stops": len(path) - 1,
                         "km": d / 1000, "full_line": pat, "full_line_km": full_m / 1000,
                         "fare": f, "saving": round(FLAT_FARE - f, 2),
                         "breakeven_growth": FLAT_FARE / f - 1})
    ex = {(e["from"], e["to"]): e for e in examples}
    lengths = sorted({(p["name"], p["length_m"]) for p in patterns}, key=lambda x: x[1])
    per_km = [(n, FLAT_FARE / (m / 1000)) for n, m in lengths]

    one = ex[("Copley", "Arlington")]
    far = ex[("Copley", "Medford/Tufts")]
    whole = ex[("Heath Street", "Medford/Tufts")]
    findings = [
        f"Today Copley → Arlington (1 stop, {one['km']:.1f} km) and Copley → Medford/Tufts "
        f"({far['stops']} stops, {far['km']:.1f} km) both cost ${FLAT_FARE:.2f}.",
        f"Distance fare with the whole line = ${FLAT_FARE:.2f}: Heath Street → Medford/Tufts "
        f"({whole['km']:.1f} km) pays ${whole['fare']:.2f}; Copley → Medford/Tufts pays "
        f"${far['fare']:.2f}; Copley → Arlington pays the ${DEFAULT_FLOOR:.2f} minimum.",
        f"Minimum fare ${DEFAULT_FLOOR:.2f} = one third of the cap, Washington Metrorail's "
        f"min:max ratio (${WMATA_RANGE[0]:.2f}–${WMATA_RANGE[1]:.2f}); Hyderabad's ratio "
        f"(₹11–₹69) would give ${HYDERABAD_FLOOR:.2f}.",
        f"Trade-off: because lines differ in length ({lengths[0][1] / 1000:.1f} km to "
        f"{lengths[-1][1] / 1000:.1f} km), 'whole line = $2.40' prices a kilometre between "
        f"${per_km[-1][1]:.2f} and ${per_km[0][1]:.2f}. A uniform-rate option is included for "
        f"comparison.",
        f"Revenue break-even: a ${one['fare']:.2f} short trip must grow paying riders on it by "
        f"{pct(one['breakeven_growth'], 0)}; Copley → Medford/Tufts at ${far['fare']:.2f} needs "
        f"{pct(far['breakeven_growth'], 0)}. Pilot before system-wide rollout.",
    ]
    return {
        "flat_fare": FLAT_FARE,
        "defaults": {"floor": DEFAULT_FLOOR, "mode": "line", "uniform_km": 13.8},
        "research": {"hyderabad_zones_inr": HYDERABAD_ZONES_INR,
                     "hyderabad_source": "https://ltmetro.com/wp-content/uploads/2025/05/"
                                         "Hyderabad-Metro-Rail-Revised-Fare-Chart-Final.pdf",
                     "wmata_range": WMATA_RANGE,
                     "wmata_source": "https://www.wmata.com/fares/metro-2024-fare-changes/",
                     "mbta_fare_source": "https://www.mbta.com/fares/subway-fares",
                     "hyderabad_floor": HYDERABAD_FLOOR},
        "examples": examples,
        "line_lengths": [{"pattern": n, "km": m / 1000, "usd_per_km": FLAT_FARE / (m / 1000)}
                         for n, m in lengths],
        "graph": {"adj": {k: {v: round(w, 1) for v, w in nb.items()} for k, nb in adj.items()},
                  "names": {s: names.get(s, s) for s in adj},
                  "patterns": [{"name": p["name"], "route": p["route"], "stations": p["stations"],
                                "length_m": round(p["length_m"], 1)} for p in patterns]},
        "findings": findings,
    }
