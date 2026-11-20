import { periodFor } from "../../fare.js";
import { R, ST, net, stationName } from "../data.js";
import * as live from "../live.js";
import { quoteFor, tapIn } from "../ride.js";
import * as S from "../store.js";
import { LINE_COLOR, esc, icon, lineDots, money, pickStation, routeLine, toast } from "../ui.js";

export const periodLabel = p => (p === "offpeak" ? "Night & weekend" : "Peak");

export function breakdown(q, reducedLabel) {
  const capNote = q.period === "offpeak" ? `Night & weekend cap ${money(R.offpeak_max)}` : `Cap ${money(R.max)} (today's fare)`;
  return `<details class="breakdown"><summary>How this fare is calculated ${icon("chevron")}</summary>
    <div class="rows">
      <div class="row"><span>Track distance</span><span>${q.railMi.toFixed(2)} mi</span></div>
      <div class="row"><span>Straight-line distance</span><span>${q.straightMi.toFixed(2)} mi</span></div>
      <div class="row"><span>Composite miles (average)</span><span>${q.compositeMi.toFixed(2)} mi</span></div>
      <div class="row"><span>Base fare · first ${R.base_miles} mi</span><span>${money(R.base)}</span></div>
      ${q.extraMiles > 0 ? `<div class="row"><span>${q.extraMiles.toFixed(2)} extra mi × ${money(R.per_mile)}</span><span>+${money(R.per_mile * q.extraMiles)}</span></div>` : ""}
      <div class="row"><span>Round up to $0.05 · ${capNote}</span><span></span></div>
      ${q.reduced ? `<div class="row"><span>${esc(reducedLabel)} · 50%, rounded down</span><span></span></div>` : ""}
      <div class="row total"><span>${periodLabel(q.period)} fare</span><span>${money(q.fare)}</span></div>
    </div><p class="fine">Washington Metrorail's fare model (WMATA Tariff 49), scaled so the maximum equals today's $2.40.</p></details>`;
}

let map = null;
export function routeMap(el, path) {
  if (map) { map.remove(); map = null; }
  if (!window.L) return;
  map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  const pts = path.map(id => [ST[id].lat, ST[id].lon]);
  path.slice(1).forEach((id, i) => {
    const a = path[i], line = ST[a].lines.find(l => ST[id].lines.includes(l)) || ST[a].lines[0];
    L.polyline([pts[i], pts[i + 1]], { color: LINE_COLOR[line], weight: 6, opacity: .95 }).addTo(map);
  });
  pts.forEach((p, i) => L.circleMarker(p, { radius: i === 0 || i === pts.length - 1 ? 7 : 3.5, weight: 2,
    color: "#13203a", fillColor: "#fff", fillOpacity: 1 }).bindTooltip(ST[path[i]].name).addTo(map));
  map.fitBounds(L.latLngBounds(pts).pad(pts.length < 3 ? 1.2 : 0.25));
}

