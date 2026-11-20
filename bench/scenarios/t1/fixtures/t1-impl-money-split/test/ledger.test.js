"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Invoice, Ledger, Money } = require("../src");
function invoice(id, amount) { return new Invoice({ id, total: Money.fromMinor(amount, "USD") }); }
test("ledger finds invoices", () => { const l = new Ledger([invoice("a", 10)]); assert.equal(l.get("a").id, "a"); });
test("ledger totals open balances", () => assert.equal(new Ledger([invoice("a", 10), invoice("b", 20)]).totalOutstanding("USD").minor, 30));
test("ledger rejects duplicate ids", () => assert.throws(() => new Ledger([invoice("a", 10), invoice("a", 20)])));
