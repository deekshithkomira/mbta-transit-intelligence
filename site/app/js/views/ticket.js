import { ST, net, stationName } from "../data.js";
import { maxFare, quoteFor, tapIn, tapOut } from "../ride.js";
import * as S from "../store.js";
import { confirmSheet, esc, fmtDate, fmtTime, icon, lineDots, money, openSheet, pickStation, toast } from "../ui.js";
import { breakdown } from "./plan.js";

let timers = [];
const clear = () => { timers.forEach(clearInterval); timers = []; };

export function render(root, ctx) {
  clear();
  const st = S.get(), a = st.active;
  if (!a) return ready(root, ctx);
  const est = a.planned ? quoteFor(a.from, a.planned, a.reduced) : null;
  root.innerHTML = `
    <header class="top"><h1>Your ticket</h1></header>
    <section class="ticket">
      <div class="ticket-head"><span class="live-dot"></span><b>Tapped in</b><span class="muted">· ${esc(stationName(a.from))}</span> ${lineDots(ST[a.from].lines)}</div>
      <div class="qr" id="qr" role="img" aria-label="Entry ticket QR code"></div>
      <div class="qr-refresh"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" class="ring-bg"/><circle cx="10" cy="10" r="8" id="qr-ring" class="ring-fg"/></svg>
        <span id="qr-note">Code refreshes every 30 s</span></div>
      <div class="timer" id="timer">0:00</div>
      <div class="muted small">Ticket ${esc(a.id)} · ${esc(S.RIDER_TYPES[a.riderType].label)}</div>
      <div class="tear"></div>
      <div class="rows">
        <div class="row"><span>Entered</span><span>${fmtTime(a.at)}</span></div>
        <div class="row"><span>Heading to</span><span>${a.planned ? esc(stationName(a.planned)) : "—"}</span></div>
        <div class="row"><span>Estimated fare</span><span><b>${est ? money(est.fare) : "Set on tap-out"}</b></span></div>
        <div class="row"><span>Most this trip can cost</span><span>${money(maxFare())}</span></div>
      </div>
    </section>
    <p class="fine center">Hold your screen to the gate reader. Get off early or ride further — you pay for the distance you actually travel.</p>
    <div class="btn-col">
      <button class="btn big" data-act="out">Tap out</button>
      <button class="btn ghost" data-act="missed">Simulate a missed tap-out</button>
    </div>`;

  const qrEl = root.querySelector("#qr"), ring = root.querySelector("#qr-ring");
  const drawQR = () => {
    const slot = Math.floor(Date.now() / 30000);
    const q = qrcode(0, "M");
    q.addData(JSON.stringify({ v: 1, t: a.id, o: a.from, at: a.at, r: a.riderType, s: slot }));
    q.make(); qrEl.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    qrEl.dataset.slot = slot;
  };
  const tick = () => {
    if (!root.querySelector("#timer")) return clear();
    const s = Math.floor((Date.now() - a.at) / 1000);
    root.querySelector("#timer").textContent = s >= 3600
      ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
      : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const left = 30 - (Math.floor(Date.now() / 1000) % 30);
    ring.style.strokeDasharray = `${(left / 30 * 50.3).toFixed(1)} 50.3`;
    if (String(Math.floor(Date.now() / 30000)) !== qrEl.dataset.slot) drawQR();
  };
  drawQR(); tick(); timers.push(setInterval(tick, 1000));

  root.querySelector('[data-act="out"]').onclick = async () => {
    const id = await pickStation({ net, title: "Where are you tapping out?", recent: [a.planned, ...S.get().recent].filter(Boolean) });
    if (!id) return;
    finish(ctx, id);
  };
  root.querySelector('[data-act="missed"]').onclick = async () => {
    if (await confirmSheet({ title: "Simulate a missed tap-out?", body: `Leaving without tapping out charges <b>${money(maxFare())}</b>, today's full fare. That's what stops anyone gaming distance pricing.`, ok: "Leave without tapping" }))
      finish(ctx, null);
  };
}

function finish(ctx, exit) {
  const res = tapOut(exit);
  clear();
  if (res) openReceipt(res.trip, res.q);
  ctx.go("home");
}

