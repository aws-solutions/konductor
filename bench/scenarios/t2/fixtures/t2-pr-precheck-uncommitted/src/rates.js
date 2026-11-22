'use strict';

const table = require('../data/rates.json');

function findBand(weightKg, bands = table.bands) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) throw new RangeError('weight must be positive');
  const band = bands.find(({ maxKg }) => weightKg < maxKg);
  if (!band) throw new RangeError('weight exceeds rate table');
  return band;
}

function localRate(weightKg, origin, destination, bands = table.bands) {
  const band = findBand(weightKg, bands);
  const crossBorder = origin.country !== destination.country;
  return {
    amount: band.amount + (crossBorder ? table.surcharges.crossBorder : 0),
    currency: table.currency,
    source: 'local'
  };
}

function rateTableSummary(bands = table.bands) {
  return bands.map(({ maxKg, amount }) => ({ maxKg, amount }));
}

function bandLabel(band) {
  return `${band.maxKg} kg / ${band.amount.toFixed(2)}`;
}

function tableLabels(bands = table.bands) {
  return bands.map(bandLabel);
}

function currencyCode() {
  return table.currency;
}

module.exports = { findBand, localRate, rateTableSummary, bandLabel, tableLabels, currencyCode };
