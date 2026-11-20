// Live MBTA data (V3 API, public, CORS-enabled). The anonymous budget is ~20 requests a
// minute per IP, so responses are cached for 30 s and nothing is fetched while hidden.
const API = "https://api-v3.mbta.com";
const TTL = 30_000;
const cache = new Map();
let backoffUntil = 0;

async function getJSON(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  if (Date.now() < backoffUntil || document.hidden) return hit?.data ?? null;
  try {
    const r = await fetch(API + path, { headers: { accept: "application/vnd.api+json" } });
    if (r.status === 429) { backoffUntil = Date.now() + 60_000; return hit?.data ?? null; }
    if (!r.ok) return hit?.data ?? null;
    const data = await r.json();
    cache.set(path, { at: Date.now(), data });
    return data;
  } catch {
    return hit?.data ?? null;   // offline: keep the last good answer
  }
}

/** Next departures at a parent station, soonest first. */
export async function departures(stationId, limit = 6) {
  const d = await getJSON(`/predictions?filter[stop]=${encodeURIComponent(stationId)}` +
    `&filter[route_type]=0,1&sort=departure_time&include=trip,route&page[limit]=${limit * 2}`);
  if (!d) return null;
  const trips = Object.fromEntries((d.included || []).filter(x => x.type === "trip").map(t => [t.id, t.attributes]));
  const now = Date.now();
  return d.data
    .filter(p => p.attributes.departure_time)
    .map(p => {
      const t = new Date(p.attributes.departure_time).getTime();
      return { route: p.relationships.route.data.id, mins: Math.max(0, Math.round((t - now) / 60000)),
        headsign: trips[p.relationships.trip.data?.id]?.headsign || "", status: p.attributes.status };
    })
    .filter(p => p.mins < 90)
    .slice(0, limit);
}

/** Current subway alerts (delays, suspensions, shuttles, station issues). */
export async function alerts(limit = 4) {
  const d = await getJSON(`/alerts?filter[route_type]=0,1&filter[datetime]=NOW&sort=-severity&page[limit]=25`);
  if (!d) return null;
  const seen = new Set();
  return d.data
    .map(a => ({ id: a.id, header: a.attributes.short_header || a.attributes.header, effect: a.attributes.effect,
      severity: a.attributes.severity,
      routes: [...new Set((a.attributes.informed_entity || []).map(e => e.route).filter(Boolean))] }))
    .filter(a => a.effect !== "ELEVATOR_CLOSURE" && a.effect !== "ESCALATOR_CLOSURE" && !seen.has(a.header) && seen.add(a.header))
    .slice(0, limit);
}
