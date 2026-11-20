"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { splitByWeights, allocatePayment } = require("../src");

test("splitByWeights splits evenly", () => {
  const result = splitByWeights(100, [{ id: "a", weight: 1 }, { id: "b", weight: 1 }]);
  assert.deepEqual(result, [{ id: "a", amount: 50 }, { id: "b", amount: 50 }]);
});

test("splitByWeights splits by weight", () => {
  const result = splitByWeights(100, [{ id: "a", weight: 2 }, { id: "b", weight: 3 }]);
  assert.deepEqual(result, [{ id: "a", amount: 40 }, { id: "b", amount: 60 }]);
});

test("splitByWeights conserves total", () => {
  const result = splitByWeights(100, [{ id: "a", weight: 3 }, { id: "b", weight: 7 }]);
  const total = result.reduce((sum, r) => sum + r.amount, 0);
  assert.equal(total, 100);
});

test("splitByWeights sorts by id", () => {
  const result = splitByWeights(100, [{ id: "z", weight: 1 }, { id: "a", weight: 1 }]);
  assert.deepEqual(result[0], { id: "a", amount: 50 });
  assert.deepEqual(result[1], { id: "z", amount: 50 });
});

test("splitByWeights retains zero-weight rows", () => {
  const result = splitByWeights(100, [{ id: "a", weight: 1 }, { id: "b", weight: 0 }]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.find(r => r.id === "b"), { id: "b", amount: 0 });
});

test("splitByWeights rejects negative weights", () => {
  assert.throws(() => splitByWeights(100, [{ id: "a", weight: -1 }]), /weight must be a finite non-negative number/);
});

test("splitByWeights rejects all-zero weights", () => {
  assert.throws(() => splitByWeights(100, [{ id: "a", weight: 0 }, { id: "b", weight: 0 }]), /at least one weight must be positive/);
});

test("splitByWeights rejects negative total", () => {
  assert.throws(() => splitByWeights(-100, [{ id: "a", weight: 1 }]), /total must be a non-negative finite number/);
});

test("allocatePayment allocates evenly", () => {
  const result = allocatePayment(100, [{ id: "a", due: 50 }, { id: "b", due: 50 }]);
  assert.deepEqual(result, [{ id: "a", amount: 50 }, { id: "b", amount: 50 }]);
});

test("allocatePayment allocates proportionally", () => {
  const result = allocatePayment(100, [{ id: "a", due: 30 }, { id: "b", due: 70 }]);
  assert.deepEqual(result, [{ id: "a", amount: 30 }, { id: "b", amount: 70 }]);
});

test("allocatePayment conserves total", () => {
  const result = allocatePayment(75, [{ id: "a", due: 30 }, { id: "b", due: 70 }]);
  const total = result.reduce((sum, r) => sum + r.amount, 0);
  assert.equal(total, 75);
});

test("allocatePayment sorts by id", () => {
  const result = allocatePayment(100, [{ id: "z", due: 50 }, { id: "a", due: 50 }]);
  assert.deepEqual(result[0], { id: "a", amount: 50 });
  assert.deepEqual(result[1], { id: "z", amount: 50 });
});

test("allocatePayment rejects payment above total", () => {
  assert.throws(() => allocatePayment(200, [{ id: "a", due: 50 }]), /payment exceeds outstanding total/);
});

test("allocatePayment rejects duplicate ids", () => {
  assert.throws(() => allocatePayment(100, [{ id: "a", due: 50 }, { id: "a", due: 50 }]), /duplicate invoice id/);
});

test("allocatePayment rejects negative due", () => {
  assert.throws(() => allocatePayment(100, [{ id: "a", due: -10 }]), /due must be a finite non-negative number/);
});

test("largest remainder tie goes to lex smallest id", () => {
  // 100 split among 3 parts with weights 1,1,1: each gets 33, remainder 1
  // The extra 1 should go to the smallest id lexicographically
  const result = splitByWeights(100, [{ id: "c", weight: 1 }, { id: "a", weight: 1 }, { id: "b", weight: 1 }]);
  assert.equal(result[0].id, "a");
  assert.equal(result[0].amount, 34); // a gets the extra
  assert.equal(result[1].id, "b");
  assert.equal(result[1].amount, 33);
  assert.equal(result[2].id, "c");
  assert.equal(result[2].amount, 33);
});
