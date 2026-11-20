"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Money, splitByWeights, allocatePayment } = require("../src");

const usd = (n) => Money.fromMinor(n, "USD");
const minors = (rows) => rows.map((r) => [r.id, r.amount.minor]);

test("split keeps the input currency and conserves the total", () => {
  const rows = splitByWeights(Money.fromMinor(1000, "KWD"), [{ id: "b", weight: 1 }, { id: "a", weight: 2 }, { id: "c", weight: 4 }]);
  assert.equal(rows.reduce((n, r) => n + r.amount.minor, 0), 1000);
  assert.ok(rows.every((r) => r.amount.currency.code === "KWD"));
});

test("split ties go to the smallest id, whatever the input order", () => {
  assert.deepEqual(minors(splitByWeights(usd(1), [{ id: "z", weight: 1 }, { id: "a", weight: 1 }])), [["a", 1], ["z", 0]]);
});

test("split rejects negative and all-zero weights", () => {
  assert.throws(() => splitByWeights(usd(5), [{ id: "a", weight: -1 }, { id: "b", weight: 1 }]), /weight/);
  assert.throws(() => splitByWeights(usd(5), [{ id: "a", weight: 0 }]), /positive/);
});

test("allocate follows due ratios and rejects overpayment", () => {
  assert.deepEqual(minors(allocatePayment(usd(200), [{ id: "x", due: usd(100) }, { id: "y", due: usd(300) }])), [["x", 50], ["y", 150]]);
  assert.throws(() => allocatePayment(usd(5), [{ id: "x", due: usd(4) }]), /exceeds/);
});

test("allocate rejects mixed currencies, duplicate ids and closed invoices", () => {
  assert.throws(() => allocatePayment(usd(1), [{ id: "x", due: usd(1) }, { id: "y", due: Money.fromMinor(1, "EUR") }]), /currency/);
  assert.throws(() => allocatePayment(usd(1), [{ id: "x", due: usd(1) }, { id: "x", due: usd(1) }]), /duplicate/);
  assert.throws(() => allocatePayment(usd(1), [{ id: "x", due: usd(1), status: "closed" }]), /closed/);
});
