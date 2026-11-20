// Changes for this request; see the commit message for the reasoning.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, validate, print } = require("../src");
const { Quantity } = require("../src/values");
const { Tokenizer } = require("../src/tokenizer");

test("rejects a quoted string that ends with an escape", () => {
  const input = 'value = "unfinished' + "\\";
  assert.throws(() => parse(input), /unterminated escape/);
});

test("handles empty documents and empty sections", () => {
  assert.deepEqual(parse("   # only a comment\n"), {});
  const result = parse("[empty]");
  assert.deepEqual(result.empty, {});
});

test("accepts the numeric endpoints and rejects values beyond them", () => {
  const result = parse("small = 0.001ms\nlarge = 1000000ms");
  assert.equal(result.small.value, 0.001);
  assert.equal(result.large.value, 1000000);
  assert.throws(() => parse("tooSmall = 0.0009ms"), /outside the accepted range/);
  assert.throws(() => parse("tooLarge = 1000001ms"), /outside the accepted range/);
});

test("rounds converted quantities to two decimal places", () => {
  assert.equal(new Quantity(1.234567, "s").to("ms").value, 1234.57);
});

test("keeps validation positions after a multiline value", () => {
  const result = validate(parse('message = "first\nsecond"\nname = 42'));
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /^line 3, column 1: name must be a string$/);
});

test("rejects duplicate keys in one section", () => {
  assert.throws(() => parse('name = "one"\nname = "two"'), /duplicate key/);
});

test("allows eight section names but rejects nine", () => {
  const eight = "[a.b.c.d.e.f.g.h]\nvalue = 1";
  assert.equal(parse(eight).a.b.c.d.e.f.g.h.value, 1);
  assert.throws(() => parse("[a.b.c.d.e.f.g.h.i]\nvalue = 1"), /at most 8/);
});

test("quotes strings that would change type when printed", () => {
  const original = parse('truth = "true"\nquantity = "10ms"\nphrase = "two words"');
  const output = print(original);
  assert.match(output, /truth = "true"/);
  assert.deepEqual(parse(output), original);
});

test("resets tokenizer positions between calls", () => {
  const tokenizer = new Tokenizer();
  tokenizer.tokenize("first = 1\n");
  const tokens = tokenizer.tokenize("value = 2");
  assert.equal(tokens[0].line, 1);
  assert.equal(tokens[0].column, 1);
});

test("rejects a timeout without a time unit", () => {
  const result = validate(parse('name = "x"\ntimeout = 5'));
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /timeout must have a time unit/);
});
