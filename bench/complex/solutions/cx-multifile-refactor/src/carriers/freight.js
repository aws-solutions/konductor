'use strict';

// Freight is billed in 5 cent steps, always rounded up.
const roundToNickel = (n) => Math.ceil(n * 20) / 20;

const id = 'freight';
const fuelPct = 0.15;

function baseRate(weightKg, zone) {
  return roundToNickel(40 + 0.35 * weightKg + 6 * (zone - 1));
}

function available(weightKg, country) {
  return weightKg > 30 && weightKg <= 500 && country === 'US';
}

module.exports = { id, fuelPct, baseRate, available };
