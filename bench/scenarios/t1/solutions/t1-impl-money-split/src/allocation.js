"use strict";
const { Money } = require("./money");
const { ValidationError } = require("./errors");

function decimalParts(value) {
  const text = String(value).toLowerCase();
  const [mantissa, exponentText] = text.split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const dot = mantissa.indexOf(".");
  const fractionDigits = dot < 0 ? 0 : mantissa.length - dot - 1;
  const digits = mantissa.replace(".", "");
  const shift = exponent - fractionDigits;
  if (shift >= 0) return { numerator: BigInt(digits) * (10n ** BigInt(shift)), scale: 0 };
  return { numerator: BigInt(digits), scale: -shift };
}
function integerWeights(parts) {
  const parsed = parts.map(part => decimalParts(part.weight));
  const scale = Math.max(...parsed.map(item => item.scale));
  return parsed.map(item => item.numerator * (10n ** BigInt(scale - item.scale)));
}
function validatePart(part, index) {
  if (!part || typeof part.id !== "string" || part.id.length === 0) throw new ValidationError(`part ${index} needs an id`);
  if (typeof part.weight !== "number" || !Number.isFinite(part.weight) || part.weight < 0) throw new ValidationError(`weight for ${part.id} must be non-negative`);
}
function validateTotal(total) {
  if (!(total instanceof Money)) throw new ValidationError("total must be Money");
  if (total.minor < 0) throw new ValidationError("total must be non-negative");
}
function orderedParts(parts) {
  const seen = new Set();
  parts.forEach((part, index) => { validatePart(part, index); if (seen.has(part.id)) throw new ValidationError(`duplicate id: ${part.id}`); seen.add(part.id); });
  return parts.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function largestRemainder(total, parts, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight === 0n) throw new ValidationError("at least one weight must be positive");
  const amount = BigInt(total);
  const rows = parts.map((part, index) => {
    const numerator = amount * weights[index];
    return { part, base: numerator / totalWeight, remainder: numerator % totalWeight };
  });
  let assigned = rows.reduce((sum, row) => sum + row.base, 0n);
  let remaining = amount - assigned;
  rows.slice().sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : (a.part.id < b.part.id ? -1 : a.part.id > b.part.id ? 1 : 0)).forEach(row => {
    if (remaining > 0n) { row.base += 1n; remaining -= 1n; }
  });
  return rows.map(row => Number(row.base));
}
function splitByWeights(total, inputParts) {
  validateTotal(total);
  if (!Array.isArray(inputParts) || inputParts.length === 0) throw new ValidationError("parts are required");
  const parts = orderedParts(inputParts);
  const weights = integerWeights(parts);
  return largestRemainder(total.minor, parts, weights).map((minor, index) => ({ id: parts[index].id, amount: Money.fromMinor(minor, total.currency) }));
}
function invoiceDue(invoice, index) {
  if (!invoice || typeof invoice.id !== "string" || invoice.id.length === 0) throw new ValidationError(`invoice ${index} needs an id`);
  if (invoice.status !== undefined && invoice.status !== "open") throw new ValidationError(`invoice ${invoice.id} is not open`);
  const due = invoice.due instanceof Money ? invoice.due : invoice.balance;
  if (!(due instanceof Money)) throw new ValidationError(`invoice ${invoice.id} needs a due amount`);
  if (due.minor < 0) throw new ValidationError(`invoice ${invoice.id} has a negative due amount`);
  return { id: invoice.id, due };
}
function allocatePayment(payment, invoices) {
  validateTotal(payment);
  if (!Array.isArray(invoices) || invoices.length === 0) throw new ValidationError("invoices are required");
  const normalized = invoices.map(invoiceDue);
  const ids = new Set();
  normalized.forEach(item => { if (ids.has(item.id)) throw new ValidationError(`duplicate invoice id: ${item.id}`); ids.add(item.id); if (item.due.currency.code !== payment.currency.code) throw new ValidationError("all payment amounts must use the same currency"); });
  normalized.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const outstanding = normalized.reduce((sum, item) => sum + item.due.minor, 0);
  if (payment.minor > outstanding) throw new ValidationError("payment exceeds outstanding invoices");
  if (outstanding === 0) return normalized.map(item => ({ id: item.id, amount: Money.zero(payment.currency) }));
  const amounts = largestRemainder(payment.minor, normalized, normalized.map(item => BigInt(item.due.minor)));
  return amounts.map((minor, index) => ({ id: normalized[index].id, amount: Money.fromMinor(minor, payment.currency) }));
}
module.exports = { allocatePayment, splitByWeights };
