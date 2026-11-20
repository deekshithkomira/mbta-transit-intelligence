import * as S from "../store.js";
import { confirmSheet, esc, fmtDate, fmtTime, icon, money, openSheet, toast } from "../ui.js";
import { capMeter, shCard } from "./home.js";

const BRAND_CLASS = { Visa: "visa", Mastercard: "mc", Amex: "amex", Discover: "disc" };
const brandBadge = b => `<span class="brand ${BRAND_CLASS[b] || ""}">${b === "Mastercard" ? "MC" : b === "Discover" ? "DISC" : b.toUpperCase()}</span>`;
const TX = { topup: ["Added money", "plus"], autoreload: ["Auto-reload", "reload"], credit: ["Credit", "star"],
  trip: ["Trip", "train"], refund: ["Refund", "reload"] };

export function render(root, ctx) {
  const st = S.get(), ar = st.autoReload;
  root.innerHTML = `
    <header class="top"><h1>Wallet</h1></header>
    ${shCard(st)}
    <div class="btn-row"><button class="btn big" data-act="topup">${icon("plus")} Add money</button></div>

    <section class="card"><div class="card-h"><h3>Payment methods</h3><button class="link" data-act="addcard">${icon("plus")} Add card</button></div>
      ${st.cards.length ? st.cards.map(c => `<div class="list-row card-row">
        ${brandBadge(c.brand)}<span class="grow"><b>${esc(c.nickname || c.brand)} •••• ${c.last4}</b><small>Expires ${c.exp}${c.default ? " · Default" : ""}</small></span>
        <button class="icon-btn" data-cardmenu="${c.id}" aria-label="Options for card ending ${c.last4}">${icon("gear")}</button></div>`).join("")
        : `<div class="empty small">${icon("card")}<p>No cards yet. Add one to load money.</p></div>`}</section>

    <section class="card"><div class="card-h"><h3>Auto-reload</h3>
      <label class="switch"><input type="checkbox" data-act="ar" ${ar.enabled ? "checked" : ""} ${st.cards.length ? "" : "disabled"} aria-label="Auto-reload"><i></i></label></div>
      <p class="muted small">${st.cards.length ? (ar.enabled ? `When your balance drops below <b>${money(ar.threshold)}</b>, add <b>${money(ar.amount)}</b> automatically.` : "Never get stuck at the gate: top up automatically when you run low.") : "Add a card to turn on auto-reload."}</p>
      ${ar.enabled ? `<div class="grid2">
        <label class="field"><span>When below</span><select data-ar="threshold">${[2.4, 5, 10, 15].map(v => `<option value="${v}" ${ar.threshold === v ? "selected" : ""}>${money(v)}</option>`).join("")}</select></label>
        <label class="field"><span>Add</span><select data-ar="amount">${[10, 20, 30, 50].map(v => `<option value="${v}" ${ar.amount === v ? "selected" : ""}>${money(v)}</option>`).join("")}</select></label>
        <label class="field span2"><span>From</span><select data-ar="cardId">${st.cards.map(c => `<option value="${c.id}" ${ar.cardId === c.id ? "selected" : ""}>${esc(c.brand)} •••• ${c.last4}</option>`).join("")}</select></label>
      </div>` : ""}</section>

    <section class="card"><div class="card-h"><h3>Weekly fare cap</h3><button class="link" data-act="capinfo">How it works</button></div>${capMeter(st)}</section>

    <section class="card"><div class="card-h"><h3>Transactions</h3></div>
      ${st.ledger.length ? st.ledger.slice(0, 30).map(t => {
        const [label, ic] = TX[t.type] || ["Transaction", "info"];
        return `<div class="list-row"><span class="lead ${t.amount < 0 ? "" : "good"}">${icon(ic)}</span>
          <span class="grow"><b>${label}</b><small>${esc(t.meta?.route || t.meta?.card || t.meta?.note || "")} · ${fmtDate(t.at)} ${fmtTime(t.at)}</small></span>
          <span class="amt ${t.amount > 0 ? "good" : ""}">${t.amount > 0 ? "+" : ""}${money(t.amount)}</span></div>`;
      }).join("") : `<div class="empty small">No transactions yet.</div>`}</section>`;

  root.querySelector('[data-act="topup"]').onclick = () => ctx.openTopUp();
  root.querySelector('[data-act="addcard"]').onclick = () => openAddCard(ctx);
  root.querySelector('[data-act="capinfo"]').onclick = () => ctx.openCapInfo();
  root.querySelector('[data-act="ar"]').onchange = e => {
    S.update(s => { s.autoReload.enabled = e.target.checked; if (!s.autoReload.cardId) s.autoReload.cardId = S.defaultCard()?.id || null; });
    toast(e.target.checked ? "Auto-reload is on" : "Auto-reload is off"); ctx.refresh();
  };
  root.querySelectorAll("[data-ar]").forEach(sel => (sel.onchange = () => {
    S.update(s => { s.autoReload[sel.dataset.ar] = sel.dataset.ar === "cardId" ? sel.value : Number(sel.value); }); ctx.refresh();
  }));
  root.querySelectorAll("[data-cardmenu]").forEach(b => (b.onclick = () => cardMenu(ctx, b.dataset.cardmenu)));
}

