"use strict";
const { Money, Invoice, Ledger } = require("../src");
const ledger = new Ledger([new Invoice({ id: "sample", total: Money.fromMinor(1000, "USD") })]);
process.stdout.write(JSON.stringify(ledger.invoices));
