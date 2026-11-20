#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { Money, formatMoney, splitByWeights, allocatePayment } = require("../src");
const { invoicesFromJson } = require("../src/importer");

function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) { 
    if (!args[i].startsWith("--") || args[i + 1] === undefined) throw new Error("bad arguments"); 
    out[args[i].slice(2)] = args[++i]; 
  }
  return out;
}

function parseWeights(str) {
  return str.split(",").map(pair => {
    const [id, weight] = pair.split("=");
    return { id, weight: Number(weight) };
  });
}

function parseInvoices(str) {
  return str.split(",").map(pair => {
    const [id, due] = pair.split("=");
    return { id, due: Number(due) };
  });
}

function print(rows) {
  console.log(JSON.stringify(rows.map(r => ({ id: r.id, minor: r.amount.minor, currency: r.amount.currency.code }))));
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "format") { 
    const o = options(args); 
    console.log(formatMoney(Money.fromMinor(Number(o.amount), o.currency), o.locale || "en-US")); 
    return; 
  }
  if (command === "list") { 
    const o = options(args); 
    const data = JSON.parse(fs.readFileSync(o.file, "utf8")); 
    for (const invoice of invoicesFromJson(data)) console.log(`${invoice.id}\t${invoice.balance.toString()}`); 
    return; 
  }
  if (command === "split") {
    const o = options(args);
    const parts = parseWeights(o.weights);
    print(splitByWeights(Money.fromMinor(Number(o.amount), o.currency), parts));
    return;
  }
  if (command === "allocate") {
    const o = options(args);
    const invoices = parseInvoices(o.invoices).map(i => ({ id: i.id, due: Money.fromMinor(i.due, o.currency) }));
    print(allocatePayment(Money.fromMinor(Number(o.amount), o.currency), invoices));
    return;
  }
  console.log("usage: billing format --amount MINOR --currency CODE | list --file PATH | split --amount MINOR --currency CODE --weights id=weight,... | allocate --amount MINOR --currency CODE --invoices id=due,...");
}
try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
