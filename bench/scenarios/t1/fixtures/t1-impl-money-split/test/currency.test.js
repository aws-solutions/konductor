"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { currencies, getCurrency } = require("../src");
test("known currencies expose minor units", () => { assert.equal(currencies.USD.minorUnit, 2); assert.equal(currencies.JPY.minorUnit, 0); });
test("currency lookup is case tolerant", () => assert.equal(getCurrency("kwd").minorUnit, 3));
test("unknown currency fails", () => assert.throws(() => getCurrency("ZZZ")));
