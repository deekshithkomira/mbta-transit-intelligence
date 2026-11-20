"""Short-Hop: a distance-based MBTA subway fare built on Washington Metrorail's fare model.

The problem
-----------
Every MBTA subway trip costs the same $2.40 (MBTA fares page; unchanged since 2019).
One stop costs the same as thirteen, so the flat fare is the worst value exactly where
walking, cycling or evading is most tempting.

The model: Washington Metrorail (WMATA Tariff 49, effective July 1, 2026)
-------------------------------------------------------------------------
* Base fare covers the first 3 composite miles.
* Each additional composite mile costs 20% of the base fare.
* The maximum fare is 3x the base fare.
* Composite mile = average of (a) distance along the rail system and (b) straight-line
  distance between origin and destination.
* Fares round UP to the nearest $0.05.
* Late night (9:30pm-close) and weekends: a narrow flat band, $2.25-$2.50 in Washington
  (i.e. base to base x 1.11).
* Reduced fares are 50% of the regular fare, rounded DOWN to the nearest $0.05.

Boston calibration
------------------
Keep every Washington ratio, but set the maximum to today's MBTA fare so **no trip ever
costs more than it does now**:
    max  = $2.40      base = max / 3 = $0.80      per mile = 20% x base = $0.16
    off-peak band = $0.80-$0.90 (Washington's 2.50/2.25 ratio, rounded up)

One deliberate difference: Washington charges only the base fare for a missed exit tap,
because its exit gates make tapping out unavoidable.  MBTA gates validate entry only, so a
missing tap-out is charged the maximum ($2.40) — otherwise skipping the exit tap would
always be the cheapest choice.

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

# Washington Metrorail ratios (WMATA Tariff 49, effective 2026-07-01)
WMATA = {"base": 2.25, "per_mile": 0.45, "max": 6.75, "base_miles": 3.0,
         "offpeak_min": 2.25, "offpeak_max": 2.50, "reduced_share": 0.5,
         "source": "https://www.wmata.com/content/dam/wmata-com/about/public-records/Tariff%2049.pdf"}

# Boston calibration: same ratios, maximum = today's flat fare
MAX_FARE = FLAT_FARE
BASE_FARE = round(MAX_FARE * WMATA["base"] / WMATA["max"], 2)          # $0.80
PER_MILE = round(BASE_FARE * WMATA["per_mile"] / WMATA["base"], 2)     # $0.16
BASE_MILES = WMATA["base_miles"]                                        # 3 composite miles
MISSED_TAP_OUT = MAX_FARE

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


def round_up_5c(x: float) -> float:
    return math.ceil(round(x * 20, 6)) / 20


def round_down_5c(x: float) -> float:
    return math.floor(round(x * 20, 6)) / 20


# Washington's late-night/weekend band is base..base x (2.50/2.25); same ratio here -> $0.90
OFFPEAK_MAX = round_up_5c(BASE_FARE * WMATA["offpeak_max"] / WMATA["offpeak_min"])


def composite_miles(rail_m: float, straight_m: float) -> float:
    return (rail_m + straight_m) / 2 / METERS_PER_MILE


def fare(composite_mi: float, *, period: str = "peak", reduced: bool = False) -> float:
    """Washington-model fare, Boston calibration.  period: 'peak' (regular) or 'offpeak'."""
    if composite_mi <= 0:
        return 0.0
    extra = max(0.0, composite_mi - BASE_MILES)
    regular = min(MAX_FARE, round_up_5c(BASE_FARE + PER_MILE * extra))
    if period == "offpeak":
        regular = min(OFFPEAK_MAX, regular)
    return round_down_5c(regular * WMATA["reduced_share"]) if reduced else regular


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


def quote(adj, stops: dict, a: str, b: str) -> dict:
    rail_m, path = shortest(adj, a, b)
    straight_m = haversine_m(stops[a], stops[b])
    cm = composite_miles(rail_m, straight_m)
    return {"rail_mi": rail_m / METERS_PER_MILE, "straight_mi": straight_m / METERS_PER_MILE,
            "composite_mi": cm, "stops": len(path) - 1, "path": path,
            "fare": fare(cm), "offpeak": fare(cm, period="offpeak"),
            "reduced": fare(cm, reduced=True)}


def run() -> dict:
    net = json.loads((config.RAW / "v3_network.json").read_text())
    stops = net["stops"]
    names = {k: v["name"] for k, v in stops.items()}
    patterns = load_patterns()
    adj = build_graph(patterns)

    examples = []
    for a, b in EXAMPLES:
        q = quote(adj, stops, a, b)
        examples.append({"from": names[a], "to": names[b], "stops": q["stops"],
                         "rail_mi": q["rail_mi"], "straight_mi": q["straight_mi"],
                         "composite_mi": q["composite_mi"], "fare": q["fare"],
                         "offpeak": q["offpeak"], "reduced": q["reduced"],
                         "saving": round(FLAT_FARE - q["fare"], 2),
                         "breakeven_growth": FLAT_FARE / q["fare"] - 1})
    ex = {(e["from"], e["to"]): e for e in examples}
    one, far = ex[("Copley", "Arlington")], ex[("Copley", "Medford/Tufts")]
    red = ex[("Alewife", "Braintree")]
    cap_at = BASE_MILES + (MAX_FARE - BASE_FARE) / PER_MILE

    findings = [
        f"Today Copley → Arlington (1 stop) and Copley → Medford/Tufts ({far['stops']} stops, "
        f"{far['rail_mi']:.1f} track miles) both cost ${FLAT_FARE:.2f}.",
        f"Washington Metrorail model, scaled to Boston: ${BASE_FARE:.2f} covers the first "
        f"{BASE_MILES:.0f} composite miles, +${PER_MILE:.2f} per extra mile, maximum "
        f"${MAX_FARE:.2f} (today's fare) — the same ratios as Washington's $2.25 / $0.45 / $6.75.",
        f"Copley → Arlington costs ${one['fare']:.2f}; Copley → Medford/Tufts "
        f"{far['composite_mi']:.1f} composite miles = ${far['fare']:.2f}; Alewife → Braintree "
        f"reaches the ${red['fare']:.2f} maximum (cap reached at {cap_at:.0f} composite miles).",
        f"Nights after 9:30pm and weekends: ${BASE_FARE:.2f}–${OFFPEAK_MAX:.2f}; reduced fares "
        f"(students, seniors) are half price; a missing tap-out is charged ${MISSED_TAP_OUT:.2f}.",
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
        "rules": {"base": BASE_FARE, "per_mile": PER_MILE, "base_miles": BASE_MILES,
                  "max": MAX_FARE, "offpeak_min": BASE_FARE, "offpeak_max": OFFPEAK_MAX,
                  "reduced_share": WMATA["reduced_share"], "missed_tap_out": MISSED_TAP_OUT,
                  "cap_reached_mi": cap_at},
        "research": {"wmata": WMATA,
                     "mbta_fare_source": "https://www.mbta.com/fares/subway-fares"},
        "examples": examples,
        "graph": {"adj": {k: {v: round(w, 1) for v, w in nb.items()} for k, nb in adj.items()},
                  "stations": {s: {"name": names.get(s, s), "lat": stops[s]["lat"],
                                   "lon": stops[s]["lon"], "lines": sorted(lines_at.get(s, []))}
                               for s in station_ids if s in stops},
                  "patterns": [{"name": p["name"], "route": p["route"], "stations": p["stations"],
                                "length_m": round(p["length_m"], 1)} for p in patterns]},
        "findings": findings,
    }
