// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, scorecard, rate, agreementOf, THRESHOLDS } = require('../../report/diligence.js');

// A study in which every criterion passes. Each test breaks one fact.
function good(over = {}) {
  const f = {
    arms: ['a', 'b', 'c'], baseline: 'a', study: { comparison: true, capability: true, judged: true },
    replicates: { min: 3, cell: 'a/t1', cells: 6 }, aaArms: ['a', 'b'], sameRefRepeat: false,
    aa: { pair: ['a', 'b'], qualitySpread: 2, costSpread: 0.05, largestDelta: { quality: 10, cost: 0.5, arms: 1 }, spanHours: 3 },
    controls: { positive: 1, negative: 1 },
    judging: {
      present: true, judges: ['j1', 'j2', 'j3'], families: ['gpt', 'deepseek', 'glm'], claude: [], expected: 9, unjudged: [], rubricTasks: 2, parseFailures: 0,
      pairwise: { run: true, records: 6, bothOrders: 6 }, agreement: { pairs: 100, exact: 0.7, withinOne: 0.95 }, truncated: 0, stale: 0,
    },
    calibration: { kappa: 0.7 }, checks: { withChecks: 9, currentRevision: 9, stale: 0 }, hidden: { tasks: 2, withHidden: 2 }, headroom: { tasks: 4, ceilingTasks: [] },
    failures: { n: 18, timeout: 0, error: 0, infraError: 0, modelMismatch: 0, checksFailed: 1 }, censored: 0, contamination: { audited: 9, flagged: 0, externalFetch: 0, fixRecall: 0 },
    pin: { runs: 18, verified: 18, mismatch: 0 }, isolation: { modes: ['unshare'], unknown: 0, tripwire: 0, runs: 18 }, budget: { recorded: true, cap: 100, spent: 50, skipped: 0 },
    provenance: { missing: [], dirty: false, dirs: 1 }, taskValidation: { ok: true }, hasDifferentModels: false,
  };
  return { ...f, ...over };
}
const by = (cs, id) => cs.find((c) => c.id === id);
const status = (f, id) => by(evaluate(f), id).status;

test('a fully documented study is supported and every criterion has a value and a threshold', () => {
  const card = scorecard(good());
  assert.equal(card.rating, 'supported');
  assert.equal(card.counts.FAIL + card.counts.WARN, 0);
  for (const c of card.criteria) assert.ok(c.value && c.threshold && c.label, c.id);
});

test('replicates: 3 pass, 2 warn, 1 fail', () => {
  for (const [n, s] of [[3, 'PASS'], [5, 'PASS'], [2, 'WARN'], [1, 'FAIL'], [0, 'FAIL']]) assert.equal(status(good({ replicates: { min: n, cell: 'x', cells: 1 } }), 'replicates'), s, `n=${n}`);
});

test('A/A: present passes, absent warns, single arm is N/A, a same-ref repeat counts', () => {
  assert.equal(status(good(), 'aa'), 'PASS');
  assert.equal(status(good({ aaArms: null, aa: null }), 'aa'), 'WARN');
  assert.equal(status(good({ aaArms: null, aa: null, sameRefRepeat: true }), 'aa'), 'PASS');
  assert.equal(status(good({ study: { comparison: false, capability: false, judged: true }, aaArms: null, aa: null }), 'aa'), 'N/A');
});

test('controls: needed only for capability studies; unknown is WARN', () => {
  assert.equal(status(good(), 'controls'), 'PASS');
  assert.equal(status(good({ controls: { positive: 1, negative: 0 } }), 'controls'), 'WARN');
  assert.equal(status(good({ study: { comparison: true, capability: false, judged: true } }), 'controls'), 'N/A');
});

