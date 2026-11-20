"use strict";
const { Money } = require("./money");
const { ValidationError } = require("./errors");

function splitByWeights(total, parts) {
  if (total < 0) throw new ValidationError("total must be non-negative");
  const weights = parts.map(p => p.weight);
  if (weights.some(w => w < 0)) throw new ValidationError("weights must be non-negative");
  if (weights.every(w => w === 0)) throw new ValidationError("at least one weight must be positive");
  
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const results = [];
  let remainder = total;
  
  for (const part of parts) {
    const amount = Math.floor(total * part.weight / totalWeight);
    results.push({ id: part.id, amount });
    remainder -= amount;
  }
  
  // Distribute remainder to first items
  for (let i = 0; i < remainder; i++) {
    results[i].amount += 1;
  }
  
  return results.sort((a, b) => a.id.localeCompare(b.id)).map(r => ({ id: r.id, amount: r.amount }));
}

function allocatePayment(payment, invoices) {
  const totalDue = invoices.reduce((sum, inv) => sum + inv.due, 0);
  if (payment > totalDue) throw new ValidationError("payment exceeds outstanding total");
  
  const results = [];
  let remainder = payment;
  
  for (const inv of invoices) {
    const amount = Math.min(inv.due, remainder);
    results.push({ id: inv.id, amount });
    remainder -= amount;
  }
  
  return results.sort((a, b) => a.id.localeCompare(b.id)).map(r => ({ id: r.id, amount: r.amount }));
}

module.exports = { splitByWeights, allocatePayment };
