'use strict';

const standard = require('./carriers/standard');
const express = require('./carriers/express');
const freight = require('./carriers/freight');
const { roundCents } = require('./util');

const carriers = [standard, express, freight];

function priceWith(carrier, weightKg, zone) {
  const base = carrier.baseRate(weightKg, zone);
  const fuel = roundCents(base * carrier.fuelPct);
  return { carrier: carrier.id, base, fuel, total: roundCents(base + fuel) };
}

module.exports = { carriers, priceWith };
