// Wallet logic of the Short-Hop app: card validation (test cards only) and the weekly cap.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };   // store.js persists here
const S = await import("../site/app/js/store.js");

test("Luhn check", () => {
  assert.ok(S.luhn("4242424242424242"));
  assert.ok(!S.luhn("4242424242424241"));
});

test("only published test cards are accepted", () => {
  const now = new Date("2026-11-18");
  assert.equal(S.validateCard({ number: "4242 4242 4242 4242", exp: "12/29", cvc: "123" }, now).brand, "Visa");
  assert.equal(S.validateCard({ number: "378282246310005", exp: "01/30", cvc: "1234" }, now).brand, "Amex");
  const real = S.validateCard({ number: "4111 1111 1111 1111", exp: "12/29", cvc: "123" }, now);
  assert.ok(!real.ok && /test card/.test(real.msg));                   // Luhn-valid but not a test card
  assert.equal(S.validateCard({ number: "4242424242424242", exp: "10/26", cvc: "123" }, now).field, "exp");
  assert.equal(S.validateCard({ number: "4242424242424242", exp: "12/29", cvc: "12" }, now).field, "cvc");
});

test("weekly cap charges only what is left under the cap", () => {
  const now = Date.now(), cap = S.WEEK_CAP.regular;
  const trips = [{ at: now - 3600e3, charged: 22.1 }, { at: now - 8 * 864e5, charged: 50 }];   // old trip ignored
  assert.deepEqual(S.capCharge(trips, 1.2, now, cap), { charged: 0.4, spentBefore: 22.1, capApplied: true });
  assert.deepEqual(S.capCharge([], 1.2, now, cap), { charged: 1.2, spentBefore: 0, capApplied: false });
  assert.equal(S.capCharge([{ at: now, charged: 22.5 }], 2.4, now, cap).charged, 0);
});
