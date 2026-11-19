"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Money, splitByWeights, allocatePayment } = require("../src");
test("split conserves its input", () => { const rows = splitByWeights(Money.fromMinor(17, "USD"), [{ id: "a", weight: 2 }, { id: "b", weight: 3 }]); assert.equal(rows.reduce((sum, row) => sum + row.amount.minor, 0), 17); });
test("split accepts decimal weights", () => { const rows = splitByWeights(Money.fromMinor(10, "USD"), [{ id: "a", weight: 0.5 }, { id: "b", weight: 1.5 }]); assert.deepEqual(rows.map(row => row.amount.minor), [3, 7]); });
test("payment returns zero for a zero payment", () => { const rows = allocatePayment(Money.zero("EUR"), [{ id: "a", due: Money.fromMinor(8, "EUR") }]); assert.equal(rows[0].amount.minor, 0); });
test("payment accepts invoice-like open records", () => { const rows = allocatePayment(Money.fromMinor(2, "USD"), [{ id: "a", due: Money.fromMinor(5, "USD"), status: "open" }]); assert.equal(rows[0].amount.minor, 2); });
