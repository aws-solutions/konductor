'use strict';

// Weights as the scale prints them: a number, optional space, a unit.
const KG_PER = { kg: 1, g: 0.001, lb: 0.45 };

/** Kilograms, rounded to 3 decimals, of a scale reading such as "2.5 kg", "800g" or "3 lb". */
function parseWeight(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/.exec(String(text));
  if (!m || !Object.hasOwn(KG_PER, m[2])) throw new Error(`bad weight: ${text}`);
  return Math.round(Number(m[1]) * KG_PER[m[2]] * 1000) / 1000;
}

module.exports = { parseWeight };
