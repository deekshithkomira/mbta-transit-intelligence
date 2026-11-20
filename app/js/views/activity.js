import { FLAT, R, stationName } from "../data.js";
import * as S from "../store.js";
import { download, esc, fmtDate, icon, money } from "../ui.js";
import { tripRow } from "./home.js";

let filter = "all";

export function render(root, ctx) {
  const st = S.get();
  const now = new Date(), monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const month = st.trips.filter(t => t.at >= monthStart);
  const spent = month.reduce((s, t) => s + t.charged, 0), saved = month.reduce((s, t) => s + t.saving, 0);
  const miles = month.reduce((s, t) => s + (t.compositeMi || 0), 0);

  // last 14 days: what you paid vs what the flat fare would have cost
  const days = [...Array(14)].map((_, i) => {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (13 - i));
    const end = d.getTime() + 864e5, ts = st.trips.filter(t => t.at >= d.getTime() && t.at < end);
    const today = ts.reduce((s, t) => s + (S.RIDER_TYPES[t.riderType]?.reduced ? FLAT * R.reduced_share : FLAT), 0);
    return { d, paid: ts.reduce((s, t) => s + t.charged, 0), flat: today };
  });
  const top = Math.max(2.4, ...days.map(d => d.flat));
  const list = st.trips.filter(t => filter === "all" || (filter === "saved" ? t.saving > 0 : filter === "missed" ? t.status === "missed" : t.capApplied));
  const groups = {};
  list.forEach(t => (groups[fmtDate(t.at)] ||= []).push(t));

  root.innerHTML = `
    <header class="top"><h1>Activity</h1>
      <button class="icon-btn" data-act="csv" aria-label="Export trips as CSV" ${st.trips.length ? "" : "disabled"}>${icon("download")}</button></header>
    <section class="card">
      <div class="card-h"><h3>${now.toLocaleDateString([], { month: "long" })}</h3></div>
      <div class="stats3"><div><b>${month.length}</b><small>trips</small></div><div><b>${money(spent)}</b><small>spent</small></div>
        <div><b class="good">${money(saved)}</b><small>saved</small></div></div>
      <p class="muted small">${miles.toFixed(1)} composite miles ridden this month.</p>
      <div class="chart" role="img" aria-label="Spending over the last 14 days compared with the flat fare">
        ${days.map(d => `<div class="bar"><i class="flat" style="height:${(d.flat / top) * 100}%" ${d.flat ? "" : "data-zero"}></i><i class="paid" style="height:${(d.paid / top) * 100}%" ${d.paid ? "" : "data-zero"}></i>
          <small>${d.d.getDate()}</small></div>`).join("")}</div>
      <div class="legend"><span><i class="paid"></i>You paid</span><span><i class="flat"></i>Flat fare would cost</span></div>
    </section>
    <div class="chips scroll" role="group" aria-label="Filter trips">${[["all", "All"], ["saved", "Saved money"], ["capped", "Capped"], ["missed", "Missed tap-out"]].map(([k, l]) =>
      `<button class="chip-btn" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}</div>
    ${list.length ? Object.entries(groups).map(([day, ts]) => `<section class="card"><div class="card-h"><h3>${day}</h3></div>${ts.map(tripRow).join("")}</section>`).join("")
      : `<section class="card empty">${icon("activity")}<p>${st.trips.length ? "No trips match this filter." : "Your trips will appear here."}</p>
         ${st.trips.length ? "" : `<button class="btn small" data-go="plan">Plan a trip</button>`}</section>`}`;

  root.querySelectorAll("[data-f]").forEach(b => (b.onclick = () => { filter = b.dataset.f; ctx.refresh(); }));
  root.querySelectorAll("[data-trip]").forEach(b => (b.onclick = () => ctx.openTrip(b.dataset.trip)));
  root.querySelector('[data-act="csv"]').onclick = () => {
    const rows = [["ticket", "date", "from", "to", "status", "composite_miles", "distance_fare", "charged", "saved_vs_flat", "cap_applied", "period"],
      ...st.trips.map(t => [t.id, new Date(t.at).toISOString(), stationName(t.from), t.to ? stationName(t.to) : "", t.status,
        (t.compositeMi || 0).toFixed(2), t.fare.toFixed(2), t.charged.toFixed(2), t.saving.toFixed(2), t.capApplied, t.period])];
    download("short-hop-trips.csv", rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
  };
}
