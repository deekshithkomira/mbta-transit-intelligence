// Short-Hop fare engine — Washington Metrorail model, Boston calibration.
// Mirrors src/mbta_ti/analysis/short_hop.py; parity is checked by tests/app_fare.test.mjs.
//
//   composite miles = average(track distance, straight-line distance)
//   fare            = base for the first 3 composite miles
//                   + per-mile charge (20% of base) for each extra composite mile
//                   capped at max (3 x base), rounded UP to $0.05
//   nights & weekends: base .. offpeak_max     reduced fare: 50%, rounded DOWN to $0.05

export const METERS_PER_MILE = 1609.344;

export const roundUp5 = x => Math.ceil(Math.round(x * 20 * 1e6) / 1e6) / 20;
export const roundDown5 = x => Math.floor(Math.round(x * 20 * 1e6) / 1e6) / 20;

export function haversineMeters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const p1 = a.lat * rad, p2 = b.lat * rad, dp = p2 - p1, dl = (b.lon - a.lon) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const compositeMiles = (railM, straightM) => (railM + straightM) / 2 / METERS_PER_MILE;

/** 'offpeak' from 9:30pm to close on weekdays and all day Saturday/Sunday, else 'peak'. */
export function periodFor(date = new Date()) {
  const day = date.getDay(), mins = date.getHours() * 60 + date.getMinutes();
  if (day === 0 || day === 6) return "offpeak";
  return mins >= 21 * 60 + 30 || mins < 5 * 60 ? "offpeak" : "peak";
}

export function fare(compositeMi, rules, { period = "peak", reduced = false } = {}) {
  if (!(compositeMi > 0)) return 0;
  const extra = Math.max(0, compositeMi - rules.base_miles);
  let regular = Math.min(rules.max, roundUp5(rules.base + rules.per_mile * extra));
  if (period === "offpeak") regular = Math.min(rules.offpeak_max, regular);
  return reduced ? roundDown5(regular * rules.reduced_share) : regular;
}

/** Dijkstra over track meters. adj: {station: {neighbour: meters}} */
export function shortestPath(adj, a, b) {
  const dist = { [a]: 0 }, prev = { [a]: null }, done = new Set();
  const heap = [[0, a]];
  const push = item => { heap.push(item); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === b) break;
    for (const [v, w] of Object.entries(adj[u] || {})) {
      if (d + w < (dist[v] ?? Infinity)) { dist[v] = d + w; prev[v] = u; push([d + w, v]); }
    }
  }
  if (!(b in dist)) return { meters: Infinity, path: [] };
  const path = []; for (let u = b; u != null; u = prev[u]) path.unshift(u);
  return { meters: dist[b], path };
}

export function quote(net, from, to, opts = {}) {
  const { graph, rules, flat_fare: flat } = net;
  if (from === to) return null;
  const { meters, path } = shortestPath(graph.adj, from, to);
  const straight = haversineMeters(graph.stations[from], graph.stations[to]);
  const cm = compositeMiles(meters, straight);
  const period = opts.period || "peak";
  const reduced = !!opts.reduced;
  const extraMiles = Math.max(0, cm - rules.base_miles);
  const raw = rules.base + rules.per_mile * extraMiles;
  const amount = fare(cm, rules, { period, reduced });
  const today = reduced ? roundDown5(flat * rules.reduced_share) : flat;
  return {
    path, stops: path.length - 1,
    railMi: meters / METERS_PER_MILE, straightMi: straight / METERS_PER_MILE, compositeMi: cm,
    extraMiles, raw, period, reduced, fare: amount, today, saving: Math.max(0, today - amount),
    capped: amount >= (period === "offpeak" ? rules.offpeak_max : rules.max) - 1e-9,
  };
}
