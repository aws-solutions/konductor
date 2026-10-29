'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { leaderboard } = require('../src');

const m = (home, away, homeGoals, awayGoals) => ({ home, away, homeGoals, awayGoals });

test('leaderboard scores 3 for a win and 1 for a draw and ranks by points, level players sharing a rank', () => {
  const t = leaderboard([m('A', 'B', 2, 0), m('C', 'D', 1, 1)]);
  assert.deepEqual(t.map((r) => [r.rank, r.player, r.points]), [[1, 'A', 3], [2, 'C', 1], [2, 'D', 1], [4, 'B', 0]]);
});
