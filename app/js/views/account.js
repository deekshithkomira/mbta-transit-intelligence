import { R, net } from "../data.js";
import * as S from "../store.js";
import { confirmSheet, download, esc, icon, money, openSheet, timeAgo, toast } from "../ui.js";

const W = net.research?.wmata || { base: 2.25, per_mile: 0.45, max: 6.75, offpeak_min: 2.25, offpeak_max: 2.5 };

export function render(root, ctx, sub) {
  if (sub && PAGES[sub]) return page(root, ctx, sub);
  const st = S.get(), p = st.profile;
  root.innerHTML = `
    <header class="top"><h1>Account</h1></header>
    <section class="card profile">
      <div class="avatar lg">${esc((p.name || "R")[0].toUpperCase())}</div>
      <div class="grow"><b>${esc(p.name || "Rider")}</b><small>${esc(p.email || "No email added")}</small>
        <span class="pill">${esc(S.riderType().label)}${S.riderType().reduced ? (p.verified ? " · verified" : " · not verified") : ""}</span></div>
      <button class="icon-btn" data-sub="profile" aria-label="Edit profile">${icon("edit")}</button></section>
    <section class="card menu">
      ${row("profile", "user", "Profile", "Name and email")}
      ${row("rider", "shield", "Rider type & reduced fare", S.riderType().label)}
      ${row("notifications", "bell", "Notifications", "Receipts, balance, alerts")}
      ${row("appearance", "moon", "Appearance & accessibility", themeLabel(st.settings.theme))}
    </section>
    <section class="card menu">
      ${row("fares", "info", "How fares work", "Washington Metrorail model")}
      ${row("help", "help", "Help & FAQ", "Tapping, refunds, the fare cap")}
      ${row("privacy", "lock", "Privacy & data", "Export or delete your data")}
      ${row("about", "train", "About Short-Hop", "Sources and version")}
    </section>
    <button class="btn ghost danger-text" data-act="signout">${icon("logout")} Sign out & reset this device</button>
    <p class="fine center">Concept app · demo money only · not affiliated with the MBTA</p>`;
  root.querySelectorAll("[data-sub]").forEach(b => (b.onclick = () => ctx.go(`account/${b.dataset.sub}`)));
  root.querySelector('[data-act="signout"]').onclick = async () => {
    if (await confirmSheet({ title: "Sign out and reset?", body: "This removes your profile, balance, cards and trips from this device. It can't be undone.", ok: "Reset", danger: true })) {
      S.resetAll(); ctx.go("home");
    }
  };
}

const row = (sub, ic, title, note) => `<button class="list-row" data-sub="${sub}"><span class="lead">${icon(ic)}</span>
  <span class="grow"><b>${title}</b><small>${esc(note)}</small></span>${icon("chevron", "dim")}</button>`;
const themeLabel = t => ({ system: "Match system", light: "Light", dark: "Dark" })[t];

