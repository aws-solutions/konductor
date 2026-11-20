'use strict';

function lineError(index, field, rule) {
  return new TypeError(`Cart line ${index} has an invalid ${field}: ${rule}`);
}

function lineProblem(line) {
  if (!line || typeof line.sku !== 'string') {
    return ['sku', 'expected a string'];
  }
  if (!Number.isFinite(line.unitPrice)) {
    return ['unitPrice', 'expected a finite number'];
  }
  if (line.unitPrice < 0) {
    return ['unitPrice', 'must be zero or greater'];
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return ['quantity', 'expected a positive integer'];
  }
  return null;
}

function assertOrder(order) {
  if (!order || !Array.isArray(order.lines)) {
    throw new TypeError('order.lines must be an array');
  }
  for (const [index, line] of order.lines.entries()) {
    const problem = lineProblem(line);
    if (problem) {
      throw lineError(index, problem[0], problem[1]);
    }
  }
}

module.exports = { assertOrder };