function cardMenu(ctx, id) {
  const c = S.get().cards.find(x => x.id === id);
  const { el, close } = openSheet(`<h2 class="sheet-title">${esc(c.brand)} •••• ${c.last4}</h2>
    <button class="row-btn" data-a="default" ${c.default ? "disabled" : ""}>${icon("check")}<span><b>${c.default ? "Default card" : "Make default"}</b><small>Used for top-ups</small></span></button>
    <button class="row-btn danger" data-a="remove">${icon("trash")}<span><b>Remove card</b><small>You can add it again later</small></span></button>`, { label: "Card options" });
  el.querySelector('[data-a="default"]').onclick = () => { S.setDefaultCard(id); close(); toast("Default card updated"); ctx.refresh(); };
  el.querySelector('[data-a="remove"]').onclick = async () => {
    close();
    if (await confirmSheet({ title: "Remove this card?", body: `${esc(c.brand)} •••• ${c.last4} will be removed from this device.`, ok: "Remove", danger: true })) {
      S.removeCard(id); toast("Card removed"); ctx.refresh();
    }
  };
}

export function openAddCard(ctx, after) {
  const { el, close } = openSheet(`<h2 class="sheet-title">Add a card</h2>
    <div class="demo-note">${icon("lock")}<span><b>Demo app — test cards only.</b> Never enter a real card here. Try <button type="button" class="link inline" data-fill>4242 4242 4242 4242</button>, any future date and any 3-digit CVC.</span></div>
    <form id="addcard" novalidate autocomplete="off">
      <label class="field"><span>Card number</span><input name="number" inputmode="numeric" placeholder="4242 4242 4242 4242" maxlength="23" autocomplete="off"></label>
      <div class="grid2"><label class="field"><span>Expiry</span><input name="exp" inputmode="numeric" placeholder="MM/YY" maxlength="5" autocomplete="off"></label>
        <label class="field"><span>CVC</span><input name="cvc" inputmode="numeric" placeholder="123" maxlength="4" autocomplete="off"></label></div>
      <label class="field"><span>Nickname <em>(optional)</em></span><input name="nickname" maxlength="20" placeholder="e.g. Personal"></label>
      <p class="err" id="card-err" role="alert"></p>
      <button class="btn big" type="submit">Save card</button></form>`, { label: "Add a card" });
  const f = el.querySelector("#addcard");
  const num = f.number, exp = f.exp;
  num.addEventListener("input", () => { num.value = num.value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim(); });
  exp.addEventListener("input", () => { const d = exp.value.replace(/\D/g, "").slice(0, 4); exp.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; });
  el.querySelector("[data-fill]").onclick = () => {
    num.value = "4242 4242 4242 4242";
    const d = new Date(); exp.value = `12/${String((d.getFullYear() + 3) % 100).padStart(2, "0")}`; f.cvc.value = "123"; f.nickname.focus();
  };
  f.onsubmit = e => {
    e.preventDefault();
    const r = S.addCard({ number: num.value, exp: exp.value, cvc: f.cvc.value, nickname: f.nickname.value.trim() });
    if (!r.ok) { el.querySelector("#card-err").textContent = r.msg; f[r.field]?.focus(); return; }
    close(); toast(`${r.card.brand} •••• ${r.card.last4} added`, "good"); ctx.refresh(); after && after(r.card);
  };
}