export function render(root, ctx) {
  const p = ctx.plan;
  const st = S.get();
  if (!p.from) p.from = st.recent[0] || "place-coecl";
  if (!p.to) p.to = st.recent.find(x => x !== p.from) || "place-armnl";
  const period = p.period === "auto" ? periodFor() : p.period;
  const q = p.from !== p.to ? quoteFor(p.from, p.to, period) : null;
  const fav = q && S.isFavorite(p.from, p.to);

  root.innerHTML = `
    <header class="top"><h1>Plan a trip</h1></header>
    <section class="card od">
      <button class="od-field" data-pick="from"><small>From</small><span>${lineDots(ST[p.from].lines)} ${esc(stationName(p.from))}</span></button>
      <button class="icon-btn swap" data-act="swap" aria-label="Swap stations">${icon("swap")}</button>
      <button class="od-field" data-pick="to"><small>To</small><span>${lineDots(ST[p.to].lines)} ${esc(stationName(p.to))}</span></button>
      <div class="seg" role="group" aria-label="Fare period">${["auto", "peak", "offpeak"].map(k => `<button data-period="${k}" aria-pressed="${p.period === k}">${
        k === "auto" ? `Now · ${periodLabel(periodFor())}` : periodLabel(k)}</button>`).join("")}</div>
    </section>
    ${q ? `<section class="card quote">
      <div class="quote-top"><div><small class="muted">Your fare</small><div class="big" data-fare>${money(q.fare)}</div></div>
        <button class="icon-btn ${fav ? "on" : ""}" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? "Remove saved route" : "Save route"}">${icon("star", fav ? "filled" : "")}</button></div>
      <div class="was">Flat fare today <s>${money(q.today)}</s>
        ${q.saving > 0 ? `<span class="save">You save ${money(q.saving)}</span>` : `<span class="save neutral">Same as today — never more</span>`}</div>
      <div class="stats3"><div><b>${q.stops}</b><small>${q.stops === 1 ? "stop" : "stops"}</small></div><div><b>${q.railMi.toFixed(1)} mi</b><small>track</small></div><div><b>${q.compositeMi.toFixed(1)} mi</b><small>composite</small></div></div>
      ${breakdown(q, S.riderType().label)}
      <div class="map" id="map"></div>
      <p class="path">${q.path.map(id => esc(ST[id].name)).join(" → ")}</p>
    </section>
    <section class="card"><div class="card-h"><h3>Next trains at ${esc(stationName(p.from))}</h3><span class="live-tag">LIVE</span></div>
      <div id="deps"><div class="skeleton"></div><div class="skeleton short"></div></div></section>
    <div class="sticky-cta"><button class="btn big go" data-act="tapin" ${st.active ? "disabled" : ""}>${st.active ? "You're already on a trip" : `Tap in at ${esc(stationName(p.from))}`}</button></div>`
    : `<section class="card empty">Pick two different stations.</section>`}`;

  root.querySelectorAll("[data-pick]").forEach(b => (b.onclick = async () => {
    const which = b.dataset.pick;
    const id = await pickStation({ net, title: which === "from" ? "Where from?" : "Where to?", recent: S.get().recent,
      exclude: which === "from" ? p.to : p.from });
    if (id) { p[which] = id; ctx.refresh(); }
  }));
  root.querySelector('[data-act="swap"]').onclick = () => { [p.from, p.to] = [p.to, p.from]; ctx.refresh(); };
  root.querySelectorAll("[data-period]").forEach(b => (b.onclick = () => { p.period = b.dataset.period; ctx.refresh(); }));
  if (!q) return;
  root.querySelector('[data-act="fav"]').onclick = () => {
    toast(S.toggleFavorite(p.from, p.to) ? "Route saved to Home" : "Route removed"); ctx.refresh();
  };
  root.querySelector('[data-act="tapin"]').onclick = () => {
    const r = tapIn(p.from, p.to);
    if (!r.ok) { toast(r.msg, "warn"); if (r.needFunds) ctx.openTopUp(); return; }
    toast(`Tapped in at ${stationName(p.from)}`, "good"); ctx.go("ticket");
  };
  routeMap(root.querySelector("#map"), q.path);
  live.departures(p.from, 5).then(list => {
    const el = root.querySelector("#deps"); if (!el) return;
    if (list === null) { el.innerHTML = `<p class="muted small">Live departures are unavailable offline.</p>`; return; }
    el.innerHTML = list.length ? list.map(d => `<div class="dep"><i style="background:${LINE_COLOR[routeLine(d.route)] || "#5b6780"}">${esc(d.route.replace("Green-", ""))}</i>
      <span class="grow">${esc(d.headsign || d.route)}</span><b>${d.mins === 0 ? "Now" : `${d.mins} min`}</b></div>`).join("")
      : `<p class="muted small">No departures in the next 90 minutes.</p>`;
  });
}
