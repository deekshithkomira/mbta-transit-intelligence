import { stationName } from "../data.js";
import * as live from "../live.js";
import { quoteFor } from "../ride.js";
import * as S from "../store.js";
import { LINE_COLOR, esc, greeting, icon, money, routeLine, timeAgo } from "../ui.js";

export function shCard(st = S.get()) {
  const no = st.profile.cardNo;
  return `<div class="sh-card">
    <div class="sh-card-top"><span class="sh-brand">Short-Hop</span><span class="pill">${esc(S.riderType().label)}</span></div>
    <div class="sh-bal"><small>Balance</small><b data-balance>${money(st.balance)}</b></div>
    <div class="sh-card-bottom"><span>•••• ${no.slice(-4)}</span><span>${esc(st.profile.name || "Rider")}</span></div></div>`;
}

export function capMeter(st = S.get()) {
  const cap = S.weekCap(), spent = S.weekSpent(st.trips), pct = Math.min(1, spent / cap);
  return `<div class="cap">
    <svg viewBox="0 0 44 44" class="ring"><circle cx="22" cy="22" r="18" class="ring-bg"/>
      <circle cx="22" cy="22" r="18" class="ring-fg" style="stroke-dasharray:${(pct * 113.1).toFixed(1)} 113.1"/></svg>
    <div><b>${money(spent)} <span class="muted">of ${money(cap)}</span></b>
      <small>${pct >= 1 ? "Weekly cap reached — rides are free for the rest of this 7-day window" :
        `Spend ${money(cap - spent)} more in 7 days and the rest of the week is free`}</small></div></div>`;
}

export function tripRow(t) {
  return `<button class="list-row" data-trip="${t.id}">
    <span class="lead ${t.status === "missed" ? "warn" : ""}">${icon(t.status === "missed" ? "alert" : "train")}</span>
    <span class="grow"><b>${esc(stationName(t.from))} → ${t.to ? esc(stationName(t.to)) : "no tap-out"}</b>
      <small>${timeAgo(t.at)} · ${t.status === "completed" ? `${t.compositeMi.toFixed(1)} mi` : t.status === "missed" ? "missed tap-out" : "same station"}${t.capApplied ? " · capped" : ""}</small></span>
    <span class="amt">${money(t.charged)}${t.saving > 0 ? `<small class="good">saved ${money(t.saving)}</small>` : ""}</span></button>`;
}

export function render(root, ctx) {
  const st = S.get();
  const unread = st.notifications.filter(n => !n.read).length;
  const a = st.active;
  root.innerHTML = `
    <header class="top">
      <div><small class="muted">${greeting()}</small><h1>${esc(st.profile.name || "Rider")}</h1></div>
      <div class="top-actions">
        <button class="icon-btn" data-go="inbox" aria-label="Notifications${unread ? `, ${unread} unread` : ""}">${icon("bell")}${unread ? `<i class="badge">${unread}</i>` : ""}</button>
        <button class="avatar" data-go="account" aria-label="Account">${esc((st.profile.name || "R")[0].toUpperCase())}</button>
      </div></header>
    ${a ? `<button class="active-banner" data-go="ticket"><span class="live-dot"></span>
      <span class="grow"><b>On a trip from ${esc(stationName(a.from))}</b><small data-elapsed="${a.at}">Tap to show your ticket</small></span>${icon("chevron")}</button>` : ""}
    ${shCard(st)}
    <div class="quick">
      <button data-go="plan">${icon("plan")}<span>Plan trip</span></button>
      <button data-go="ticket">${icon("ticket")}<span>${a ? "Ticket" : "Tap in"}</span></button>
      <button data-act="topup">${icon("plus")}<span>Add money</span></button>
      <button data-go="activity">${icon("activity")}<span>Activity</span></button>
    </div>
    <section class="card"><div class="card-h"><h3>Weekly fare cap</h3><button class="link" data-act="capinfo">How it works</button></div>${capMeter(st)}</section>
    ${st.favorites.length ? `<section class="card"><div class="card-h"><h3>Saved routes</h3></div><div class="fav-list">${st.favorites.map(f => {
      const q = quoteFor(f.from, f.to);
      return `<button class="fav" data-fav="${f.from}|${f.to}"><span>${icon("star", "filled")}</span><span class="grow"><b>${esc(stationName(f.from))} → ${esc(stationName(f.to))}</b>
        <small>${q ? `${q.compositeMi.toFixed(1)} mi · ${q.stops} stops` : ""}</small></span><span class="amt">${q ? money(q.fare) : ""}</span></button>`;
    }).join("")}</div></section>` : ""}
    <section class="card"><div class="card-h"><h3>Service alerts</h3><span class="live-tag">LIVE</span></div>
      <div id="alerts"><div class="skeleton"></div><div class="skeleton short"></div></div></section>
    <section class="card"><div class="card-h"><h3>Recent trips</h3>${st.trips.length ? `<button class="link" data-go="activity">See all</button>` : ""}</div>
      ${st.trips.length ? st.trips.slice(0, 3).map(tripRow).join("") :
        `<div class="empty">${icon("train")}<p>No trips yet.</p><button class="btn small" data-go="plan">Plan your first trip</button></div>`}</section>`;

  root.querySelectorAll("[data-fav]").forEach(b => (b.onclick = () => {
    const [from, to] = b.dataset.fav.split("|"); ctx.plan.from = from; ctx.plan.to = to; ctx.go("plan");
  }));
  root.querySelector('[data-act="topup"]').onclick = () => ctx.openTopUp();
  root.querySelector('[data-act="capinfo"]').onclick = () => ctx.openCapInfo();
  root.querySelectorAll("[data-trip]").forEach(b => (b.onclick = () => ctx.openTrip(b.dataset.trip)));

  live.alerts(3).then(list => {
    const el = root.querySelector("#alerts"); if (!el) return;
    if (list === null) { el.innerHTML = `<p class="muted small">Live alerts are unavailable offline.</p>`; return; }
    el.innerHTML = list.length ? list.map(x => `<div class="alert-row"><span class="routes">${x.routes.map(routeLine)
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).map(l => `<i style="background:${LINE_COLOR[l] || "#5b6780"}"></i>`).join("")}</span>
      <span>${esc(x.header)}</span></div>`).join("") : `<p class="good small">${icon("check")} No major subway alerts right now.</p>`;
  });
}
