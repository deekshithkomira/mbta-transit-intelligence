// Short-Hop rider app — concept / demo.  All money is simulated and stays on this device.
import { fare, periodFor, quote } from "./fare.js";

const net = await (await fetch("data/network.json")).json();
const R = net.rules, FLAT = net.flat_fare, ST = net.graph.stations;
const LINE_COLOR = { Red: "#da291c", Orange: "#ed8b00", Blue: "#003da5", Green: "#00843d", Mattapan: "#da291c" };
const CLASSES = {
  regular: { label: "Regular fare", note: "Adult full fare", reduced: false },
  student: { label: "Student", note: "Reduced fare · 50%", reduced: true },
  senior: { label: "Senior 65+", note: "Reduced fare · 50%", reduced: true },
  income: { label: "Income-eligible", note: "Reduced fare · 50%", reduced: true },
};
const MAX_RIDE_MS = 3 * 60 * 60 * 1000;   // no tap-out within 3 hours = missed tap-out

const $ = (sel, el = document) => el.querySelector(sel);
const money = x => "$" + (Math.round(x * 100) / 100).toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ids = Object.keys(ST).sort((a, b) => ST[a].name.localeCompare(ST[b].name));
const dots = id => `<span class="lines">${ST[id].lines.map(l => `<i class="dot" style="background:${LINE_COLOR[l]}"></i>`).join("")}</span>`;

// ------------------------------------------------------------------ state (per device)
const KEY = "shorthop.v1";
const DEFAULT = { balance: 20, riderClass: "regular", trips: [], active: null,
  plan: { from: "place-coecl", to: "place-armnl", period: "auto" } };
let state;
try { state = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { state = structuredClone(DEFAULT); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } };
const cls = () => CLASSES[state.riderClass] || CLASSES.regular;
const holdAmount = () => (cls().reduced ? Math.floor(FLAT * R.reduced_share * 20) / 20 : FLAT);

// ------------------------------------------------------------------ ui helpers
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2400);
}
function sheet(html) {
  const s = $("#sheet"), b = $("#sheet-backdrop");
  s.innerHTML = `<div class="grab"></div>${html}`; s.hidden = b.hidden = false;
  const close = () => { s.hidden = b.hidden = true; };
  b.onclick = close; s.querySelectorAll("[data-close]").forEach(x => (x.onclick = close));
  return close;
}
const options = sel => ids.map(id => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(ST[id].name)} · ${ST[id].lines.join("/")}</option>`).join("");
const periodLabel = p => (p === "offpeak" ? "Night & weekend" : "Peak");

let map = null;
function drawRoute(el, path) {
  if (map) { map.remove(); map = null; }
  map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L.Browser.mobile });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  const pts = path.map(id => [ST[id].lat, ST[id].lon]);
  path.slice(1).forEach((id, i) => {
    const a = path[i], line = ST[a].lines.find(l => ST[id].lines.includes(l)) || ST[a].lines[0];
    L.polyline([pts[i], pts[i + 1]], { color: LINE_COLOR[line], weight: 6, opacity: .95 }).addTo(map);
  });
  pts.forEach((p, i) => L.circleMarker(p, { radius: i === 0 || i === pts.length - 1 ? 7 : 3.5, weight: 2,
    color: "#13203a", fillColor: "#fff", fillOpacity: 1 }).bindTooltip(ST[path[i]].name).addTo(map));
  map.fitBounds(L.latLngBounds(pts).pad(pts.length < 3 ? 1.2 : 0.25));
}

function breakdown(q) {
  const extra = q.extraMiles > 0
    ? `<div class="row"><span>${q.extraMiles.toFixed(2)} extra mi × ${money(R.per_mile)}</span><span>+${money(R.per_mile * q.extraMiles)}</span></div>` : "";
  const capNote = q.period === "offpeak" ? `Night & weekend cap ${money(R.offpeak_max)}` : `Cap ${money(R.max)} (today's fare)`;
  return `<div class="rows">
    <div class="row"><span>Track distance</span><span>${q.railMi.toFixed(2)} mi</span></div>
    <div class="row"><span>Straight-line distance</span><span>${q.straightMi.toFixed(2)} mi</span></div>
    <div class="row"><span>Composite miles (average)</span><span>${q.compositeMi.toFixed(2)} mi</span></div>
    <div class="row"><span>Base fare · first ${R.base_miles} mi</span><span>${money(R.base)}</span></div>
    ${extra}
    <div class="row"><span>Rounded up to $0.05 · ${capNote}</span><span></span></div>
    ${q.reduced ? `<div class="row"><span>${esc(cls().label)} · 50%, rounded down</span><span></span></div>` : ""}
    <div class="row total"><span>${periodLabel(q.period)} fare</span><span>${money(q.fare)}</span></div></div>`;
}

