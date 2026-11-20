// Short-Hop app state: profile, wallet, cards, ledger, trips, settings.
// Everything is simulated and stays in this browser (localStorage). Pure helpers are
// exported separately so they can be unit-tested in Node (tests/app_store.test.mjs).

export const RIDER_TYPES = {
  regular: { label: "Adult", note: "Full fare", reduced: false },
  student: { label: "Student", note: "Reduced fare · 50%", reduced: true },
  senior: { label: "Senior 65+", note: "Reduced fare · 50%", reduced: true },
  access: { label: "Disability / TAP", note: "Reduced fare · 50%", reduced: true },
  income: { label: "Income-eligible", note: "Reduced fare · 50%", reduced: true },
};

// Weekly fare cap = price of the MBTA 7-day LinkPass ($22.50; reduced $10.00). Proposal.
export const WEEK_CAP = { regular: 22.5, reduced: 10.0 };
export const WEEK_MS = 7 * 24 * 3600 * 1000;

// Only published processor test cards are accepted: this is a public demo, real card
// numbers must never be typed into it.
export const TEST_CARDS = {
  "4242424242424242": "Visa",
  "4000056655665556": "Visa",
  "5555555555554444": "Mastercard",
  "2223003122003222": "Mastercard",
  "378282246310005": "Amex",
  "6011111111111117": "Discover",
};

export const r2 = x => Math.round(x * 100) / 100;
export const uid = (p = "") => p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

export function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = +num[i];
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return num.length >= 13 && sum % 10 === 0;
}

export function validateCard({ number, exp, cvc }, now = new Date()) {
  const n = String(number || "").replace(/\D/g, "");
  if (!luhn(n)) return { ok: false, field: "number", msg: "That card number isn't valid." };
  if (!TEST_CARDS[n]) return { ok: false, field: "number", msg: "Demo app: use a test card such as 4242 4242 4242 4242. Never enter a real card here." };
  const m = String(exp || "").match(/^\s*(\d{1,2})\s*\/\s*(\d{2})\s*$/);
  if (!m || +m[1] < 1 || +m[1] > 12) return { ok: false, field: "exp", msg: "Use MM/YY." };
  const expEnd = new Date(2000 + +m[2], +m[1], 1);
  if (expEnd <= now) return { ok: false, field: "exp", msg: "This card has expired." };
  const cvcLen = TEST_CARDS[n] === "Amex" ? 4 : 3;
  if (!new RegExp(`^\\d{${cvcLen}}$`).test(String(cvc || ""))) return { ok: false, field: "cvc", msg: `CVC is ${cvcLen} digits.` };
  return { ok: true, brand: TEST_CARDS[n], last4: n.slice(-4), exp: `${String(+m[1]).padStart(2, "0")}/${m[2]}` };
}

/** Amount charged for a trip after the rolling 7-day cap. */
export function capCharge(trips, fare, now, cap) {
  const spent = trips.filter(t => now - t.at < WEEK_MS).reduce((s, t) => s + (t.charged || 0), 0);
  const room = Math.max(0, cap - spent);
  return { charged: r2(Math.min(fare, room)), spentBefore: r2(spent), capApplied: fare > room };
}

export function weekSpent(trips, now = Date.now()) {
  return r2(trips.filter(t => now - t.at < WEEK_MS).reduce((s, t) => s + (t.charged || 0), 0));
}

// ------------------------------------------------------------------ persistence
const KEY = "shorthop.v2";
const fresh = () => ({
  version: 2, onboarded: false,
  profile: { name: "", email: "", riderType: "regular", verified: false, createdAt: Date.now(), cardNo: String(Math.floor(1e15 + Math.random() * 9e15)) },
  balance: 0, cards: [], autoReload: { enabled: false, threshold: 5, amount: 20, cardId: null },
  ledger: [], trips: [], active: null, favorites: [], recent: [],
  settings: { theme: "system", largeText: false, reduceMotion: false,
    notify: { receipts: true, lowBalance: true, alerts: true } },
  notifications: [],
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.version === 2) return { ...fresh(), ...raw, settings: { ...fresh().settings, ...raw.settings } };
  } catch { /* storage unavailable */ }
  return fresh();
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } }

export const get = () => state;
export function update(fn) { fn(state); persist(); listeners.forEach(l => l(state)); }
export const subscribe = fn => (listeners.add(fn), () => listeners.delete(fn));
export function resetAll() { state = fresh(); persist(); listeners.forEach(l => l(state)); }

export const riderType = () => RIDER_TYPES[state.profile.riderType] || RIDER_TYPES.regular;
export const weekCap = () => (riderType().reduced ? WEEK_CAP.reduced : WEEK_CAP.regular);
export const defaultCard = () => state.cards.find(c => c.default) || state.cards[0] || null;

export function notify(title, body, kind = "info") {
  update(s => { s.notifications.unshift({ id: uid("N"), at: Date.now(), title, body, kind, read: false });
    s.notifications = s.notifications.slice(0, 60); });
}

// ------------------------------------------------------------------ wallet actions
export function addMoney(amount, cardId, kind = "topup") {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return { ok: false, msg: "Add a payment card first." };
  if (!(amount >= 1 && amount <= 200)) return { ok: false, msg: "Amount must be between $1 and $200." };
  update(s => {
    s.balance = r2(s.balance + amount);
    s.ledger.unshift({ id: uid("T"), type: kind, amount: r2(amount), at: Date.now(), meta: { card: `${card.brand} ••${card.last4}` } });
  });
  return { ok: true };
}

export function maybeAutoReload() {
  const a = state.autoReload;
  if (!a.enabled || state.balance >= a.threshold) return false;
  const card = state.cards.find(c => c.id === a.cardId) || defaultCard();
  if (!card) return false;
  addMoney(a.amount, card.id, "autoreload");
  if (state.settings.notify.lowBalance) notify("Auto-reload", `Added $${a.amount.toFixed(2)} from ${card.brand} ••${card.last4}.`, "wallet");
  return true;
}

export function addCard(input) {
  const v = validateCard(input);
  if (!v.ok) return v;
  if (state.cards.some(c => c.last4 === v.last4 && c.brand === v.brand)) return { ok: false, field: "number", msg: "This card is already saved." };
  const card = { id: uid("C"), brand: v.brand, last4: v.last4, exp: v.exp, nickname: input.nickname || "", default: state.cards.length === 0 };
  update(s => { s.cards.push(card); if (!s.autoReload.cardId) s.autoReload.cardId = card.id; });
  return { ok: true, card };
}
export function removeCard(id) {
  update(s => {
    const was = s.cards.find(c => c.id === id);
    s.cards = s.cards.filter(c => c.id !== id);
    if (was?.default && s.cards[0]) s.cards[0].default = true;
    if (s.autoReload.cardId === id) { s.autoReload.cardId = s.cards[0]?.id || null; if (!s.cards.length) s.autoReload.enabled = false; }
  });
}
export function setDefaultCard(id) { update(s => s.cards.forEach(c => (c.default = c.id === id))); }

export function rememberStation(id) {
  update(s => { s.recent = [id, ...s.recent.filter(x => x !== id)].slice(0, 6); });
}
export function toggleFavorite(from, to) {
  let added = false;
  update(s => {
    const i = s.favorites.findIndex(f => f.from === from && f.to === to);
    if (i >= 0) s.favorites.splice(i, 1); else { s.favorites.unshift({ from, to }); added = true; }
    s.favorites = s.favorites.slice(0, 8);
  });
  return added;
}
export const isFavorite = (from, to) => state.favorites.some(f => f.from === from && f.to === to);
