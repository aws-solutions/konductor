'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { leaderboard, loadMatches, summarize } = require('../src');

const m = (home, away, homeGoals, awayGoals) => ({ home, away, homeGoals, awayGoals, playedOn: '2025-01-01' });
const shipped = () => loadMatches(path.join(__dirname, '..', 'data'));
const pts = (table) => Object.fromEntries(table.map((r) => [r.player, r.points]));
const order = (table) => table.map((r) => r.player);

test('a win is worth 3 points, a draw 1 and a loss 0', () => {
  const t = leaderboard([m('A', 'B', 1, 0), m('C', 'D', 2, 2)]);
  assert.deepEqual(pts(t), { A: 3, B: 0, C: 1, D: 1 });
});

test('the table is ordered by points, highest first', () => {
  const t = leaderboard([m('A', 'B', 0, 1), m('B', 'C', 1, 0), m('A', 'C', 0, 1)]);
  assert.deepEqual(order(t), ['B', 'C', 'A']);
  assert.deepEqual(t.map((r) => r.points), [6, 3, 0]);
});

test('players level on points are ordered by goal difference', () => {
  // X and Y both end on 4 points; X is +3, Y is +1.
  const t = leaderboard([m('X', 'P', 4, 1), m('Y', 'Q', 2, 1), m('P', 'Y', 0, 0), m('Q', 'X', 0, 0)]);
  const x = t.find((r) => r.player === 'X');
  const y = t.find((r) => r.player === 'Y');
  assert.equal(x.points, y.points);
  assert.ok(order(t).indexOf('X') < order(t).indexOf('Y'));
});

test('players level on points and goal difference are ordered by goals scored', () => {
  // S and R both end on 6 points and +3; S scored 6 goals, R scored 3.
  const t = leaderboard([m('S', 'U', 4, 2), m('V', 'S', 1, 2), m('R', 'U', 2, 0), m('V', 'R', 0, 1)]);
  const s = t.find((r) => r.player === 'S');
  const r = t.find((x) => x.player === 'R');
  assert.equal(s.points, r.points);
  assert.ok(order(t).indexOf('S') < order(t).indexOf('R'), order(t).join());
});

test('players level on points, goal difference and goals scored share a rank and the next rank is skipped', () => {
  const t = leaderboard([m('Top', 'Mid1', 3, 0), m('Top', 'Mid2', 3, 0), m('Mid1', 'Low', 1, 0), m('Mid2', 'Low', 1, 0), m('Top', 'Low', 1, 0)]);
  assert.deepEqual(t.map((r) => [r.rank, r.player]), [[1, 'Top'], [2, 'Mid1'], [2, 'Mid2'], [4, 'Low']]);
});

test('ranks run from 1 without gaps when nobody is level', () => {
  const t = leaderboard([m('A', 'B', 3, 0), m('B', 'C', 2, 0), m('A', 'C', 1, 0)]);
  assert.deepEqual(t.map((r) => r.rank), [1, 2, 3]);
});

test('the shipped season table', () => {
  const t = leaderboard(shipped());
  assert.deepEqual(t.map((r) => [r.rank, r.player, r.points]), [[1, 'Ben', 8], [2, 'Dee', 7], [3, 'Ana', 4], [3, 'Eli', 4], [5, 'Cy', 4]]);
});
