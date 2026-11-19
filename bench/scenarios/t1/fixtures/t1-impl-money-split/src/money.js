"use strict";
const { getCurrency } = require("./currency");

class Money {
  constructor(minor, currency) {
    if (!Number.isSafeInteger(minor)) throw new TypeError("minor amount must be a safe integer");
    this.minor = minor;
    this.currency = getCurrency(currency);
    Object.freeze(this);
  }
  static fromMinor(minor, currency) { return new Money(minor, currency); }
  static zero(currency) { return new Money(0, currency); }
  add(other) { this.assertCurrency(other); return new Money(this.minor + other.minor, this.currency); }
  subtract(other) { this.assertCurrency(other); return new Money(this.minor - other.minor, this.currency); }
  negate() { return new Money(-this.minor, this.currency); }
  isZero() { return this.minor === 0; }
  assertCurrency(other) {
    if (!(other instanceof Money) || other.currency.code !== this.currency.code) throw new TypeError("money values must use the same currency");
  }
  equals(other) { return other instanceof Money && other.currency.code === this.currency.code && other.minor === this.minor; }
  toJSON() { return { minor: this.minor, currency: this.currency.code }; }
  toString() { return `${this.currency.code} ${this.minor}`; }
}

module.exports = { Money };
