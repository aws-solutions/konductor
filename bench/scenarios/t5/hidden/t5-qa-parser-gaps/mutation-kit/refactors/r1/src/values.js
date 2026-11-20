"use strict";

const { ParseError } = require("./errors");

const MAX_VALUE = 1000000;
const MIN_NONZERO = 0.001;
const FACTORS = Object.freeze({ ms: 1, s: 1000, B: 1, KB: 1024, MB: 1024 * 1024 });
// One pattern: a number with an optional unit suffix.
const NUMERIC = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s|B|KB|MB)?$/;

const inRange = (n) => Number.isFinite(n) && n >= 0 && n <= MAX_VALUE && (n === 0 || n >= MIN_NONZERO);

class Quantity {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }

  to(unit) {
    if (!Object.prototype.hasOwnProperty.call(FACTORS, unit)) throw new RangeError(`unknown unit ${unit}`);
    const converted = (this.value * FACTORS[this.unit]) / FACTORS[unit];
    return new Quantity(Math.round(converted * 100) / 100, unit);
  }
}

function parseNumeric(value, line, column) {
  const m = value.match(NUMERIC);
  if (!m) return null;
  const number = Number(m[1]);
  if (!inRange(number)) throw new ParseError("number is outside the accepted range", line, column);
  return m[2] === undefined ? number : new Quantity(number, m[2]);
}

const isQuantity = (value) => value instanceof Quantity;

module.exports = { Quantity, FACTORS, MAX_VALUE, MIN_NONZERO, parseNumeric, isQuantity };
