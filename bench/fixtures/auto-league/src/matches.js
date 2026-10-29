'use strict';

const fs = require('node:fs');
const path = require('node:path');

function validateMatch(m) {
  if (typeof m.home !== 'string' || typeof m.away !== 'string' || m.home === m.away) throw new Error('a match needs two different players');
  for (const k of ['homeGoals', 'awayGoals']) {
    if (!Number.isInteger(m[k]) || m[k] < 0) throw new Error(`${k} must be a non-negative integer`);
  }
  return m;
}

function loadMatches(dataDir) {
  const file = path.join(dataDir, 'matches.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).map(validateMatch);
}

module.exports = { loadMatches, validateMatch };
