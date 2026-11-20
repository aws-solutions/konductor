"use strict";
const { Invoice } = require("./invoice");
const { Money } = require("./money");
const { ValidationError } = require("./errors");

class Ledger {
  constructor(invoices = []) { this.invoices = []; for (const invoice of invoices) this.add(invoice); }
  add(invoice) {
    if (!(invoice instanceof Invoice)) throw new ValidationError("ledger accepts invoices");
    if (this.invoices.some(item => item.id === invoice.id)) throw new ValidationError("duplicate invoice id");
    this.invoices.push(invoice); return invoice;
  }
  get(id) { return this.invoices.find(invoice => invoice.id === id); }
  openInvoices() { return this.invoices.filter(invoice => invoice.isOpen); }
  totalOutstanding(currency) {
    const open = this.openInvoices().filter(invoice => !currency || invoice.total.currency.code === currency.toString());
    if (open.length === 0) return currency ? Money.zero(currency) : null;
    return open.slice(1).reduce((sum, invoice) => sum.add(invoice.balance), open[0].balance);
  }
  recordPayment(id, amount) {
    const invoice = this.get(id);
    if (!invoice) throw new ValidationError("invoice not found");
    invoice.recordPayment(amount); return invoice;
  }
}
module.exports = { Ledger };
