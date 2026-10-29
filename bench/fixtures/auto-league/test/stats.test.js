'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src');

test('summarize counts wins, draws, losses and goals per player, sorted by name', () => {
  const rows = summarize([
    { home: 'Zed', away: 'Amy', homeGoals: 3, awayGoals: 1 },
    { home: 'Amy', away: 'Zed', homeGoals: 2, awayGoals: 2 },
  ]);
  assert.deepEqual(rows, [
    { player: 'Amy', played: 2, won: 0, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 5 },
    { player: 'Zed', played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 5, goalsAgainst: 3 },
  ]);
});

test('no matches give no rows', () => {
  assert.deepEqual(summarize([]), []);
});
