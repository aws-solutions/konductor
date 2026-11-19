"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parse } = require("../src");
const { Quantity } = require("../src/values");

test("parses common assignments and sections", () => {
  const config = parse('name = "demo"\nenabled = true\nsize = 2MB\n[server.http]\nport = 8080\n');
  assert.equal(config.name, "demo");
  assert.equal(config.enabled, true);
  assert.ok(config.size instanceof Quantity);
  assert.equal(config.server.http.port, 8080);
});

test("parses arrays and comments", () => {
  const config = parse('tags = ["one", "two",]\n# ignored\n');
  assert.deepEqual(config.tags, ["one", "two"]);
});

test("reports a missing equals sign", () => {
  assert.throws(() => parse("name \"bad\""), /line 1, column 6/);
});

test("accepts ordinary escaped strings", () => {
  assert.equal(parse('value = "a\\n\\t\\\"b"').value, 'a\n\t"b');
});