// ------------------------------------------------------------------ views
const views = {
  trip() {
    const p = state.plan;
    const period = p.period === "auto" ? periodFor() : p.period;
    const q = quote(net, p.from, p.to, { period, reduced: cls().reduced });
    $("#view").innerHTML = `
      <h2>Where to?</h2>
      <div class="card od">
        <div class="field"><label for="from">From</label><select id="from">${options(p.from)}</select></div>
        <button class="swap" id="swap" aria-label="Swap stations">⇅</button>
        <div class="field"><label for="to">To</label><select id="to">${options(p.to)}</select></div>
        <div class="seg" role="group" aria-label="Fare period">
          ${["auto", "peak", "offpeak"].map(k => `<button data-period="${k}" aria-pressed="${p.period === k}">${
            k === "auto" ? `Now · ${periodLabel(periodFor())}` : periodLabel(k)}</button>`).join("")}
        </div>
      </div>
      ${q ? `<div class="card quote">
        <h3>Your fare</h3>
        <div class="big">${money(q.fare)}</div>
        <div class="was">Flat fare today <s>${money(q.today)}</s></div>
        ${q.saving > 0 ? `<span class="save">You save ${money(q.saving)}</span>` : `<span class="save" style="background:var(--surface2);color:var(--mute)">Same as today — never more</span>`}
        ${breakdown(q)}
        <div class="map" id="map"></div>
        <div class="path">${q.stops} stop${q.stops === 1 ? "" : "s"}: ${q.path.map(id => esc(ST[id].name)).join(" → ")}</div>
      </div>
      <button class="btn go" id="tapin" ${state.active ? "disabled" : ""}>${state.active ? "You're already on a trip" : `Tap in at ${esc(ST[p.from].name)}`}</button>`
      : `<div class="card empty">Pick two different stations.</div>`}`;
    $("#from").onchange = e => { p.from = e.target.value; save(); render(); };
    $("#to").onchange = e => { p.to = e.target.value; save(); render(); };
    $("#swap").onclick = () => { [p.from, p.to] = [p.to, p.from]; save(); render(); };
    document.querySelectorAll("[data-period]").forEach(b => (b.onclick = () => { p.period = b.dataset.period; save(); render(); }));
    if (q) { drawRoute($("#map"), q.path); $("#tapin").onclick = () => tapIn(p.from, p.to); }
  },

  ride() {
    const a = state.active;
    if (!a) {
      const p = state.plan;
      $("#view").innerHTML = `<h2>Ride</h2>
        <div class="card empty"><p><b>You're not on a trip.</b></p>
          <p class="small">Tap in at the gate with your ticket. Your fare is set when you tap out, by the distance you travel.</p></div>
        <div class="card od"><div class="field"><label for="tapin-st">Tap in at</label><select id="tapin-st">${options(p.from)}</select></div></div>
        <button class="btn go" id="tapin">Tap in</button>`;
      $("#tapin").onclick = () => tapIn($("#tapin-st").value, p.to);
      return;
    }
    const est = quote(net, a.from, a.planned, { period: a.period, reduced: a.reduced });
    $("#view").innerHTML = `<h2>On your trip</h2>
      <div class="card ticket">
        <span class="live">Tapped in · ${esc(ST[a.from].name)} ${dots(a.from)}</span>
        <div class="qr" id="qr" aria-label="Entry ticket QR code"></div>
        <div class="timer" id="timer">00:00</div>
        <div class="muted small">Ticket ${esc(a.id)} · ${periodLabel(a.period)} · ${esc(CLASSES[a.riderClass].label)}</div>
      </div>
      <div class="card">
        <div class="row"><span class="muted">Booked to</span><span><b>${esc(ST[a.planned].name)}</b></span></div>
        <div class="row"><span class="muted">Estimated fare</span><span><b>${est ? money(est.fare) : "—"}</b></span></div>
        <div class="row"><span class="muted">Held until tap-out</span><span>${money(a.hold)}</span></div>
        <p class="small muted">Ride further or get off early — you pay for the distance you actually travel. No tap-out within 3 hours is charged ${money(a.hold)}, today's fare.</p>
      </div>
      <div class="card od"><div class="field"><label for="exit">Tap out at</label><select id="exit">${options(a.planned)}</select></div></div>
      <button class="btn" id="tapout">Tap out</button>
      <button class="link" id="missed">Simulate a missed tap-out</button>`;
    const qr = qrcode(0, "M");
    qr.addData(JSON.stringify({ t: a.id, o: a.from, at: a.at, c: a.riderClass }));
    qr.make();
    $("#qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    const tick = () => {
      const s = Math.floor((Date.now() - a.at) / 1000);
      const el = $("#timer"); if (!el) return clearInterval(views.timer);
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    clearInterval(views.timer); views.timer = setInterval(tick, 1000); tick();
    $("#tapout").onclick = () => tapOut($("#exit").value);
    $("#missed").onclick = () => tapOut(null);
  },

  wallet() {
    $("#view").innerHTML = `<h2>Wallet</h2>
      <div class="card wallet">
        <h3>Stored value</h3>
        <div class="bal">${money(state.balance)}</div>
        <div class="muted small">Demo money for trying the app — no real payment is ever taken.</div>
        <div class="grid3">${[5, 10, 20].map(v => `<button data-add="${v}">+ ${money(v)}</button>`).join("")}</div>
      </div>
      <div class="card">
        <h3>Rider type</h3>
        ${Object.entries(CLASSES).map(([k, c]) => `<label class="radio"><input type="radio" name="cls" value="${k}" ${state.riderClass === k ? "checked" : ""}>
          <span><b>${c.label}</b><small>${c.note}</small></span></label>`).join("")}
        <p class="small muted">Reduced fares follow the Washington model: half the regular fare, rounded down to $0.05.</p>
      </div>
      <button class="btn ghost" id="reset">Reset demo data</button>`;
    document.querySelectorAll("[data-add]").forEach(b => (b.onclick = () => {
      state.balance += Number(b.dataset.add); save(); render(); toast(`Added ${money(Number(b.dataset.add))} demo funds`);
    }));
    document.querySelectorAll('input[name="cls"]').forEach(r => (r.onchange = () => {
      if (state.active) { toast("Finish your trip before changing rider type"); return render(); }
      state.riderClass = r.value; save(); render();
    }));
    $("#reset").onclick = () => { if (confirm("Reset balance, trips and settings on this device?")) {
      state = structuredClone(DEFAULT); save(); render(); toast("Demo data reset"); } };
  },

  history() {
    const t = state.trips, spent = t.reduce((s, x) => s + x.fare, 0), saved = t.reduce((s, x) => s + x.saving, 0);
    $("#view").innerHTML = `<h2>History</h2>
      <div class="stats"><div><b>${t.length}</b><small>trips</small></div>
        <div><b>${money(spent)}</b><small>spent</small></div>
        <div><b style="color:var(--good)">${money(saved)}</b><small>saved vs flat fare</small></div></div>
      <div class="card">${t.length ? t.slice().reverse().map(x => `<div class="trip"><div>
          <b>${esc(ST[x.from].name)} → ${x.to ? esc(ST[x.to].name) : "no tap-out"}</b>
          <small>${new Date(x.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${
            x.to ? `${x.compositeMi.toFixed(1)} composite mi · ${periodLabel(x.period)}` : "missed tap-out"}</small></div>
          <div class="amt">${money(x.fare)}${x.saving > 0 ? `<small>saved ${money(x.saving)}</small>` : ""}</div></div>`).join("")
        : `<div class="empty">No trips yet. Plan one on the Trip tab.</div>`}</div>`;
  },

  fares() {
    const rows = net.examples.map(e => `<tr><td>${esc(e.from)} → ${esc(e.to)}</td><td class="n">${e.composite_mi.toFixed(1)}</td>
      <td class="n">${money(e.fare)}</td><td class="n">${money(e.offpeak)}</td><td class="n">${money(e.reduced)}</td></tr>`).join("");
    $("#view").innerHTML = `<h2>How fares work</h2>
      <div class="card prose">
        <p>Today every subway trip costs <b>${money(FLAT)}</b> — one stop or thirteen. Short-Hop charges by distance using
          <b>Washington Metrorail's fare model</b>, scaled so the longest trips cost exactly today's fare. <b>No trip ever costs more than now.</b></p>
      </div>
      <div class="card">
        <h3>The rules</h3>
        <table class="t"><tr><th></th><th class="n">Washington</th><th class="n">Short-Hop Boston</th></tr>
          <tr><td>Base fare · first 3 composite mi</td><td class="n">$2.25</td><td class="n">${money(R.base)}</td></tr>
          <tr><td>Each extra composite mile (20% of base)</td><td class="n">$0.45</td><td class="n">${money(R.per_mile)}</td></tr>
          <tr><td>Maximum (3 × base)</td><td class="n">$6.75</td><td class="n">${money(R.max)}</td></tr>
          <tr><td>Nights after 9:30pm &amp; weekends</td><td class="n">$2.25–$2.50</td><td class="n">${money(R.offpeak_min)}–${money(R.offpeak_max)}</td></tr>
          <tr><td>Reduced fare</td><td class="n">50%</td><td class="n">50%</td></tr>
          <tr><td>Missed tap-out</td><td class="n">base fare</td><td class="n">${money(R.missed_tap_out)}</td></tr></table>
        <p class="small muted" style="margin-top:10px">Composite miles = the average of track distance and straight-line distance. Fares round up to the nearest $0.05.
          Boston charges today's fare for a missed tap-out because its gates check entry only; Washington's exit gates make tapping out unavoidable.</p>
      </div>
      <div class="card">
        <h3>Example trips</h3>
        <table class="t"><tr><th>Trip</th><th class="n">mi</th><th class="n">Peak</th><th class="n">Night</th><th class="n">Reduced</th></tr>${rows}</table>
      </div>
      <div class="card prose small">
        <h3>Sources</h3>
        <p>Fare model: <a href="https://www.wmata.com/content/dam/wmata-com/about/public-records/Tariff%2049.pdf" target="_blank" rel="noopener">WMATA Tariff 49</a>, effective July 1, 2026.
          Current fare: <a href="https://www.mbta.com/fares/subway-fares" target="_blank" rel="noopener">MBTA subway fares</a>.
          Distances: MBTA Rapid Transit Stop Distances (open data). Stations: MBTA V3 API.</p>
        <p class="muted">Short-Hop is an independent concept from the <a href="../">MBTA Transit Intelligence</a> project and is not affiliated with the MBTA.</p>
      </div>`;
  },
};

// ------------------------------------------------------------------ actions
function tapIn(from, planned) {
  if (state.active) return toast("You're already on a trip");
  const hold = holdAmount();
  if (state.balance < hold) {
    toast(`You need at least ${money(hold)} to tap in`);
    return go("wallet");
  }
  const at = Date.now();
  state.active = { id: "SH-" + at.toString(36).toUpperCase().slice(-6), from,
    planned: planned && planned !== from ? planned : from, at, period: periodFor(new Date(at)),
    riderClass: state.riderClass, reduced: cls().reduced, hold };
  save(); toast(`Tapped in at ${ST[from].name}`); go("ride");
}

function tapOut(exit) {
  const a = state.active; if (!a) return;
  let trip;
  const expired = Date.now() - a.at > MAX_RIDE_MS;
  if (!exit || expired) {
    trip = { from: a.from, to: null, at: a.at, fare: a.hold, saving: 0, period: a.period };
  } else if (exit === a.from) {
    trip = { from: a.from, to: exit, at: a.at, fare: 0, saving: 0, compositeMi: 0, period: a.period, sameStation: true };
  } else {
    const q = quote(net, a.from, exit, { period: a.period, reduced: a.reduced });
    trip = { from: a.from, to: exit, at: a.at, fare: q.fare, saving: q.saving, compositeMi: q.compositeMi,
      period: a.period, q };
  }
  state.balance = Math.round((state.balance - trip.fare) * 100) / 100;
  const q = trip.q; delete trip.q;
  state.trips.push(trip); state.active = null; save();
  sheet(`<div style="text-align:center">
      <h3>${trip.to ? "Tapped out" : "Missed tap-out"}</h3>
      <div style="font-size:48px;font-weight:800;letter-spacing:-.03em">${money(trip.fare)}</div>
      <div class="muted">${esc(ST[trip.from].name)} → ${trip.to ? esc(ST[trip.to].name) : "unknown exit"}</div>
      ${trip.saving > 0 ? `<span class="save">Saved ${money(trip.saving)} vs the flat fare</span>` : ""}
      ${trip.sameStation ? `<p class="small muted">Entered and exited at the same station — no charge.</p>` : ""}
      ${!trip.to ? `<p class="small muted">No tap-out means the trip is charged today's full fare. Tap out next time to pay only for your distance.</p>` : ""}
    </div>
    ${q ? breakdown(q) : ""}
    <p class="small muted" style="text-align:center">New balance ${money(state.balance)}</p>
    <button class="btn" data-close>Done</button>`);
  render();
}

// ------------------------------------------------------------------ router
let current = "trip";
function go(view) { current = view; render(); $("#view").focus({ preventScroll: true }); window.scrollTo(0, 0); }
function render() {
  $("#balance-chip").textContent = money(state.balance);
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.go === current));
  views[current]();
}
document.querySelectorAll("[data-go]").forEach(b => (b.onclick = () => go(b.dataset.go)));
if (state.active) current = "ride";
render();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
