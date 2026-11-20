#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { Money, formatMoney, splitByWeights, allocatePayment } = require("../src");
const { invoicesFromJson } = require("../src/importer");
function options(args) { const out = {}; for (let i = 0; i < args.length; i += 1) { if (!args[i].startsWith("--") || args[i + 1] === undefined) throw new Error("bad arguments"); out[args[i].slice(2)] = args[++i]; } return out; }
function pairs(text, label) { if (typeof text !== "string" || text.length === 0) throw new Error(`${label} are required`); return text.split(",").map(item => { const at = item.lastIndexOf("="); if (at <= 0) throw new Error(`bad ${label}`); return { id: item.slice(0, at), value: Number(item.slice(at + 1)) }; }); }
function jsonRows(rows) { return rows.map(row => ({ id: row.id, minor: row.amount.minor, currency: row.amount.currency.code })); }
function main(argv) {
  const [command, ...args] = argv;
  if (command === "format") { const o = options(args); console.log(formatMoney(Money.fromMinor(Number(o.amount), o.currency), o.locale || "en-US")); return; }
  if (command === "list") { const o = options(args); const data = JSON.parse(fs.readFileSync(o.file, "utf8")); for (const invoice of invoicesFromJson(data)) console.log(`${invoice.id}	${invoice.balance.toString()}`); return; }
  if (command === "split") { const o = options(args); const parts = pairs(o.weights, "weights").map(item => ({ id: item.id, weight: item.value })); console.log(JSON.stringify(jsonRows(splitByWeights(Money.fromMinor(Number(o.amount), o.currency), parts)))); return; }
  if (command === "allocate") { const o = options(args); const invoices = pairs(o.invoices, "invoices").map(item => ({ id: item.id, due: Money.fromMinor(item.value, o.currency) })); console.log(JSON.stringify(jsonRows(allocatePayment(Money.fromMinor(Number(o.amount), o.currency), invoices)))); return; }
  console.log("usage: billing format --amount MINOR --currency CODE | list --file PATH | split --amount MINOR --currency CODE --weights id=weight,... | allocate --amount MINOR --currency CODE --invoices id=due,...");
}
try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
