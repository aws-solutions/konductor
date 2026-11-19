#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { Money, formatMoney } = require("../src");
const { invoicesFromJson } = require("../src/importer");

function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) { if (!args[i].startsWith("--") || args[i + 1] === undefined) throw new Error("bad arguments"); out[args[i].slice(2)] = args[++i]; }
  return out;
}
function main(argv) {
  const [command, ...args] = argv;
  if (command === "format") { const o = options(args); console.log(formatMoney(Money.fromMinor(Number(o.amount), o.currency), o.locale || "en-US")); return; }
  if (command === "list") { const o = options(args); const data = JSON.parse(fs.readFileSync(o.file, "utf8")); for (const invoice of invoicesFromJson(data)) console.log(`${invoice.id}	${invoice.balance.toString()}`); return; }
  console.log("usage: billing format --amount MINOR --currency CODE | list --file PATH");
}
try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
