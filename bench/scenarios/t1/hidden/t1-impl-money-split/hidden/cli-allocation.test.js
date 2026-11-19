"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const node = process.execPath;
function run(...args) { return JSON.parse(execFileSync(node, ["bin/billing.js", ...args], { encoding: "utf8" })); }
test("split CLI emits minor amounts and currency", () => { assert.deepEqual(run("split", "--amount", "5", "--currency", "JPY", "--weights", "a=1,b=1"), [{ id: "a", minor: 3, currency: "JPY" }, { id: "b", minor: 2, currency: "JPY" }]); });
test("allocate CLI emits stable invoice allocations", () => { assert.deepEqual(run("allocate", "--amount", "3", "--currency", "USD", "--invoices", "z=2,a=2"), [{ id: "a", minor: 2, currency: "USD" }, { id: "z", minor: 1, currency: "USD" }]); });
