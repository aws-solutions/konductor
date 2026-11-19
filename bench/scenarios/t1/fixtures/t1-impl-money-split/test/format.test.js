"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Money, formatMoney, formatInvoice, Invoice } = require("../src");
test("USD formatting includes currency", () => assert.match(formatMoney(Money.fromMinor(1234, "USD")), /12\.34/));
test("invoice formatting includes id", () => assert.match(formatInvoice(new Invoice({ id: "x", total: Money.fromMinor(100, "USD") })), /^x:/));
