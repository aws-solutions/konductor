"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, print } = require("../src");

test("prints stable simple values", () => {
  const source = 'name = "demo"\ncount = 4\nactive = false\n';
  const output = print(parse(source));
  assert.equal(output, 'active = false\ncount = 4\nname = demo\n');
});

test("prints arrays and sections", () => {
  const output = print(parse('name = "x"\n[server]\nport = 80\n'));
  assert.match(output, /\[server\]/);
  assert.match(output, /port = 80/);
});
