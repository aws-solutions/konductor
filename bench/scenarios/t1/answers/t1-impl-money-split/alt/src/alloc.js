"use strict";
const { Money } = require("./money");
const { ValidationError } = require("./errors");

const SCALE = 12;

// Weights become integers with 12 decimal digits so the arithmetic below is exact.
function scaledWeight(weight, id) {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
    throw new ValidationError(`weight for ${id} must be finite and non-negative`);
  }
  const [whole, fraction = ""] = weight.toFixed(SCALE).split(".");
  return BigInt(whole + fraction);
}

function requireId(row, label) {
  if (row === null || typeof row !== "object" || typeof row.id !== "string" || row.id === "") {
    throw new ValidationError(`each ${label} needs a string id`);
  }
  return row.id;
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function requireMoney(value, label) {
  if (!(value instanceof Money)) throw new ValidationError(`${label} must be Money`);
  if (value.minor < 0) throw new ValidationError(`${label} must not be negative`);
  return value;
}

function uniqueSorted(rows, label) {
  if (!Array.isArray(rows)) throw new ValidationError(`${label} must be an array`);
  const seen = new Set();
  for (const row of rows) {
    const id = requireId(row, label);
    if (seen.has(id)) throw new ValidationError(`duplicate ${label} id: ${id}`);
    seen.add(id);
  }
  return rows.slice().sort(byId);
}

// Largest remainder placement. `entries` are already sorted by id, so the stable
// remainder sort leaves ties in ascending id order.
function distribute(total, entries) {
  const sum = entries.reduce((acc, e) => acc + e.weight, 0n);
  if (sum === 0n) throw new ValidationError("at least one weight must be positive");
  const amount = BigInt(total);
  const shares = entries.map((e) => ({ id: e.id, floor: (amount * e.weight) / sum, rest: (amount * e.weight) % sum }));
  let left = amount - shares.reduce((acc, s) => acc + s.floor, 0n);
  const order = shares.slice().sort((a, b) => (a.rest === b.rest ? 0 : a.rest > b.rest ? -1 : 1));
  for (const s of order) {
    if (left === 0n) break;
    s.floor += 1n;
    left -= 1n;
  }
  return shares.map((s) => ({ id: s.id, minor: Number(s.floor) }));
}

function toRows(shares, currency) {
  return shares.map((s) => ({ id: s.id, amount: Money.fromMinor(s.minor, currency) }));
}

function splitByWeights(total, parts) {
  requireMoney(total, "total");
  const sorted = uniqueSorted(parts, "part");
  if (sorted.length === 0) throw new ValidationError("parts are required");
  const entries = sorted.map((p) => ({ id: p.id, weight: scaledWeight(p.weight, p.id) }));
  return toRows(distribute(total.minor, entries), total.currency);
}

function allocatePayment(payment, invoices) {
  requireMoney(payment, "payment");
  const sorted = uniqueSorted(invoices, "invoice");
  if (sorted.length === 0) throw new ValidationError("invoices are required");
  const entries = sorted.map((inv) => {
    if (inv.closed === true || (inv.status !== undefined && inv.status !== "open")) {
      throw new ValidationError(`invoice ${inv.id} is closed`);
    }
    const due = requireMoney(inv.due, `due for ${inv.id}`);
    if (due.currency.code !== payment.currency.code) throw new ValidationError("payment and invoices must share one currency");
    return { id: inv.id, weight: BigInt(due.minor) };
  });
  const outstanding = entries.reduce((acc, e) => acc + e.weight, 0n);
  if (BigInt(payment.minor) > outstanding) throw new ValidationError("payment exceeds the outstanding total");
  if (outstanding === 0n) return toRows(entries.map((e) => ({ id: e.id, minor: 0 })), payment.currency);
  return toRows(distribute(payment.minor, entries), payment.currency);
}

module.exports = { splitByWeights, allocatePayment };