test('judge coverage: all pass, over 90% warn, under 90% fail, unjudged are listed', () => {
  const j = (unjudged, expected = 20) => ({ ...good().judging, expected, unjudged });
  assert.equal(status(good({ judging: j([]) }), 'coverage'), 'PASS');
  assert.equal(status(good({ judging: j(['a/t#1']) }), 'coverage'), 'WARN');
  assert.equal(status(good({ judging: j(['a/t#1', 'a/t#2', 'a/t#3']) }), 'coverage'), 'FAIL');
  assert.match(by(evaluate(good({ judging: j(['a/t1#2']) })), 'coverage').value, /a\/t1#2/);
});

test('judge panel: three families pass, two warn, a Claude judge fails', () => {
  const p = (families, claude = []) => ({ ...good().judging, families, claude });
  assert.equal(status(good({ judging: p(['a', 'b', 'c']) }), 'families'), 'PASS');
  assert.equal(status(good({ judging: p(['a', 'b']) }), 'families'), 'WARN');
  assert.equal(status(good({ judging: p(['a', 'b', 'c'], ['claude-x']) }), 'families'), 'FAIL');
});

test('judge agreement needs within-one >= 0.9 and exact >= 0.6', () => {
  const ag = (exact, withinOne) => good({ judging: { ...good().judging, agreement: { pairs: 50, exact, withinOne } } });
  assert.equal(status(ag(0.6, 0.9), 'agreement'), 'PASS');
  assert.equal(status(ag(0.59, 0.9), 'agreement'), 'WARN');
  assert.equal(status(ag(0.9, 0.89), 'agreement'), 'WARN');
  assert.equal(status(ag(0.9, 0.74), 'agreement'), 'FAIL');
  assert.equal(status(good({ judging: { ...good().judging, agreement: null, judges: ['j1'] } }), 'agreement'), 'N/A');
  assert.equal(status(good({ judging: { ...good().judging, agreement: null } }), 'agreement'), 'WARN');
});

test('parse failures: 0 passes, anything else warns', () => {
  assert.equal(status(good({ judging: { ...good().judging, parseFailures: 1 } }), 'parse'), 'WARN');
  assert.equal(status(good(), 'parse'), 'PASS');
});

test('both orderings: all records, none, or some', () => {
  const o = (records, bothOrders) => good({ judging: { ...good().judging, pairwise: { run: true, records, bothOrders } } });
  assert.equal(status(o(4, 4), 'orders'), 'PASS');
  assert.equal(status(o(4, 3), 'orders'), 'FAIL');
  assert.equal(status(o(0, 0), 'orders'), 'WARN');
  assert.equal(status(good({ judging: { ...good().judging, pairwise: { run: false, records: 0, bothOrders: 0 } } }), 'orders'), 'N/A');
});

test('calibration: kappa 0.6 passes; lower or missing is WARN uncalibrated', () => {
  assert.equal(status(good({ calibration: { kappa: 0.6 } }), 'calibration'), 'PASS');
  assert.equal(status(good({ calibration: { kappa: 0.59 } }), 'calibration'), 'WARN');
  const none = by(evaluate(good({ calibration: null })), 'calibration');
  assert.equal(none.status, 'WARN');
  assert.match(none.value, /uncalibrated/);
});

test('truncation: any truncated record warns', () => {
  assert.equal(status(good({ judging: { ...good().judging, truncated: 1 } }), 'truncation'), 'WARN');
});

test('checks must carry the current revision and no stale judgment may remain', () => {
  assert.equal(status(good({ checks: { withChecks: 4, currentRevision: 3, stale: 0 } }), 'checks'), 'WARN');
  assert.equal(status(good({ checks: { withChecks: 4, currentRevision: 4, stale: 1 } }), 'checks'), 'WARN');
  assert.equal(status(good({ checks: { withChecks: 0, currentRevision: 0, stale: 0 } }), 'checks'), 'N/A');
});

test('hidden tests: all tasks pass, some or none warn', () => {
  assert.equal(status(good({ hidden: { tasks: 4, withHidden: 3 } }), 'hidden'), 'WARN');
  assert.equal(status(good({ hidden: { tasks: 4, withHidden: 0 } }), 'hidden'), 'WARN');
});

test('headroom: ceiling share up to 25% passes', () => {
  assert.equal(status(good({ headroom: { tasks: 4, ceilingTasks: ['t1'] } }), 'headroom'), 'PASS');
  assert.equal(status(good({ headroom: { tasks: 4, ceilingTasks: ['t1', 't2'] } }), 'headroom'), 'WARN');
  assert.equal(status(good({ headroom: { tasks: 0, ceilingTasks: [] } }), 'headroom'), 'N/A');
});

test('failures: none pass, a few warn, over 20% fail', () => {
  const fl = (timeout, n = 20) => good({ failures: { n, timeout, error: 0, infraError: 0, modelMismatch: 0, checksFailed: 0 } });
  assert.equal(status(fl(0), 'failures'), 'PASS');
  assert.equal(status(fl(4), 'failures'), 'WARN');
  assert.equal(status(fl(5), 'failures'), 'FAIL');
});

test('censored credits and contamination warn when present', () => {
  assert.equal(status(good({ censored: 2 }), 'censored'), 'WARN');
  assert.equal(status(good({ contamination: { audited: 4, flagged: 1, externalFetch: 1, fixRecall: 0 } }), 'contamination'), 'WARN');
  assert.equal(status(good({ contamination: null }), 'contamination'), 'N/A');
});

test('model pin: all verified passes, unrecorded warns, a mismatch fails', () => {
  assert.equal(status(good({ pin: { runs: 4, verified: 3, mismatch: 0 } }), 'pin'), 'WARN');
  assert.equal(status(good({ pin: { runs: 4, verified: 3, mismatch: 1 } }), 'pin'), 'FAIL');
  assert.equal(status(good({ pin: { runs: 0, verified: 0, mismatch: 0 } }), 'pin'), 'WARN');
});

test('isolation: a tripwire flag, no isolation or unrecorded mode warns', () => {
  assert.equal(status(good({ isolation: { modes: ['unshare'], unknown: 0, tripwire: 1, runs: 4 } }), 'isolation'), 'WARN');
  assert.equal(status(good({ isolation: { modes: ['none'], unknown: 0, tripwire: 0, runs: 4 } }), 'isolation'), 'WARN');
  assert.equal(status(good({ isolation: { modes: [], unknown: 4, tripwire: 0, runs: 4 } }), 'isolation'), 'WARN');
});

test('budget: over the cap, skipped cells or an unrecorded cap warn', () => {
  assert.equal(status(good({ budget: { recorded: true, cap: 10, spent: 11, skipped: 0 } }), 'budget'), 'WARN');
  assert.equal(status(good({ budget: { recorded: true, cap: 10, spent: 5, skipped: 2 } }), 'budget'), 'WARN');
  assert.equal(status(good({ budget: { recorded: false, cap: null, spent: 5, skipped: 0 } }), 'budget'), 'WARN');
  assert.equal(status(good({ budget: { recorded: true, cap: null, spent: 5, skipped: 0 } }), 'budget'), 'PASS');
});

test('drift: A/A spread over 15% cost or 5 points quality or runs more than a day apart warn', () => {
  const aa = (o) => good({ aa: { ...good().aa, ...o } });
  assert.equal(status(aa({ costSpread: 0.15 }), 'drift'), 'PASS');
  assert.equal(status(aa({ costSpread: 0.16 }), 'drift'), 'WARN');
  assert.equal(status(aa({ qualitySpread: 5.1 }), 'drift'), 'WARN');
  assert.equal(status(aa({ spanHours: 30 }), 'drift'), 'WARN');
  assert.equal(status(good({ aa: null }), 'drift'), 'N/A');
});

test('provenance: complete and clean passes; missing or dirty warns, and names what is missing', () => {
  assert.equal(status(good({ provenance: { missing: [], dirty: true, dirs: 1 } }), 'provenance'), 'WARN');
  const m = by(evaluate(good({ provenance: { missing: ['content hash'], dirty: false, dirs: 1 } })), 'provenance');
  assert.equal(m.status, 'WARN');
  assert.match(m.value, /content hash/);
});

test('task validation: unknown is WARN, never PASS', () => {
  const u = by(evaluate(good({ taskValidation: null })), 'validation');
  assert.equal(u.status, 'WARN');
  assert.match(u.value, /not recorded/);
  assert.equal(status(good({ taskValidation: { ok: false } }), 'validation'), 'FAIL');
});

test('unknown data is never PASS: a fact with nothing recorded gives WARN on every recorded-data criterion', () => {
  const blank = good({
    calibration: null, taskValidation: null, provenance: { missing: ['bench commit', 'content hash', 'tool versions', 'arm SHAs', 'dirty flag'], dirty: false, dirs: 1 },
    budget: { recorded: false, cap: null, spent: 0, skipped: 0 }, isolation: { modes: [], unknown: 3, tripwire: 0, runs: 3 }, pin: { runs: 3, verified: 0, mismatch: 0 },
    checks: { withChecks: 3, currentRevision: 0, stale: 0 },
  });
  for (const id of ['calibration', 'validation', 'provenance', 'budget', 'isolation', 'pin', 'checks']) assert.equal(status(blank, id), 'WARN', id);
});

test('rating: a key FAIL is anecdotal, a key WARN is indicative, all key PASS is supported', () => {
  assert.equal(scorecard(good({ replicates: { min: 1, cell: 'x', cells: 1 } })).rating, 'anecdotal');
  assert.equal(scorecard(good({ judging: { ...good().judging, families: ['a', 'b', 'c'], claude: ['claude-opus'] } })).rating, 'anecdotal');
  assert.equal(scorecard(good({ replicates: { min: 2, cell: 'x', cells: 1 } })).rating, 'indicative');
  assert.equal(scorecard(good({ calibration: null })).rating, 'supported', 'a non-key WARN does not block supported');
  assert.equal(scorecard(good({ failures: { n: 10, timeout: 5, error: 0, infraError: 0, modelMismatch: 0, checksFailed: 0 } })).rating, 'indicative', 'a non-key FAIL blocks supported');
});

test('rating lists the key criteria that stop it from being supported', () => {
  const card = scorecard(good({ aa: null, aaArms: null }));
  assert.equal(card.rating, 'indicative');
  assert.deepEqual(card.blockers.map((b) => b.id), ['aa']);
  assert.deepEqual(rate([{ key: true, status: 'N/A' }]).rating, 'supported');
});

test('every criterion value is free of NaN and undefined even for odd facts', () => {
  const odd = good({ aa: { pair: ['a', 'b'], qualitySpread: null, costSpread: null, largestDelta: { quality: 0, cost: 0, arms: 0 }, spanHours: null }, judging: { ...good().judging, agreement: { pairs: 0, exact: 0, withinOne: 0 } } });
  const text = JSON.stringify(scorecard(odd));
  assert.ok(!/NaN|undefined|Infinity/.test(text));
});

test('agreement counts exact and within-one over criterion pairs of the same run', () => {
  const rec = (judge, verdicts) => ({ judge, armId: 'a', taskId: 't', replicate: 1, criteria: verdicts.map((v, i) => ({ id: `c${i}`, verdict: v })) });
  const a = agreementOf([rec('j1', ['pass', 'pass', 'fail', 'partial']), rec('j2', ['pass', 'partial', 'pass', 'partial'])]);
  assert.equal(a.pairs, 4);
  assert.equal(a.exact, 0.5);
  assert.equal(a.withinOne, 0.75);
  assert.equal(agreementOf([rec('j1', ['pass'])]), null);
  assert.equal(agreementOf([{ ...rec('j1', ['pass']), judgeError: 'x' }, rec('j2', ['pass'])]), null);
});

test('thresholds are the ones the README states', () => {
  assert.equal(THRESHOLDS.replicatesPass, 3);
  assert.equal(THRESHOLDS.withinOneMin, 0.9);
  assert.equal(THRESHOLDS.exactMin, 0.6);
  assert.equal(THRESHOLDS.kappaMin, 0.6);
  assert.equal(THRESHOLDS.headroomShare, 0.25);
});
