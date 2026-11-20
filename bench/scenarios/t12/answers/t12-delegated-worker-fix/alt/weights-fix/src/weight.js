'use strict';

// Kilograms per unit; a pound is exactly 0.45359237 kg.
const UNITS = new Map([['kg', 1], ['g', 0.001], ['lb', 0.45359237]]);

/** Kilograms, rounded to 3 decimals, of a scale reading such as "2.5 kg", "800g", "3 lb" or "10 LB". */
function parseWeight(text) {
  const m = String(text).trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/);
  const perUnit = m ? UNITS.get(m[2].toLowerCase()) : undefined;
  if (perUnit === undefined) throw new Error(`bad weight: ${text}`);
  return Number((Number(m[1]) * perUnit).toFixed(3));
}

module.exports = { parseWeight };
