"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
test("sample data remains readable", () => { const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data/sample-invoices.json"))); assert.equal(data.invoices.length, 2); });
