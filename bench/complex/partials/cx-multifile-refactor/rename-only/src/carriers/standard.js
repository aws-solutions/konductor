'use strict';

const roundCents = (n) => Math.round(n * 100) / 100;

const id = 'standard';
const fuelPct = 0.08;
const maxKg = 30;

function baseRate(weightKg, zone) {
  return roundCents(4.5 + 0.8 * weightKg + 0.35 * (zone - 1));
}

function available(weightKg, country) {
  return weightKg <= maxKg && country === 'US';
}

module.exports = { id, fuelPct, baseRate, available };