export function openTopUp(ctx) {
  const st = S.get();
  if (!st.cards.length) return openAddCard(ctx, () => openTopUp(ctx));
  let amount = 20, cardId = S.defaultCard().id;
  const { el, close } = openSheet(`<h2 class="sheet-title">Add money</h2>
    <p class="muted small">Balance ${money(st.balance)}</p>
    <div class="chips" role="group" aria-label="Amount">${[5, 10, 20, 50].map(v => `<button class="chip-btn" data-amt="${v}" aria-pressed="${v === amount}">${money(v)}</button>`).join("")}</div>
    <label class="field"><span>Or enter an amount</span><input id="amt" inputmode="decimal" placeholder="$ 1 – 200"></label>
    <label class="field"><span>Pay with</span><select id="card">${st.cards.map(c => `<option value="${c.id}" ${c.id === cardId ? "selected" : ""}>${esc(c.brand)} •••• ${c.last4}</option>`).join("")}</select></label>
    <button class="link" data-newcard>${icon("plus")} Use a different card</button>
    <p class="err" id="topup-err" role="alert"></p>
    <button class="btn big" data-pay>Add ${money(amount)}</button>
    <p class="fine center">Demo — no real payment is taken.</p>`, { label: "Add money" });
  const pay = el.querySelector("[data-pay]");
  const setAmt = v => { amount = v; pay.textContent = `Add ${money(v || 0)}`; el.querySelectorAll("[data-amt]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.amt === v)); };
  el.querySelectorAll("[data-amt]").forEach(b => (b.onclick = () => { el.querySelector("#amt").value = ""; setAmt(+b.dataset.amt); }));
  el.querySelector("#amt").addEventListener("input", e => setAmt(Math.round(parseFloat(e.target.value.replace(/[^\d.]/g, "")) * 100) / 100 || 0));
  el.querySelector("#card").onchange = e => (cardId = e.target.value);
  el.querySelector("[data-newcard]").onclick = () => { close(); openAddCard(ctx, () => openTopUp(ctx)); };
  pay.onclick = () => {
    if (!(amount >= 1 && amount <= 200)) return (el.querySelector("#topup-err").textContent = "Enter an amount between $1 and $200.");
    pay.disabled = true; pay.innerHTML = `<span class="spinner"></span> Processing…`;
    setTimeout(() => {
      const r = S.addMoney(amount, cardId);
      close();
      if (r.ok) { toast(`${money(amount)} added`, "good"); S.notify("Money added", `${money(amount)} added to your Short-Hop card.`, "wallet"); }
      else toast(r.msg, "warn");
      ctx.refresh();
    }, 900);
  };
}

export function openCapInfo() {
  const cap = S.weekCap();
  openSheet(`<h2 class="sheet-title">Weekly fare cap</h2>
    <p>Once your trips in any rolling 7-day window add up to <b>${money(cap)}</b>, every further ride in that window is <b>free</b>.</p>
    <p class="muted">That's the price of the MBTA 7-day LinkPass (${money(S.WEEK_CAP.regular)} adult, ${money(S.WEEK_CAP.reduced)} reduced), so frequent riders never pay more than a pass — without having to buy one up front.</p>
    ${capMeter()}
    <p class="fine">Short-Hop proposal. Fare capping is not part of today's MBTA fares.</p>
    <button class="btn" data-close>Got it</button>`, { label: "Weekly fare cap" });
}
