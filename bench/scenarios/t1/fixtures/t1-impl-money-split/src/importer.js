"use strict";
const { Money } = require("./money");
const { Invoice } = require("./invoice");
function invoicesFromJson(value) {
  if (!value || !Array.isArray(value.invoices)) throw new TypeError("invoices array is required");
  return value.invoices.map(item => new Invoice({ id: item.id, total: Money.fromMinor(item.totalMinor, item.currency), paid: Money.fromMinor(item.paidMinor || 0, item.currency), status: item.status || "open" }));
}
module.exports = { invoicesFromJson };
