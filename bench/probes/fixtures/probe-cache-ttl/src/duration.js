'use strict';

const UNITS = { ms: 1, s: 1000, m: 60 * 1000 };

// "250ms" -> 250, "90s" -> 90000, "5m" -> 300000
function parseDuration(text) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m)\s*$/.exec(String(text));
  if (!match) throw new Error(`bad duration: ${text}`);
  return Math.round(Number(match[1]) * UNITS[match[2]]);
}

module.exports = { parseDuration };
