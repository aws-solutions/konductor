"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, validate, parseAndValidate } = require("../src");

test("validates the documented example", () => {
  const result = validate(parse('name = "demo"\ntimeout = 10ms\ntags = ["a"]'));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("reports missing required name", () => {
  const result = validate(parse("timeout = 10ms"));
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /name is required/);
});

test("parseAndValidate returns a valid object", () => {
  assert.equal(parseAndValidate('name = "ok"').name, "ok");
});
