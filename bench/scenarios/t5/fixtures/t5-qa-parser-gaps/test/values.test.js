"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Quantity } = require("../src/values");

test("converts exact quantities", () => {
  assert.equal(new Quantity(2, "s").to("ms").value, 2000);
  assert.equal(new Quantity(2, "MB").to("KB").value, 2048);
});

test("keeps quantity fields public", () => {
  const value = new Quantity(12, "ms");
  assert.equal(value.value, 12);
  assert.equal(value.unit, "ms");
});
