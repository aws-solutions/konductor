// SPDX-License-Identifier: Apache-2.0
/**
 * Judge scales: how a reply becomes a winner and a 1-5 score on each scale, and which replies are
 * refused as unusable or inconsistent. Pure functions only: no model call, no file access.
 * Run: node --test bench/test/judge-scale.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCALES,
  DEFAULT_SCALE,
  TIE_MAX_GAP,
  resolveScale,
  parseOverall,
  parseItems,
  itemWeights,
  scoreFromWeights,
  winnerScoreConflict,
} = require('../lib/judge-scale');
const { unblind } = require('../lib/verdict');

const labels = (...v) => v;

// ---- the overall scale -----------------------------------------------------------------------

test('overall scale: a consistent reply gives the winner, both scores and the reason', () => {
  const r = parseOverall({ winner: 'A', score_a: 5, score_b: 3, reason: 'A is complete' });
  assert.deepEqual(r, {
    winner: 'A',
    score_a: 5,
    score_b: 3,
    reason: 'A is complete',
    problem: null,
  });
  assert.equal(parseOverall({ winner: 'b', score_a: 2, score_b: 4 }).winner, 'B');
  assert.equal(parseOverall({ winner: 'TIE', score_a: 3, score_b: 4 }).winner, 'TIE');
  assert.equal(parseOverall({ winner: 'TIE', score_a: 4, score_b: 4 }).reason, '');
});

test('overall scale: a winner that contradicts the scores makes the reply invalid', () => {
  for (const reply of [
    { winner: 'A', score_a: 2, score_b: 4 },
    { winner: 'A', score_a: 1, score_b: 2 },
    { winner: 'B', score_a: 5, score_b: 1 },
    { winner: 'B', score_a: 4, score_b: 3 },
  ]) {
    const r = parseOverall(reply);
    assert.equal(r.winner, null, JSON.stringify(reply));
    assert.equal(r.score_a, null);
    assert.equal(r.score_b, null);
    assert.match(r.problem, /contradicts the scores/);
  }
});

test('overall scale: a winner with equal scores is accepted and adds a gap of 0', () => {
  for (const winner of ['A', 'B']) {
    const r = parseOverall({ winner, score_a: 3, score_b: 3, reason: 'close' });
    assert.equal(r.winner, winner);
    assert.equal(unblind('with-first', r.score_a, r.score_b).delta, 0);
  }
});

test('overall scale: a TIE more than one point apart is invalid, one at the limit is not', () => {
  assert.equal(TIE_MAX_GAP, 1);
  assert.equal(parseOverall({ winner: 'TIE', score_a: 5, score_b: 3 }).winner, null);
  assert.match(
    parseOverall({ winner: 'TIE', score_a: 1, score_b: 5 }).problem,
    /a TIE needs scores at most 1 apart/,
  );
  assert.equal(parseOverall({ winner: 'TIE', score_a: 3, score_b: 2 }).winner, 'TIE');
  assert.equal(parseOverall({ winner: 'TIE', score_a: 2, score_b: 3 }).winner, 'TIE');
});

test('overall scale: a winner without scores is invalid, whatever the winner', () => {
  for (const winner of ['A', 'B', 'TIE']) {
    for (const reply of [
      { winner },
      { winner, score_a: 4 },
      { winner, score_b: 4 },
      { winner, score_a: null, score_b: null },
    ]) {
      const r = parseOverall(reply);
      assert.equal(r.winner, null, JSON.stringify(reply));
      assert.match(r.problem, /both scores must be integers/);
    }
  }
});

test('overall scale: scores outside 1-5 or not integers are invalid', () => {
  for (const [a, b] of [
    [0, 3],
    [6, 3],
    [3, 0],
    [3, 6],
    [-1, 2],
    [3.5, 2],
    [4, 2.5],
    ['4', 2],
    [4, '2'],
    [NaN, 2],
    [Infinity, 2],
    [true, 2],
  ]) {
    const r = parseOverall({ winner: 'A', score_a: a, score_b: b });
    assert.equal(r.winner, null, JSON.stringify([a, b]));
    assert.equal(r.score_a, null);
  }
  assert.equal(parseOverall({ winner: 'A', score_a: 5, score_b: 1 }).winner, 'A');
});

test('overall scale: no winner, an unknown winner and non-objects are invalid', () => {
  for (const reply of [
    {},
    { score_a: 5, score_b: 1 },
    { winner: 'C', score_a: 5, score_b: 1 },
    { winner: 7 },
    null,
    undefined,
    'A',
    [],
  ]) {
    const r = parseOverall(reply);
    assert.equal(r.winner, null, JSON.stringify(reply));
    assert.equal(r.reason, null);
    assert.ok(r.problem);
  }
});

test('winnerScoreConflict names the disagreement, or returns null when there is none', () => {
  assert.equal(winnerScoreConflict('A', 4, 4), null);
  assert.equal(winnerScoreConflict('A', 5, 1), null);
  assert.equal(winnerScoreConflict('B', 1, 5), null);
  assert.equal(winnerScoreConflict('TIE', 2, 3), null);
  assert.match(winnerScoreConflict('A', 2, 4), /winner A contradicts the scores/);
  assert.match(winnerScoreConflict('B', 4, 2), /winner B contradicts the scores/);
  assert.match(winnerScoreConflict('TIE', 5, 1), /a TIE needs scores at most 1 apart/);
});

test('every parse returns the same keys, whether the reply was usable or not', () => {
  const keys = (r) => ['winner', 'score_a', 'score_b', 'reason', 'problem'].every((k) => k in r);
  assert.ok(keys(parseOverall({ winner: 'A', score_a: 5, score_b: 1 })));
  assert.ok(keys(parseOverall(null)));
  assert.ok(keys(parseItems({ items_a: ['MET'], items_b: ['MET'] })));
  assert.ok(keys(parseItems(null)));
});

// ---- the items scale -------------------------------------------------------------------------

test('items scale: one label per checklist item becomes a 1-5 score on the same yardstick', () => {
  const all = parseItems(
    { items_a: labels('MET', 'MET', 'MET'), items_b: labels('MISSING', 'MISSING', 'MISSING') },
    { rubricLength: 3 },
  );
  assert.equal(all.score_a, 5);
  assert.equal(all.score_b, 1);
  assert.equal(all.winner, 'A');
  assert.equal(all.problem, null);

  const half = parseItems(
    { items_a: labels('MET', 'PARTIAL', 'MISSING'), items_b: labels('MET', 'MET', 'MISSING') },
    { rubricLength: 3 },
  );
  assert.equal(half.score_a, 1 + 4 * (1.5 / 3));
  assert.equal(half.score_b, 1 + 4 * (2 / 3));
  assert.equal(half.winner, 'B');
});

test('items scale: the winner is derived from the labels, not read from the reply', () => {
  const r = parseItems(
    {
      winner: 'A',
      items_a: labels('MISSING', 'MISSING', 'MISSING'),
      items_b: labels('MET', 'MET', 'MET'),
    },
    { rubricLength: 3 },
  );
  assert.equal(r.winner, 'B');
});

test('items scale: equal label totals are a TIE and one PARTIAL step still separates', () => {
  const tie = parseItems(
    {
      items_a: labels('MET', 'PARTIAL', 'MISSING'),
      items_b: labels('PARTIAL', 'MET', 'MISSING'),
    },
    { rubricLength: 3 },
  );
  assert.equal(tie.winner, 'TIE');
  const onePartial = parseItems(
    { items_a: labels('MET', 'MET', 'PARTIAL'), items_b: labels('MET', 'MET', 'MISSING') },
    { rubricLength: 3 },
  );
  assert.equal(onePartial.winner, 'A');
});

test('items scale: a reply that is not one usable label per item is refused', () => {
  const bad = [
    { items_a: labels('MET', 'MET'), items_b: labels('MET', 'MET', 'MET') },
    { items_a: labels('MET', 'MET', 'MET', 'MET'), items_b: labels('MET', 'MET', 'MET', 'MET') },
    { items_a: labels('MET', 'MET'), items_b: labels('MET', 'MET') },
    { items_a: labels('MET', 'YES', 'MET'), items_b: labels('MET', 'MET', 'MET') },
    { items_a: labels(), items_b: labels() },
    { items_a: 'MET,MET,MET', items_b: labels('MET', 'MET', 'MET') },
    { winner: 'A', score_a: 5, score_b: 1 },
    {},
    null,
  ];
  for (const p of bad) {
    const r = parseItems(p, { rubricLength: 3 });
    assert.equal(r.winner, null, `refuses ${JSON.stringify(p)}`);
    assert.equal(r.score_a, null);
    assert.equal(r.score_b, null);
    assert.ok(r.problem);
  }
});

test('items scale: labels are case- and space-insensitive and are stored normalized', () => {
  const r = parseItems(
    { items_a: labels(' met ', 'Partial', 'missing'), items_b: labels('MET', 'MET', 'MET') },
    { rubricLength: 3 },
  );
  assert.equal(r.score_a, 1 + 4 * (1.5 / 3));
  assert.deepEqual(r.items_a, ['MET', 'PARTIAL', 'MISSING']);
});

test('items scale: without a checklist length the two arrays only have to agree', () => {
  const r = parseItems({ items_a: labels('MET', 'MET'), items_b: labels('MET', 'MISSING') });
  assert.equal(r.winner, 'A');
  assert.equal(itemWeights(labels('MET', 'MET'), null).length, 2);
  assert.equal(itemWeights(labels('MET', 'MET'), 3), null);
});

test('items scale: the gap un-blinds by presentation order', () => {
  const parsed = parseItems(
    {
      items_a: labels('MET', 'MET', 'MET'),
      items_b: labels('MISSING', 'MISSING', 'MISSING'),
    },
    { rubricLength: 3 },
  );
  assert.equal(unblind('with-first', parsed.score_a, parsed.score_b).delta, 4);
  assert.equal(unblind('without-first', parsed.score_a, parsed.score_b).delta, -4);
});

test('each scale refuses the other scale reply shape', () => {
  const overallReply = { winner: 'A', score_a: 5, score_b: 3 };
  const itemsReply = {
    items_a: labels('MET', 'MET', 'MET'),
    items_b: labels('MET', 'MET', 'MISSING'),
  };
  assert.equal(SCALES.overall.parse(overallReply).winner, 'A');
  assert.equal(SCALES.items.parse(overallReply, { rubricLength: 3 }).winner, null);
  assert.equal(SCALES.overall.parse(itemsReply).winner, null);
  assert.equal(SCALES.items.parse(itemsReply, { rubricLength: 3 }).winner, 'A');
});

test('scoreFromWeights spans the full scale', () => {
  assert.equal(scoreFromWeights([1, 1]), 5);
  assert.equal(scoreFromWeights([0, 0]), 1);
  assert.equal(scoreFromWeights([0.5, 0.5]), 3);
});

// ---- scales ----------------------------------------------------------------------------------

test('the default scale is overall and an unknown scale throws', () => {
  assert.equal(DEFAULT_SCALE, 'overall');
  assert.equal(resolveScale().id, 'overall');
  assert.equal(resolveScale('').id, 'overall');
  assert.equal(resolveScale(null).id, 'overall');
  assert.equal(resolveScale('items').id, 'items');
  assert.throws(() => resolveScale('nope'), /unknown judge scale/);
  assert.throws(() => resolveScale('constructor'), /unknown judge scale/);
  assert.throws(() => resolveScale('__proto__'), /unknown judge scale/);
});

test('each scale names its own template file and prompt version', () => {
  assert.equal(SCALES.overall.templateFile, `judge-prompt.v${SCALES.overall.promptVersion}.md`);
  assert.equal(
    SCALES.items.templateFile,
    `judge-prompt.items.v${SCALES.items.promptVersion}.md`,
  );
  assert.notEqual(SCALES.overall.templateFile, SCALES.items.templateFile);
  assert.ok(Object.isFrozen(SCALES) && Object.isFrozen(SCALES.overall));
});