const PAGES = {
  profile: { title: "Profile", body: () => {
    const p = S.get().profile;
    return `<form id="pf" class="card" novalidate>
      <label class="field"><span>First name</span><input name="name" maxlength="30" value="${esc(p.name)}" required></label>
      <label class="field"><span>Email for receipts</span><input name="email" type="email" maxlength="60" value="${esc(p.email)}"></label>
      <p class="err" id="pf-err" role="alert"></p><button class="btn big" type="submit">Save</button></form>`;
  }, bind: (el, ctx) => {
    el.querySelector("#pf").onsubmit = e => {
      e.preventDefault();
      const name = e.target.name.value.trim(), email = e.target.email.value.trim();
      if (!name) return (el.querySelector("#pf-err").textContent = "Name can't be empty.");
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return (el.querySelector("#pf-err").textContent = "That email doesn't look right.");
      S.update(s => { s.profile.name = name; s.profile.email = email; }); toast("Profile saved", "good"); ctx.go("account");
    };
  } },

  rider: { title: "Rider type & reduced fare", body: () => {
    const p = S.get().profile, active = !!S.get().active;
    return `<section class="card"><p class="muted small">Reduced fares are half the regular fare (rounded down to $0.05), and the weekly cap drops to ${money(S.WEEK_CAP.reduced)}.</p>
      ${active ? `<p class="warn-text small">${icon("alert")} Finish your current trip before changing rider type.</p>` : ""}
      <div class="choice-grid">${Object.entries(S.RIDER_TYPES).map(([k, r]) => `<label class="choice"><input type="radio" name="rt" value="${k}" ${p.riderType === k ? "checked" : ""} ${active ? "disabled" : ""}>
        <span><b>${r.label}</b><small>${r.note}</small></span></label>`).join("")}</div></section>
      ${S.riderType().reduced ? `<section class="card"><div class="card-h"><h3>Eligibility</h3>${p.verified ? `<span class="pill good">Verified</span>` : ""}</div>
        <p class="muted small">In a real launch you'd verify once — student ID, Senior CharlieCard, TAP card, or enrollment in SNAP/MassHealth. Here it's a demo toggle.</p>
        <button class="btn ${p.verified ? "ghost" : ""}" data-verify>${p.verified ? "Remove verification" : "Verify eligibility (demo)"}</button></section>` : ""}`;
  }, bind: (el, ctx) => {
    el.querySelectorAll('input[name="rt"]').forEach(r => (r.onchange = () => {
      S.update(s => { s.profile.riderType = r.value; s.profile.verified = false; }); toast(`Rider type: ${S.riderType().label}`); ctx.refresh();
    }));
    const v = el.querySelector("[data-verify]");
    if (v) v.onclick = () => { S.update(s => { s.profile.verified = !s.profile.verified; }); toast(S.get().profile.verified ? "Eligibility verified" : "Verification removed"); ctx.refresh(); };
  } },

  notifications: { title: "Notifications", body: () => {
    const n = S.get().settings.notify;
    return `<section class="card">${[["receipts", "Trip receipts", "After every tap-out"], ["lowBalance", "Low balance & auto-reload", "When you drop below $5"], ["alerts", "Service alerts", "Delays on lines you ride"]]
      .map(([k, t, d]) => `<div class="list-row"><span class="grow"><b>${t}</b><small>${d}</small></span>
        <label class="switch"><input type="checkbox" data-n="${k}" ${n[k] ? "checked" : ""} aria-label="${t}"><i></i></label></div>`).join("")}</section>
      <p class="fine center">Notifications appear in the app's inbox (the bell on Home).</p>`;
  }, bind: el => {
    el.querySelectorAll("[data-n]").forEach(c => (c.onchange = () => S.update(s => { s.settings.notify[c.dataset.n] = c.checked; })));
  } },

  appearance: { title: "Appearance & accessibility", body: () => {
    const s = S.get().settings;
    return `<section class="card"><div class="card-h"><h3>Theme</h3></div><div class="seg">${["system", "light", "dark"].map(t =>
      `<button data-theme="${t}" aria-pressed="${s.theme === t}">${themeLabel(t)}</button>`).join("")}</div></section>
      <section class="card">${[["largeText", "Larger text", "Easier to read on the go"], ["reduceMotion", "Reduce motion", "Turn off animations"]].map(([k, t, d]) =>
        `<div class="list-row"><span class="grow"><b>${t}</b><small>${d}</small></span><label class="switch"><input type="checkbox" data-s="${k}" ${s[k] ? "checked" : ""} aria-label="${t}"><i></i></label></div>`).join("")}</section>`;
  }, bind: (el, ctx) => {
    el.querySelectorAll("[data-theme]").forEach(b => (b.onclick = () => { S.update(s => { s.settings.theme = b.dataset.theme; }); ctx.applySettings(); ctx.refresh(); }));
    el.querySelectorAll("[data-s]").forEach(c => (c.onchange = () => { S.update(s => { s.settings[c.dataset.s] = c.checked; }); ctx.applySettings(); }));
  } },

  fares: { title: "How fares work", body: () => `
    <section class="card prose"><p>Today every MBTA subway trip costs <b>$2.40</b>, one stop or thirteen. Short-Hop charges by distance using
      <b>Washington Metrorail's fare model</b>, scaled so the longest trips cost exactly today's fare. <b>No trip ever costs more than now.</b></p></section>
    <section class="card"><table class="t"><tr><th></th><th class="n">Washington</th><th class="n">Short-Hop</th></tr>
      <tr><td>Base fare · first 3 composite miles</td><td class="n">${money(W.base)}</td><td class="n">${money(R.base)}</td></tr>
      <tr><td>Each extra mile (20% of base)</td><td class="n">${money(W.per_mile)}</td><td class="n">${money(R.per_mile)}</td></tr>
      <tr><td>Maximum (3 × base)</td><td class="n">${money(W.max)}</td><td class="n">${money(R.max)}</td></tr>
      <tr><td>Nights after 9:30pm &amp; weekends</td><td class="n">${money(W.offpeak_min)}–${money(W.offpeak_max)}</td><td class="n">${money(R.offpeak_min)}–${money(R.offpeak_max)}</td></tr>
      <tr><td>Reduced fare</td><td class="n">50%</td><td class="n">50%</td></tr>
      <tr><td>Missed tap-out</td><td class="n">base fare</td><td class="n">${money(R.missed_tap_out)}</td></tr>
      <tr><td>Weekly cap</td><td class="n">—</td><td class="n">${money(S.WEEK_CAP.regular)}</td></tr></table>
      <p class="fine">Composite miles = average of track and straight-line distance. Fares round up to $0.05. Boston charges today's fare for a missed tap-out because its gates check entry only.</p></section>
    <section class="card"><div class="card-h"><h3>Example trips</h3></div><table class="t"><tr><th>Trip</th><th class="n">mi</th><th class="n">Peak</th><th class="n">Night</th><th class="n">Reduced</th></tr>
      ${net.examples.map(e => `<tr><td>${esc(e.from)} → ${esc(e.to)}</td><td class="n">${e.composite_mi.toFixed(1)}</td><td class="n">${money(e.fare)}</td><td class="n">${money(e.offpeak)}</td><td class="n">${money(e.reduced)}</td></tr>`).join("")}</table></section>` },

  help: { title: "Help & FAQ", body: () => `<section class="card faq">${[
    ["How do I pay for a trip?", "Tap in at the gate with your ticket (the QR code on the Ticket tab), ride, then tap out where you get off. The fare is set when you tap out."],
    ["What if I forget to tap out?", `You're charged today's full fare (${money(R.missed_tap_out)}) — never more than you pay now. If you did tap out and were charged anyway, open the trip and tap “Report a problem”.`],
    ["Why does the QR code keep changing?", "It refreshes every 30 seconds so a screenshot can't be reused by someone else."],
    ["What's the weekly fare cap?", `Once you've spent ${money(S.WEEK_CAP.regular)} (the price of a 7-day pass) in any 7 days, the rest of your rides that week are free.`],
    ["Do I need money on the card to enter?", "Yes — enough for the most a trip can cost. Turn on auto-reload in Wallet and you'll never be stuck at the gate."],
    ["Can I ride further than I planned?", "Yes. Your planned destination is only an estimate; you pay for where you actually tap out."],
    ["Is this the official MBTA app?", "No. Short-Hop is an independent concept built on MBTA open data. All money in it is simulated."],
  ].map(([q, a]) => `<details><summary>${q}${icon("chevron")}</summary><p>${a}</p></details>`).join("")}</section>` },

  privacy: { title: "Privacy & data", body: () => `
    <section class="card prose"><p>${icon("lock")} Everything — your profile, balance, cards and trips — is stored <b>only in this browser</b>. Nothing is sent to a server. Card numbers are never stored: only the brand and last four digits.</p>
      <p class="muted small">Live train times and alerts are fetched from the public MBTA API; no personal data is included in those requests.</p></section>
    <section class="card menu">
      <button class="list-row" data-a="export"><span class="lead">${icon("download")}</span><span class="grow"><b>Download my data</b><small>JSON file</small></span></button>
      <button class="list-row danger-text" data-a="delete"><span class="lead">${icon("trash")}</span><span class="grow"><b>Delete all data</b><small>Resets the app on this device</small></span></button></section>`,
  bind: (el, ctx) => {
    el.querySelector('[data-a="export"]').onclick = () => { download("short-hop-data.json", JSON.stringify(S.get(), null, 2), "application/json"); toast("Download started"); };
    el.querySelector('[data-a="delete"]').onclick = async () => {
      if (await confirmSheet({ title: "Delete all data?", body: "This permanently removes everything Short-Hop stored on this device.", ok: "Delete", danger: true })) { S.resetAll(); ctx.go("home"); }
    };
  } },

  about: { title: "About Short-Hop", body: () => `
    <section class="card prose"><p><b>Short-Hop</b> is a concept rider app from the <a href="../" target="_blank" rel="noopener">MBTA Transit Intelligence</a> project. It shows how Boston's subway could charge by distance — a one-stop ride shouldn't cost the same as a thirteen-stop ride.</p>
      <p class="muted small">Fare model: <a href="https://www.wmata.com/content/dam/wmata-com/about/public-records/Tariff%2049.pdf" target="_blank" rel="noopener">WMATA Tariff 49</a> (effective July 1, 2026).
        Today's fare: <a href="https://www.mbta.com/fares/subway-fares" target="_blank" rel="noopener">MBTA subway fares</a>. Distances: MBTA Rapid Transit Stop Distances.
        Stations, live trains and alerts: MBTA V3 API. Map: © OpenStreetMap.</p>
      <p class="fine">Version 2.0 · not affiliated with the MBTA or WMATA · demo money only.</p></section>` },
};

function page(root, ctx, sub) {
  const pg = PAGES[sub];
  root.innerHTML = `<header class="top sub"><button class="icon-btn" data-back aria-label="Back">${icon("back")}</button><h1>${pg.title}</h1></header>${pg.body()}`;
  root.querySelector("[data-back]").onclick = () => ctx.go("account");
  pg.bind && pg.bind(root, ctx);
}

export function openInbox(ctx) {
  const st = S.get();
  const { el, close } = openSheet(`<div class="card-h"><h2 class="sheet-title">Notifications</h2>
      ${st.notifications.length ? `<button class="link" data-clear>Clear all</button>` : ""}</div>
    ${st.notifications.length ? st.notifications.map(n => `<div class="note ${n.read ? "" : "unread"} ${n.kind}"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${timeAgo(n.at)}</small></div>`).join("")
      : `<div class="empty">${icon("bell")}<p>You're all caught up.</p></div>`}`, { label: "Notifications", onClose: () => ctx.refresh() });
  S.update(s => s.notifications.forEach(n => (n.read = true)));
  const c = el.querySelector("[data-clear]");
  if (c) c.onclick = () => { S.update(s => { s.notifications = []; }); close(); };
}
