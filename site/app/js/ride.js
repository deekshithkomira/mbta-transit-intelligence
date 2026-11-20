// Tap in / tap out: the fare, the weekly cap, the wallet and notifications in one place.
import { fare, periodFor, quote, roundDown5 } from "../fare.js";
import { FLAT, R, net, stationName } from "./data.js";
import * as S from "./store.js";

const MAX_RIDE_MS = 3 * 3600 * 1000;   // no tap-out within 3 hours = missed tap-out

/** What a missed tap-out costs, and what must be on the card to enter. */
export const maxFare = () => (S.riderType().reduced ? roundDown5(FLAT * R.reduced_share) : FLAT);

export function quoteFor(from, to, period = periodFor()) {
  return quote(net, from, to, { period, reduced: S.riderType().reduced });
}

export function tapIn(from, planned) {
  const st = S.get();
  if (st.active) return { ok: false, msg: "You're already on a trip." };
  if (st.balance < maxFare()) S.maybeAutoReload();
  if (S.get().balance < maxFare()) return { ok: false, needFunds: true,
    msg: `You need at least ${"$" + maxFare().toFixed(2)} on your card to tap in.` };
  const at = Date.now();
  S.update(s => {
    s.active = { id: S.uid("SH-"), from, planned: planned && planned !== from ? planned : null, at,
      period: periodFor(new Date(at)), riderType: s.profile.riderType, reduced: S.riderType().reduced };
  });
  S.rememberStation(from);
  return { ok: true };
}

export function tapOut(exit) {
  const st = S.get(), a = st.active;
  if (!a) return null;
  const now = Date.now();
  const missed = !exit || now - a.at > MAX_RIDE_MS;
  let q = null, base;
  if (missed) base = maxFare();
  else if (exit === a.from) base = 0;
  else { q = quote(net, a.from, exit, { period: a.period, reduced: a.reduced }); base = q.fare; }
  const today = a.reduced ? roundDown5(FLAT * R.reduced_share) : FLAT;
  const cap = S.capCharge(st.trips, base, now, S.weekCap());
  const trip = {
    id: a.id, from: a.from, to: missed ? null : exit, at: a.at, endAt: now, period: a.period,
    riderType: a.riderType, compositeMi: q ? q.compositeMi : 0, railMi: q ? q.railMi : 0, stops: q ? q.stops : 0,
    fare: base, charged: cap.charged, capApplied: cap.capApplied, saving: S.r2(Math.max(0, today - cap.charged)),
    status: missed ? "missed" : exit === a.from ? "same-station" : "completed",
  };
  S.update(s => {
    s.balance = S.r2(s.balance - trip.charged);
    s.trips.unshift(trip);
    s.active = null;
    s.ledger.unshift({ id: S.uid("T"), type: "trip", amount: -trip.charged, at: now,
      meta: { trip: trip.id, route: `${stationName(trip.from)} → ${trip.to ? stationName(trip.to) : "no tap-out"}` } });
  });
  if (!missed) S.rememberStation(exit);
  if (S.get().settings.notify.receipts)
    S.notify(missed ? "Missed tap-out" : "Trip receipt",
      `${stationName(trip.from)} → ${trip.to ? stationName(trip.to) : "unknown"} · $${trip.charged.toFixed(2)}` +
      (trip.capApplied ? " · weekly cap reached" : ""), missed ? "warn" : "trip");
  S.maybeAutoReload();
  if (S.get().balance < 5 && S.get().settings.notify.lowBalance && !S.get().autoReload.enabled)
    S.notify("Low balance", `Your balance is $${S.get().balance.toFixed(2)}. Add money or turn on auto-reload.`, "wallet");
  return { trip, q };
}

export { fare };
