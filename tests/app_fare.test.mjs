// Node tests for the rider app's fare engine:  node --test tests/
// Checks the rules and that the JS engine matches the Python engine (examples exported by
// `mbta-ti analyze` into site/app/data/network.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fare, periodFor, quote, roundDown5, roundUp5 } from "../site/app/fare.js";

const net = JSON.parse(readFileSync(new URL("../site/app/data/network.json", import.meta.url)));
const R = net.rules;
const id = name => Object.keys(net.graph.stations).find(k => net.graph.stations[k].name === name);

test("Washington ratios, Boston calibration", () => {
  assert.equal(R.base, 0.8);
  assert.equal(R.per_mile, 0.16);
  assert.equal(R.max, 2.4);
  assert.equal(R.base_miles, 3);
  assert.equal(R.offpeak_max, 0.9);
});

test("rounding", () => {
  assert.equal(roundUp5(0.816), 0.85);
  assert.equal(roundUp5(1.15), 1.15);
  assert.equal(roundDown5(0.425), 0.4);
});

test("peak, off-peak and reduced fares", () => {
  assert.equal(fare(0.36, R), 0.8);
  assert.equal(fare(3.1, R), 0.85);
  assert.equal(fare(40, R), 2.4);
  assert.equal(fare(40, R, { period: "offpeak" }), 0.9);
  assert.equal(fare(5.24, R, { reduced: true }), 0.6);
});

test("late night and weekends are off-peak", () => {
  assert.equal(periodFor(new Date("2026-11-18T08:00:00")), "peak");      // Wednesday 8am
  assert.equal(periodFor(new Date("2026-11-18T22:00:00")), "offpeak");   // Wednesday 10pm
  assert.equal(periodFor(new Date("2026-11-21T12:00:00")), "offpeak");   // Saturday
});

test("JS engine matches Python engine on every exported example", () => {
  for (const ex of net.examples) {
    const q = quote(net, id(ex.from), id(ex.to));
    assert.equal(q.stops, ex.stops, `${ex.from} -> ${ex.to} stops`);
    assert.ok(Math.abs(q.compositeMi - ex.composite_mi) < 1e-3, `${ex.from} -> ${ex.to} miles`);
    assert.equal(q.fare, ex.fare, `${ex.from} -> ${ex.to} fare`);
    assert.equal(fare(q.compositeMi, R, { period: "offpeak" }), ex.offpeak);
    assert.equal(fare(q.compositeMi, R, { reduced: true }), ex.reduced);
  }
});

test("no trip costs more than today's flat fare", () => {
  const ids = Object.keys(net.graph.stations);
  for (let i = 0; i < ids.length; i += 7)
    for (let j = 0; j < ids.length; j += 5)
      if (i !== j) assert.ok(quote(net, ids[i], ids[j]).fare <= net.flat_fare);
});
