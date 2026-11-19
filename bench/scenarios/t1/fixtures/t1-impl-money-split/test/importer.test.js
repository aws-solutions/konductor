"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { invoicesFromJson } = require("../src");
test("importer reads invoice records", () => { const list = invoicesFromJson({ invoices: [{ id: "x", currency: "JPY", totalMinor: 5 }] }); assert.equal(list[0].balance.minor, 5); });
test("importer rejects missing list", () => assert.throws(() => invoicesFromJson({})));
