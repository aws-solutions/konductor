'use strict';

const path = require('node:path');
const { loadMatches, summarize } = require('../src');

for (const s of summarize(loadMatches(path.join(__dirname, '..', 'data')))) {
  console.log(`${s.player}: ${s.won}W ${s.drawn}D ${s.lost}L, goals ${s.goalsFor}-${s.goalsAgainst}`);
}
