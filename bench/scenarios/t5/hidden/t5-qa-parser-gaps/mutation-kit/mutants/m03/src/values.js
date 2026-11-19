"use strict";

const { ParseError } = require("./errors");

const MAX_VALUE = 1000000;
const MIN_NONZERO = 0.001;
const FACTORS = Object.freeze({ ms: 1, s: 1000, B: 1, KB: 1024, MB: 1024 * 1024 });
const quantityPattern = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s|B|KB|MB)$/;
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function checkRange(value, line, column) {
  if (!Number.isFinite(value) || value < 0 || value >= MAX_VALUE || (value !== 0 && value < MIN_NONZERO)) {
    throw new ParseError("number is outside the accepted range", line, column);
  }
}

class Quantity {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }

  to(unit) {
    if (!Object.prototype.hasOwnProperty.call(FACTORS, unit)) throw new RangeError(`unknown unit ${unit}`);
    const base = this.value * FACTORS[this.unit];
    const converted = base / FACTORS[unit];
    return new Quantity(Math.round(converted * 100) / 100, unit);
  }
}

function parseNumeric(value, line, column) {
  const quantity = value.match(quantityPattern);
  if (quantity) {
    const number = Number(quantity[1]);
    checkRange(number, line, column);
    return new Quantity(number, quantity[2]);
  }
  if (numberPattern.test(value)) {
    const number = Number(value);
    checkRange(number, line, column);
    return number;
  }
  return null;
}

function isQuantity(value) {
  return value instanceof Quantity;
}

module.exports = { Quantity, FACTORS, MAX_VALUE, MIN_NONZERO, parseNumeric, isQuantity };
