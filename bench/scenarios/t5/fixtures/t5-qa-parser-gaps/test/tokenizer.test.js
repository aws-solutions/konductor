"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { tokenize } = require("../src/tokenizer");

test("tokenizes punctuation and words", () => {
  const tokens = tokenize("name = demo");
  assert.deepEqual(tokens.map((token) => token.value), ["name", "=", "demo"]);
});

test("tracks a normal line break", () => {
  const tokens = tokenize("a = 1\nb = 2");
  assert.equal(tokens[3].line, 2);
  assert.equal(tokens[3].column, 1);
});
