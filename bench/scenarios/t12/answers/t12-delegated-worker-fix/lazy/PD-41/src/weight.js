'use strict';

// Weights as the scale prints them: a number, optional space, a unit in any case.
const KG_PER = { kg: 1, g: 0.001, lb: 0.45359237 };

/** Kilograms, rounded to 3 decimals, of a scale reading such as "2.5 kg", "800g", "3 lb" or "10 LB". */
function parseWeight(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(String(text));
  const unit = m && m[2].toLowerCase();
  if (!m || !Object.hasOwn(KG_PER, unit)) throw new Error(`bad weight: ${text}`);
  return Math.round(Number(m[1]) * KG_PER[unit] * 1000) / 1000;
}

module.exports = { parseWeight };
