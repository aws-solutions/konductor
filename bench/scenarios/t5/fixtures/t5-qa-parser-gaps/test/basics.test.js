"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, validate, print } = require("../src");

test("reads a plain name", () => assert.equal(parse("name = demo").name, "demo"));
test("reads an integer", () => assert.equal(parse("count = 4").count, 4));
test("reads a boolean", () => assert.equal(parse("flag = true").flag, true));
test("reads a populated list", () => assert.deepEqual(parse("tags = [one, two]").tags, ["one", "two"]));
test("validates a small document", () => assert.equal(validate(parse('name = "x"')).valid, true));
test("prints a name", () => assert.match(print(parse('name = "x"')), /name/));
test("reads a section value", () => assert.equal(parse("[a]\nb = 1").a.b, 1));
test("reads a time quantity", () => assert.equal(parse("n = 10ms").n.value, 10));
test("reads two assignments", () => assert.equal(parse("a = 1\nb = 2").b, 2));
test("reads a standard escape", () => assert.equal(parse('v = "line\\nnext"').v, "line\nnext"));
