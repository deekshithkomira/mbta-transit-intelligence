// Short-Hop fare engine. Mirrors src/mbta_ti/analysis/short_hop.py; parity is checked by
// tests/app_fare.test.mjs.
//
//   Riding a line from its first stop to its last costs $2.40.
//   fare = $2.40 x (trip composite miles / composite miles of the whole line)
//          rounded UP to $0.05, never below $0.80, never above $2.40
//   composite miles = average(track distance, straight-line distance)  — Washington Metrorail
//   reduced fare = 50%, rounded DOWN to $0.05

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

export function fare(tripMi, lineMi, rules, { reduced = false } = {}) {
  if (!(tripMi > 0)) return 0;
  const share = tripMi / lineMi;
  const regular = share >= rules.full_tolerance ? rules.max
    : Math.min(rules.max, Math.max(rules.min, roundUp5(rules.max * share)));
  return reduced ? roundDown5(regular * rules.reduced_share) : regular;
}

/** The line whose end-to-end trip costs the maximum for this journey. */
export function wholeLine(patterns, a, b) {
  let pool = patterns.filter(p => p.stations.includes(a) && p.stations.includes(b));
  if (!pool.length) pool = patterns.filter(p => p.stations.includes(a) || p.stations.includes(b));
  return pool.reduce((x, y) => (y.composite_mi > x.composite_mi ? y : x));
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

export function quote(net, from, to, { reduced = false } = {}) {
  const { graph, rules, flat_fare: flat } = net;
  if (from === to) return null;
  const { meters, path } = shortestPath(graph.adj, from, to);
  const straight = haversineMeters(graph.stations[from], graph.stations[to]);
  const cm = compositeMiles(meters, straight);
  const line = wholeLine(graph.patterns, from, to);
  const amount = fare(cm, line.composite_mi, rules, { reduced });
  const today = reduced ? roundDown5(flat * rules.reduced_share) : flat;
  const share = Math.min(1, cm / line.composite_mi);
  return {
    path, stops: path.length - 1,
    railMi: meters / METERS_PER_MILE, straightMi: straight / METERS_PER_MILE, compositeMi: cm,
    line: line.name, lineMi: line.composite_mi, share, raw: rules.max * share,
    reduced, fare: amount, today, saving: Math.max(0, today - amount),
    capped: amount >= rules.max, floored: amount === rules.min && rules.max * share < rules.min,
  };
}
