"use strict";
const { Money } = require("./money");
function formatMoney(money, locale = "en-US") {
  if (!(money instanceof Money)) throw new TypeError("expected Money");
  return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency.code, minimumFractionDigits: money.currency.minorUnit, maximumFractionDigits: money.currency.minorUnit }).format(money.minor / (10 ** money.currency.minorUnit));
}
function formatInvoice(invoice, locale = "en-US") { return `${invoice.id}: ${formatMoney(invoice.balance, locale)}`; }
module.exports = { formatMoney, formatInvoice };
