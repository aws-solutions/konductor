"use strict";
const { Money } = require("./money");
const { getCurrency } = require("./currency");
const { ValidationError } = require("./errors");

function splitByWeights(total, parts) {
  // Validate total
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    throw new ValidationError("total must be a non-negative finite number");
  }
  
  // Validate parts structure
  if (!Array.isArray(parts)) {
    throw new ValidationError("parts must be an array");
  }
  
  const ids = new Set();
  const weights = [];
  
  for (const part of parts) {
    if (typeof part !== "object" || part === null) {
      throw new ValidationError("each part must be an object");
    }
    if (typeof part.id !== "string") {
      throw new ValidationError("each part must have a string id");
    }
    if (ids.has(part.id)) {
      throw new ValidationError("duplicate part id");
    }
    ids.add(part.id);
    if (typeof part.weight !== "number" || !Number.isFinite(part.weight) || part.weight < 0) {
      throw new ValidationError("weight must be a finite non-negative number");
    }
    weights.push(part.weight);
  }
  
  // Reject all-zero weights
  if (weights.length > 0 && weights.every(w => w === 0)) {
    throw new ValidationError("at least one weight must be positive");
  }
  
  // Handle empty parts
  if (parts.length === 0) {
    return [];
  }
  
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  
  // First pass: calculate base allocations and remainders
  const allocations = parts.map(part => {
    const baseAmount = Math.floor(total * part.weight / totalWeight);
    const remainder = (total * part.weight) % totalWeight;
    return { id: part.id, weight: part.weight, baseAmount, remainder };
  });
  
  const baseTotal = allocations.reduce((sum, r) => sum + r.baseAmount, 0);
  const leftover = total - baseTotal;
  
  // Distribute remainder using largest remainder method
  // Sort by remainder descending, then id ascending for ties
  const sortedByRemainder = allocations.map((r, i) => ({ ...r, index: i }))
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.id.localeCompare(b.id);
    });
  
  // Give extra units to top remainder recipients
  for (let i = 0; i < leftover; i++) {
    allocations[sortedByRemainder[i].index].baseAmount += 1;
  }
  
  // Sort by id and return with Money amounts (minor units as integers)
  return allocations
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(r => ({ id: r.id, amount: Math.round(r.baseAmount) }));
}

function allocatePayment(payment, invoices) {
  // Validate payment
  if (typeof payment !== "number" || !Number.isFinite(payment) || payment < 0) {
    throw new ValidationError("payment must be a non-negative finite number");
  }
  
  // Validate invoices structure
  if (!Array.isArray(invoices)) {
    throw new ValidationError("invoices must be an array");
  }
  
  const ids = new Set();
  const dues = [];
  
  for (const inv of invoices) {
    if (typeof inv !== "object" || inv === null) {
      throw new ValidationError("each invoice must be an object");
    }
    if (typeof inv.id !== "string") {
      throw new ValidationError("each invoice must have a string id");
    }
    if (ids.has(inv.id)) {
      throw new ValidationError("duplicate invoice id");
    }
    ids.add(inv.id);
    if (typeof inv.due !== "number" || !Number.isFinite(inv.due) || inv.due < 0) {
      throw new ValidationError("due must be a finite non-negative number");
    }
    dues.push(inv.due);
  }
  
  // Handle empty invoices
  if (invoices.length === 0) {
    return [];
  }
  
  const totalDue = dues.reduce((a, b) => a + b, 0);
  
  // Reject payment above outstanding total
  if (payment > totalDue) {
    throw new ValidationError("payment exceeds outstanding total");
  }
  
  // First pass: calculate base allocations and remainders
  const allocations = invoices.map(inv => {
    const baseAmount = Math.floor(payment * inv.due / totalDue);
    const remainder = (payment * inv.due) % totalDue;
    return { id: inv.id, due: inv.due, baseAmount, remainder };
  });
  
  const baseTotal = allocations.reduce((sum, r) => sum + r.baseAmount, 0);
  const leftover = payment - baseTotal;
  
  // Distribute remainder using largest remainder method
  // Sort by remainder descending, then id ascending for ties
  const sortedByRemainder = allocations.map((r, i) => ({ ...r, index: i }))
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.id.localeCompare(b.id);
    });
  
  // Give extra units to top remainder recipients
  for (let i = 0; i < leftover; i++) {
    allocations[sortedByRemainder[i].index].baseAmount += 1;
  }
  
  // Sort by id and return with Money amounts (minor units as integer)
  return allocations
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(r => ({ id: r.id, amount: Math.round(r.baseAmount) }));
}

module.exports = { splitByWeights, allocatePayment };
