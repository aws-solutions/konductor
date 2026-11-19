"use strict";
const { Money } = require("./money");
const { ValidationError } = require("./errors");

class Invoice {
  constructor({ id, total, paid, status = "open" } = {}) {
    if (typeof id !== "string" || id.length === 0) throw new ValidationError("invoice id is required");
    if (!(total instanceof Money)) throw new ValidationError("invoice total must be Money");
    const settled = paid === undefined ? Money.zero(total.currency) : paid;
    if (!(settled instanceof Money) || settled.currency.code !== total.currency.code) throw new ValidationError("invoice amounts must use one currency");
    if (settled.minor < 0 || settled.minor > total.minor) throw new ValidationError("paid amount is outside invoice total");
    if (!["open", "paid", "void"].includes(status)) throw new ValidationError("unknown invoice status");
    this.id = id;
    this.total = total;
    this.paid = settled;
    this.status = status;
  }
  get balance() { return this.total.subtract(this.paid); }
  get isOpen() { return this.status === "open" && this.balance.minor > 0; }
  recordPayment(amount) {
    if (!(amount instanceof Money) || amount.currency.code !== this.total.currency.code) throw new ValidationError("payment currency does not match invoice");
    if (amount.minor < 0 || amount.minor > this.balance.minor) throw new ValidationError("payment exceeds invoice balance");
    this.paid = this.paid.add(amount);
    if (this.paid.equals(this.total)) this.status = "paid";
    return this;
  }
  toJSON() { return { id: this.id, currency: this.total.currency.code, totalMinor: this.total.minor, paidMinor: this.paid.minor, status: this.status }; }
}
module.exports = { Invoice };