function ready(root, ctx) {
  const st = S.get();
  const from = ctx.plan.from || st.recent[0] || "place-coecl";
  root.innerHTML = `
    <header class="top"><h1>Ticket</h1></header>
    <section class="card center ready">
      <div class="ready-icon">${icon("ticket")}</div>
      <h2>Ready to ride</h2>
      <p class="muted">Tap in at the gate. Your fare is set when you tap out, by the distance you travel.</p>
      <button class="od-field" data-pick><small>Tapping in at</small><span>${lineDots(ST[from].lines)} ${esc(stationName(from))}</span></button>
      <div class="rows">
        <div class="row"><span>Balance</span><span><b>${money(st.balance)}</b></span></div>
        <div class="row"><span>Needed to enter</span><span>${money(maxFare())}</span></div>
      </div>
      <button class="btn big go" data-act="in">Tap in</button>
      ${st.balance < maxFare() ? `<p class="warn-text small">${icon("alert")} Add money first${st.autoReload.enabled ? " — or auto-reload will top you up" : ""}.</p>` : ""}
    </section>`;
  root.querySelector("[data-pick]").onclick = async () => {
    const id = await pickStation({ net, title: "Where are you tapping in?", recent: st.recent });
    if (id) { ctx.plan.from = id; ctx.refresh(); }
  };
  root.querySelector('[data-act="in"]').onclick = () => {
    const r = tapIn(from, ctx.plan.to);
    if (!r.ok) { toast(r.msg, "warn"); if (r.needFunds) ctx.openTopUp(); return; }
    toast(`Tapped in at ${stationName(from)}`, "good"); ctx.refresh();
  };
}

export function openReceipt(trip, q = null) {
  const qq = q || (trip.to && trip.to !== trip.from ? quoteFor(trip.from, trip.to, !!S.RIDER_TYPES[trip.riderType]?.reduced) : null);
  openSheet(`<div class="receipt">
      <div class="r-icon ${trip.status === "missed" ? "warn" : ""}">${icon(trip.status === "missed" ? "alert" : "check")}</div>
      <h2 class="sheet-title">${trip.status === "missed" ? "Missed tap-out" : trip.status === "same-station" ? "No charge" : "Trip complete"}</h2>
      <div class="r-amt">${money(trip.charged)}</div>
      <p class="muted">${esc(stationName(trip.from))} → ${trip.to ? esc(stationName(trip.to)) : "unknown exit"}</p>
      ${trip.saving > 0 ? `<span class="save">Saved ${money(trip.saving)} vs the flat fare</span>` : ""}
      ${trip.capApplied ? `<p class="good small">${icon("cap")} Weekly fare cap applied — ${trip.charged ? "you only paid up to the cap" : "this ride was free"}.</p>` : ""}
      ${trip.status === "missed" ? `<p class="small muted">Without a tap-out the trip is charged today's full fare. Tap out next time to pay only for your distance.</p>` : ""}
      ${trip.status === "same-station" ? `<p class="small muted">You entered and exited at the same station, so there's no charge.</p>` : ""}
    </div>
    <div class="rows">
      <div class="row"><span>Date</span><span>${fmtDate(trip.at)}</span></div>
      <div class="row"><span>Time</span><span>${fmtTime(trip.at)} – ${fmtTime(trip.endAt)}</span></div>
      <div class="row"><span>Ticket</span><span>${esc(trip.id)}</span></div>
      ${trip.fare !== trip.charged ? `<div class="row"><span>Distance fare</span><span>${money(trip.fare)}</span></div>` : ""}
      <div class="row total"><span>Charged</span><span>${money(trip.charged)}</span></div>
    </div>
    ${qq ? breakdown(qq, S.RIDER_TYPES[trip.riderType]?.label || "Reduced fare") : ""}
    <div class="btn-row"><button class="btn ghost" data-report>${icon("flag")} Report a problem</button><button class="btn" data-close>Done</button></div>`,
  { label: "Trip receipt" }).el.querySelector("[data-report]").onclick = () => reportProblem(trip);
}

function reportProblem(trip) {
  const { el, close } = openSheet(`<h2 class="sheet-title">Report a problem</h2>
    <p class="muted small">${esc(stationName(trip.from))} → ${trip.to ? esc(stationName(trip.to)) : "no tap-out"} · ${fmtDate(trip.at)}</p>
    <form id="rp">${["I was charged for a missed tap-out but I did tap out", "The exit station is wrong", "The gate didn't read my ticket", "Something else"].map((r, i) =>
      `<label class="choice line"><input type="radio" name="r" value="${i}" ${i === 0 ? "checked" : ""}><span>${r}</span></label>`).join("")}
      <label class="field"><span>Details (optional)</span><textarea name="d" rows="3" maxlength="300"></textarea></label>
      <button class="btn big" type="submit">Submit</button></form>`, { label: "Report a problem" });
  el.querySelector("#rp").onsubmit = e => {
    e.preventDefault(); close();
    S.notify("Report received", `We're reviewing ticket ${trip.id}. Demo app: reports aren't sent anywhere.`, "info");
    toast("Thanks — report received", "good");
  };
}
