'use strict';

const roundCents = (n) => Math.round(n * 100) / 100;

const id = 'express';
const fuelPct = 0.12;
const maxKg = 20;

function baseRate(weightKg, zone) {
  return roundCents(9 + 1.4 * weightKg + 0.9 * (zone - 1));
}

function available(weightKg) {
  return weightKg <= maxKg;
}

module.exports = { id, fuelPct, baseRate, available };
