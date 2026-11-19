"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
test("cli formats a value", () => { const output = execFileSync(process.execPath, ["bin/billing.js", "format", "--amount", "1234", "--currency", "USD"], { encoding: "utf8" }); assert.match(output, /12\.34/); });
