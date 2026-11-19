"use strict";

class Currency {
  constructor(code, minorUnit) {
    if (!/^[A-Z]{3}$/.test(code)) throw new TypeError("currency code must be three uppercase letters");
    if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) throw new RangeError("invalid minor unit size");
    this.code = code;
    this.minorUnit = minorUnit;
    Object.freeze(this);
  }
  toString() { return this.code; }
}

const currencies = Object.freeze({
  USD: new Currency("USD", 2),
  EUR: new Currency("EUR", 2),
  GBP: new Currency("GBP", 2),
  JPY: new Currency("JPY", 0),
  KWD: new Currency("KWD", 3)
});

function getCurrency(value) {
  if (value instanceof Currency) return value;
  if (typeof value !== "string") throw new TypeError("currency must be a code");
  const code = value.toUpperCase();
  if (!currencies[code]) throw new RangeError(`unsupported currency: ${value}`);
  return currencies[code];
}

module.exports = { Currency, currencies, getCurrency };
