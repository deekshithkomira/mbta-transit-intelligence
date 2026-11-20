// Node tests for the rider app's fare engine:  node --test tests/*.test.mjs
// Checks the rule and that the JS engine matches the Python engine (examples exported by
// `mbta-ti analyze` into site/app/data/network.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fare, quote, roundDown5, roundUp5 } from "../site/app/fare.js";

const net = JSON.parse(readFileSync(new URL("../site/app/data/network.json", import.meta.url)));
const R = net.rules;
const id = name => Object.keys(net.graph.stations).find(k => net.graph.stations[k].name === name);

test("rule constants", () => {
  assert.equal(R.max, 2.4);
  assert.equal(R.min, 0.8);
  assert.equal(R.reduced_share, 0.5);
});

test("rounding", () => {
  assert.equal(roundUp5(1.752), 1.8);
  assert.equal(roundUp5(1.15), 1.15);
  assert.equal(roundDown5(0.425), 0.4);
});

test("end to end = $2.40, proportional below, $0.80 minimum", () => {
  assert.equal(fare(10, 10, R), 2.4);
  assert.equal(fare(5, 10, R), 1.2);
  assert.equal(fare(0.5, 10, R), 0.8);
  assert.equal(fare(30, 10, R), 2.4);
  assert.equal(fare(7.3, 10, R, { reduced: true }), 0.9);
});

test("every whole line costs exactly $2.40 end to end", () => {
  for (const p of net.graph.patterns) {
    const q = quote(net, p.stations[0], p.stations.at(-1));
    assert.equal(q.fare, 2.4, p.name);
  }
});

test("JS engine matches Python engine on every exported example", () => {
  for (const ex of net.examples) {
    const q = quote(net, id(ex.from), id(ex.to));
    assert.equal(q.stops, ex.stops, `${ex.from} -> ${ex.to} stops`);
    assert.ok(Math.abs(q.compositeMi - ex.composite_mi) < 1e-3, `${ex.from} -> ${ex.to} miles`);
    assert.equal(q.line, ex.line, `${ex.from} -> ${ex.to} line`);
    assert.equal(q.fare, ex.fare, `${ex.from} -> ${ex.to} fare`);
    assert.equal(quote(net, id(ex.from), id(ex.to), { reduced: true }).fare, ex.reduced);
  }
});

test("no trip costs more than today's flat fare", () => {
  const ids = Object.keys(net.graph.stations);
  for (let i = 0; i < ids.length; i += 7)
    for (let j = 0; j < ids.length; j += 5)
      if (i !== j) assert.ok(quote(net, ids[i], ids[j]).fare <= net.flat_fare);
});
