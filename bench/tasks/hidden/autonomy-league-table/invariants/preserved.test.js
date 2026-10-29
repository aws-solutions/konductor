'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { leaderboard, loadMatches, summarize } = require('../src');

const m = (home, away, homeGoals, awayGoals) => ({ home, away, homeGoals, awayGoals, playedOn: '2025-01-01' });
const shipped = () => loadMatches(path.join(__dirname, '..', 'data'));
const pts = (table) => Object.fromEntries(table.map((r) => [r.player, r.points]));
const order = (table) => table.map((r) => r.player);

test('every player in the matches appears exactly once', () => {
  const t = leaderboard(shipped());
  assert.deepEqual(order(t).sort(), ['Ana', 'Ben', 'Cy', 'Dee', 'Eli']);
});

test('no matches give an empty table', () => {
  assert.deepEqual(leaderboard([]), []);
});

test('a win is worth more than a loss and both sides of a draw get the same', () => {
  const t = leaderboard([m('W', 'L', 2, 1), m('D1', 'D2', 0, 0)]);
  assert.ok(pts(t).W > pts(t).L);
  assert.equal(pts(t).D1, pts(t).D2);
});

test('the matches passed in are not changed', () => {
  const input = shipped();
  const copy = JSON.parse(JSON.stringify(input));
  leaderboard(input);
  assert.deepEqual(input, copy);
});

test('summarize still returns the per-player totals', () => {
  const rows = summarize(shipped());
  assert.deepEqual(rows[0], { player: 'Ana', played: 4, won: 1, drawn: 1, lost: 2, goalsFor: 6, goalsAgainst: 7 });
});

test('rows carry a player, integer points and an integer rank, and ranks never decrease down the table', () => {
  const t = leaderboard(shipped());
  for (const r of t) {
    assert.equal(typeof r.player, 'string');
    assert.ok(Number.isInteger(r.points) && r.points >= 0);
    assert.ok(Number.isInteger(r.rank) && r.rank >= 1);
  }
  for (let i = 1; i < t.length; i++) assert.ok(t[i].rank >= t[i - 1].rank);
});

test('a player who won every match is first with rank 1', () => {
  const t = leaderboard([m('Champ', 'A', 1, 0), m('B', 'Champ', 0, 3), m('A', 'B', 1, 1)]);
  assert.equal(t[0].player, 'Champ');
  assert.equal(t[0].rank, 1);
});
