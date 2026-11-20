"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { splitByWeights, allocatePayment } = require("../src");

test("splitByWeights basic case", () => {
  const result = splitByWeights(100, [{ id: "a", weight: 1 }, { id: "b", weight: 1 }]);
  assert.deepEqual(result, [{ id: "a", amount: 50 }, { id: "b", amount: 50 }]);
});
