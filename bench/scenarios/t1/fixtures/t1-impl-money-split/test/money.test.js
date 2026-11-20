"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Money } = require("../src");
test("money adds in minor units", () => assert.equal(Money.fromMinor(2, "USD").add(Money.fromMinor(3, "USD")).minor, 5));
test("money rejects mixed currencies", () => assert.throws(() => Money.fromMinor(2, "USD").add(Money.fromMinor(3, "EUR"))));
test("money preserves a negative balance", () => assert.equal(Money.fromMinor(-2, "USD").minor, -2));
