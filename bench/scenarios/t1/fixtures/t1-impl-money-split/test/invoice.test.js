"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Invoice, Money } = require("../src");
test("new invoice has full balance", () => { const i = new Invoice({ id: "a", total: Money.fromMinor(100, "USD") }); assert.equal(i.balance.minor, 100); assert.equal(i.isOpen, true); });
test("invoice records a payment", () => { const i = new Invoice({ id: "a", total: Money.fromMinor(100, "USD") }); i.recordPayment(Money.fromMinor(100, "USD")); assert.equal(i.status, "paid"); });
test("invoice rejects an overpayment", () => { const i = new Invoice({ id: "a", total: Money.fromMinor(100, "USD") }); assert.throws(() => i.recordPayment(Money.fromMinor(101, "USD"))); });
