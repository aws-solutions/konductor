// SPDX-License-Identifier: Apache-2.0
/**
 * Verdict unit tests: gradedVerdict (the judge-gap rule `paired-t/v1`), wordCheckGate (the
 * word-check veto) and unblind (judge scores to with and without). Pure functions only: no model
 * call, no file access.
 * Run: node --test bench/test/verdict.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const rule = require('../lib/decision-rule');
const {
  gradedVerdict,
  wordCheckGate,
  unblind,
  isUsablePair,
  REVIEW,
  ORDERS,
} = require('../lib/verdict');

const G = (mean, extra = {}) => ({ counted: true, loaded: true, scored: true, mean_delta: mean, ...extra });
const gp = (values, extra) => values.map((v) => G(v, extra));
/** Pairs with a judge gap and a word-check gap. A null `w` is a task without checks. */
const gw = (means, ws) => means.map((m, i) => G(m, { w: ws[i] }));

const KEEP = [2.5, 2.7, 2.6, 2.4, 2.8, 2.5, 2.6, 2.7];
const PRUNE = [-0.8, -0.5, -0.6, -0.7, -0.9, -0.6, -0.7, -0.8];
const STRADDLE = [1.5, -1.2, 0.4, 0.2, -0.1, 0.6, -0.3, 0.1];
const rep = (v, n) => Array(n).fill(v);

// ---- gradedVerdict ---------------------------------------------------------------------------

test('gradedVerdict: fewer than eight scored pairs always goes to review, however strong the gap', () => {
  for (const n of [1, 3, 7]) {
    const r = gradedVerdict(gp(rep(4, n)));
    assert.equal(r.verdict, REVIEW, `n=${n}`);
    assert.match(r.reason, /need at least 8/);
    assert.equal(r.pairs, n);
    assert.equal(r.mean, 4);
    assert.equal(r.ci, null);
  }
  const eight = rep(4, 8).map((v, i) => v + i * 0.01);
  assert.equal(gradedVerdict(gp(eight)).verdict, 'keep');
});

test('gradedVerdict: n=7 waits and the eighth strong pair decides', () => {
  const strong = (n) => gp(Array.from({ length: n }, (_, i) => 3 + i * 0.01));
  const seven = gradedVerdict(strong(7));
  assert.equal(seven.verdict, REVIEW);
  assert.match(seven.reason, /only 7 scored pairs, need at least 8/);
  assert.equal(gradedVerdict(strong(8)).verdict, 'keep');
  // Pairs that failed the treatment check do not count toward the floor.
  const dropped = gradedVerdict([...strong(7), ...gp([3, 3], { counted: false })]);
  assert.match(dropped.reason, /only 7 usable pairs, need at least 8 \(2\/9 failed the treatment check\)/);
});

test('gradedVerdict: at n=8 crafted gaps give keep, prune and review', () => {
  const keep = gradedVerdict(gp(KEEP));
  assert.equal(keep.verdict, 'keep');
  assert.ok(keep.ci[0] > rule.KEEP_FLOOR);
  assert.match(keep.reason, /95% lower bound above \+0\.1/);
  const prune = gradedVerdict(gp(PRUNE));
  assert.equal(prune.verdict, 'prune');
  assert.ok(prune.prune_ci[1] < rule.PRUNE_FLOOR);
  assert.match(prune.reason, /99% upper bound below -0\.2/);
  const straddle = gradedVerdict(gp(STRADDLE));
  assert.equal(straddle.verdict, REVIEW);
  assert.match(straddle.reason, /does not clear/);
  // A tight but tiny effect clears neither floor.
  assert.equal(gradedVerdict(gp([0.04, 0.05, 0.06, 0.04, 0.05, 0.06, 0.05, 0.04])).verdict, REVIEW);
  assert.equal(gradedVerdict(gp([-0.04, -0.05, -0.06, -0.04, -0.05, -0.06, -0.05, -0.04])).verdict, REVIEW);
});

test('gradedVerdict: prune_blocked_reason turns a prune into review', () => {
  const blocked = gradedVerdict(gp(PRUNE), { blocked_reason: 'outputs are not observed' });
  assert.equal(blocked.verdict, REVIEW);
  assert.match(blocked.reason, /prune is blocked: outputs are not observed/);
  assert.equal(
    gradedVerdict(gp(KEEP), { blocked_reason: 'outputs are not observed' }).verdict,
    'keep',
    'a block applies to prune only',
  );
});

test('gradedVerdict: the variance divides by n - 1 and the interval uses n - 1 degrees of freedom', () => {
  // Four pairs at 0.95 and four at 0.05: mean 0.5, sum of squares 1.62, 7 df, t 2.365.
  const means = [0.95, 0.95, 0.95, 0.95, 0.05, 0.05, 0.05, 0.05];
  const r = gradedVerdict(gp(means));
  assert.ok(Math.abs(r.mean - 0.5) < 1e-12);
  const se = Math.sqrt(1.62 / 7 / 8);
  assert.ok(Math.abs(se - 0.17008401285415226) < 1e-15);
  assert.ok(Math.abs(r.ci[0] - 0.09775130959992989) < 1e-12, `lower ${r.ci[0]}`);
  assert.ok(Math.abs(r.ci[1] - 0.9022486904000702) < 1e-12, `upper ${r.ci[1]}`);
  assert.ok(Math.abs(r.prune_ci[1] - 1.0099118705367485) < 1e-12, `prune upper ${r.prune_ci[1]}`);
  // Dividing by n would give a lower bound of 0.1237 and a keep; n - 1 keeps it just under +0.1.
  assert.equal(r.verdict, REVIEW);
  const mirror = gradedVerdict(gp(means.map((m) => -m)));
  assert.ok(Math.abs(mirror.prune_ci[1] - (-0.5 + 2.998 * se)) < 1e-12);
  assert.equal(mirror.verdict, REVIEW);
});

test('gradedVerdict: degrees of freedom clamp at 30', () => {
  // 20 pairs at 1.0 and 20 at 0.0 for n = 40, then a spread that gives a nonzero error.
  const means = [...rep(1, 20), ...rep(0, 20)];
  const n = means.length;
  const mean = 0.5;
  const se = Math.sqrt((n * 0.25) / (n - 1) / n);
  const r = gradedVerdict(gp(means));
  assert.ok(Math.abs(r.ci[0] - (mean - rule.T_975[29] * se)) < 1e-12, 'df 39 uses the 30 df value, 2.042');
  assert.ok(Math.abs(r.ci[0] - (mean - 2.042 * se)) < 1e-12);
  assert.ok(Math.abs(r.prune_ci[1] - (mean + 2.457 * se)) < 1e-12);
  // The same spread at n = 32 and n = 40 uses the same t, so only the error differs.
  const spread = (k) => gp([...rep(1, k / 2), ...rep(0, k / 2)]);
  const a = gradedVerdict(spread(32));
  const seA = Math.sqrt((32 * 0.25) / 31 / 32);
  assert.ok(Math.abs(a.ci[1] - (0.5 + 2.042 * seA)) < 1e-12);
});

test('gradedVerdict: keep and prune need the bound strictly beyond the threshold', () => {
  // Thirteen equal values have no spread, so the interval collapses onto the value; 13 copies of
  // 0.1 and of -0.2 average back to exactly 0.1 and -0.2 in floating point.
  const same = (v) => rep(v, 13);
  assert.equal(same(0.1).reduce((a, b) => a + b, 0) / 13, 0.1);
  assert.equal(same(-0.2).reduce((a, b) => a + b, 0) / 13, -0.2);
  const atKeep = gradedVerdict(gp(same(rule.KEEP_FLOOR)));
  assert.deepEqual(atKeep.ci, [0.1, 0.1]);
  assert.equal(atKeep.verdict, REVIEW, 'a lower bound equal to +0.1 is not above it');
  assert.equal(gradedVerdict(gp(same(0.1000001))).verdict, 'keep');
  assert.equal(gradedVerdict(gp(same(0.0999999))).verdict, REVIEW);
  const atPrune = gradedVerdict(gp(same(rule.PRUNE_FLOOR)));
  assert.deepEqual(atPrune.prune_ci, [-0.2, -0.2]);
  assert.equal(atPrune.verdict, REVIEW, 'an upper bound equal to -0.2 is not below it');
  assert.equal(gradedVerdict(gp(same(-0.2000001))).verdict, 'prune');
  assert.equal(gradedVerdict(gp(same(-0.1999999))).verdict, REVIEW);
});

test('gradedVerdict: a non-finite gap is review, not a drop', () => {
  const withBad = gradedVerdict([...gp(KEEP), G(NaN), G(null), G(undefined), G(Infinity)]);
  assert.equal(withBad.verdict, REVIEW, 'dropping them would let the other eight decide alone');
  assert.equal(withBad.invalid, 4);
  assert.equal(withBad.pairs, 8);
  assert.match(withBad.reason, /4\/12 pairs are marked scored but have no finite score gap/);
  const onlyBad = gradedVerdict([G(NaN), G(null)]);
  assert.equal(onlyBad.verdict, REVIEW);
  assert.match(onlyBad.reason, /2\/2 pairs are marked scored but have no finite score gap/);
  assert.equal(onlyBad.pairs, 0);
  // A pair that was never scored has no gap by definition: it is unscored, not invalid.
  const unscored = gradedVerdict([...gp(KEEP), G(null, { scored: false }), G(NaN, { scored: false })]);
  assert.equal(unscored.verdict, 'keep');
  assert.equal(unscored.invalid, 0);
  assert.equal(unscored.unscored, 2);
  assert.equal(unscored.pairs, 8);
});

test('gradedVerdict: a mean or interval that overflows is not a verdict', () => {
  const huge = gradedVerdict(gp(rep(1.7e308, 8)));
  assert.equal(huge.verdict, REVIEW);
  assert.match(huge.reason, /not finite/);
  assert.equal(huge.ci, null);
});

test('gradedVerdict: a pair that never loaded blocks the decision', () => {
  const strong = gp(KEEP);
  const missing = gradedVerdict([...strong, G(2.6, { counted: false, loaded: false })]);
  assert.equal(missing.verdict, REVIEW);
  assert.match(missing.reason, /did not load in 1\/9/);
  assert.equal(missing.load_failed, 1);
  const noFlag = gradedVerdict([...strong, G(2.6, { counted: false, loaded: undefined })]);
  assert.match(noFlag.reason, /did not load in 1\/9/, 'a missing flag is not given the benefit of the doubt');
});

test('gradedVerdict: a failed treatment check or an unscored pair is dropped and the rest decide', () => {
  const strong = gp(KEEP);
  const treatment = gradedVerdict([...strong, G(2.6, { counted: false })]);
  assert.equal(treatment.verdict, 'keep');
  assert.equal(treatment.treatment_failed, 1);
  assert.equal(treatment.pairs, 8);
  assert.match(
    gradedVerdict(gp([1, 1], { counted: false })).reason,
    /no pair took the directive \(2\/2 failed the treatment check\)/,
  );
  const unscored = gradedVerdict([...strong, G(2.6, { scored: false })]);
  assert.equal(unscored.verdict, 'keep');
  assert.equal(unscored.unscored, 1);
  assert.equal(unscored.pairs, 8);
  assert.match(unscored.reason, /1\/9 pairs unscored \(fewer than 2 judge seats gave a valid score\)/);
  assert.equal(gradedVerdict([...strong, G(2.6, { scored: undefined })]).unscored, 1);
  assert.doesNotMatch(gradedVerdict(strong).reason, /unscored/);
});

test('gradedVerdict: unscored pairs are excluded from the mean and named in every kind of reason', () => {
  const few = gradedVerdict([G(1), G(1, { scored: false })]);
  assert.match(few.reason, /only 1 scored pairs.*1\/2 pairs unscored/);
  const none = gradedVerdict([G(1, { scored: false })]);
  assert.match(none.reason, /no pair carried judge scores.*1\/1 pairs unscored/);
  const load = gradedVerdict([G(1, { loaded: false, counted: false }), G(1, { scored: false })]);
  assert.match(load.reason, /did not load.*1\/2 pairs unscored/);
  // The unscored pair's gap, however large, is not in the mean.
  const r = gradedVerdict([...gp(KEEP), G(-100, { scored: false })]);
  assert.equal(r.verdict, 'keep');
  assert.ok(r.mean > 2);
});

test('gradedVerdict: the result carries no vote or noise field', () => {
  const r = gradedVerdict(gp(KEEP));
  assert.deepEqual(
    Object.keys(r).sort(),
    ['ci', 'excluded', 'invalid', 'load_failed', 'mean', 'pairs', 'prune_ci', 'reason', 'treatment_failed', 'unscored', 'verdict'],
  );
});

test('isUsablePair: counted, scored and a finite gap, with a missing field counting against the pair', () => {
  assert.equal(isUsablePair(G(1)), true);
  for (const bad of [
    G(1, { counted: false }),
    G(1, { counted: undefined }),
    G(1, { scored: false }),
    G(1, { scored: undefined }),
    G(NaN),
    G(null),
    G(Infinity),
  ])
    assert.equal(isUsablePair(bad), false);
});

// ---- wordCheckGate: golden vectors -----------------------------------------------------------

// Four pairs at +0.4 and four at 0: mean 0.2, sum of squares 0.32, 7 df, t 2.365,
// standard error sqrt(0.32 / 7 / 8) = 0.07559289...
const W_SE = Math.sqrt(0.32 / 7 / 8);
const W_UP = [...rep(0.4, 4), ...rep(0, 4)];
const W_DOWN = W_UP.map((v) => -v);
// Mean -0.1, sum of squares 0.8, standard error 0.1195: the interval is [-0.38, +0.18] and reaches above 0.
const W_MIX = [-0.5, -0.5, 0.3, 0.3, -0.3, -0.3, 0.1, 0.1];
const W_FLAT = rep(0, 8);

test('wordCheckGate: the interval of known gaps matches a hand computation', () => {
  const out = wordCheckGate(gradedVerdict(gp(KEEP)), gw(KEEP, W_UP));
  assert.equal(out.word_check.gate, 'on');
  assert.equal(out.word_check.pairs, 8);
  assert.ok(Math.abs(out.word_check.mean - 0.2) < 1e-12);
  assert.ok(Math.abs(out.word_check.ci[0] - (0.2 - 2.365 * W_SE)) < 1e-12);
  assert.ok(Math.abs(out.word_check.ci[1] - (0.2 + 2.365 * W_SE)) < 1e-12);
  assert.ok(out.word_check.ci[0] > 0, 'the vectors sit just clear of zero, so a flip of sign flips the veto');
});

test('wordCheckGate: judge keep with checks that agree or are flat stays keep', () => {
  for (const ws of [W_UP, W_FLAT]) {
    const out = wordCheckGate(gradedVerdict(gp(KEEP)), gw(KEEP, ws));
    assert.equal(out.verdict, 'keep');
    assert.equal(out.judge_verdict, 'keep');
    assert.equal(out.word_check.vetoed, false);
    assert.match(out.reason, /95% lower bound above \+0\.1; word-check gap/);
  }
  const flat = wordCheckGate(gradedVerdict(gp(KEEP)), gw(KEEP, W_FLAT));
  assert.deepEqual(flat.word_check.ci, [0, 0], 'an interval at zero is not below zero');
});

test('wordCheckGate: judge keep, with arm passes fewer checks, interval includes 0: keep, gap reported', () => {
  const out = wordCheckGate(gradedVerdict(gp(KEEP)), gw(KEEP, W_MIX));
  assert.equal(out.verdict, 'keep');
  assert.equal(out.word_check.vetoed, false);
  assert.ok(out.word_check.mean < 0 && out.word_check.ci[1] > 0);
  assert.match(
    out.reason,
    /word-check gap \(with minus without\) -0\.10 \(95% interval \[-0\.38, \+0\.18\] over 8 pairs\)/,
  );
});

test('wordCheckGate: judge keep, interval entirely below 0: review, and the reason says which way', () => {
  const out = wordCheckGate(gradedVerdict(gp(KEEP)), gw(KEEP, W_DOWN));
  assert.equal(out.verdict, REVIEW);
  assert.equal(out.judge_verdict, 'keep');
  assert.equal(out.word_check.vetoed, true);
  assert.ok(Math.abs(out.word_check.ci[1] - (-0.2 + 2.365 * W_SE)) < 1e-12);
  assert.ok(out.word_check.ci[1] < 0);
  assert.match(out.reason, /^word checks say the skill is worse: /);
  assert.match(out.reason, /judge verdict was keep \(mean score gap 2\.60/);
});

test('wordCheckGate: judge prune, with arm gains clearly on checks: review', () => {
  const out = wordCheckGate(gradedVerdict(gp(PRUNE)), gw(PRUNE, W_UP));
  assert.equal(out.verdict, REVIEW);
  assert.equal(out.judge_verdict, 'prune');
  assert.equal(out.word_check.vetoed, true);
  assert.match(out.reason, /^word checks say the skill is better: /);
  assert.match(out.reason, /judge verdict was prune/);
});

test('wordCheckGate: judge prune with checks that agree, are flat or include 0 stays prune', () => {
  for (const ws of [W_DOWN, W_FLAT, W_MIX.map((v) => -v)]) {
    const out = wordCheckGate(gradedVerdict(gp(PRUNE)), gw(PRUNE, ws));
    assert.equal(out.verdict, 'prune');
    assert.equal(out.word_check.vetoed, false);
  }
});

test('wordCheckGate: a keep is not vetoed by a gain and a prune is not vetoed by a loss', () => {
  assert.equal(wordCheckGate(gradedVerdict(gp(KEEP)), gw(KEEP, W_UP)).verdict, 'keep');
  assert.equal(wordCheckGate(gradedVerdict(gp(PRUNE)), gw(PRUNE, W_DOWN)).verdict, 'prune');
});

test('wordCheckGate: a task without checks counts in the judge mean and is left out of the check set', () => {
  const means = [...KEEP, 2.6];
  const ws = [...W_DOWN, null];
  const pairs = gw(means, ws);
  const graded = gradedVerdict(pairs);
  assert.equal(graded.pairs, 9, 'the no-check task is in the judge mean');
  const out = wordCheckGate(graded, pairs);
  assert.equal(out.word_check.pairs, 8, 'and not among the pairs with checks');
  assert.equal(out.verdict, REVIEW);
  assert.equal(out.word_check.gate, 'on');
});

test('wordCheckGate: below eight pairs with checks the gate is off and the reason says how many', () => {
  const ws = [...W_DOWN.slice(0, 7), null];
  const pairs = gw(KEEP, ws);
  const out = wordCheckGate(gradedVerdict(pairs), pairs);
  assert.equal(out.verdict, 'keep', 'even a clear loss cannot veto below eight');
  assert.equal(out.word_check.gate, 'off');
  assert.equal(out.word_check.pairs, 7);
  assert.equal(out.word_check.mean, null);
  assert.match(out.reason, /7 pairs with checks, need 8$/);
  const none = wordCheckGate(gradedVerdict(gp(KEEP)), gp(KEEP));
  assert.match(none.reason, /0 pairs with checks, need 8$/, 'a pair with no w field has no checks');
  assert.equal(none.verdict, 'keep');
});

test('wordCheckGate: only usable pairs count toward the eight', () => {
  // Eight pairs with checks, but one is unscored: it is not usable, so only seven count.
  const pairs = [...gw(KEEP.slice(0, 7), W_DOWN.slice(0, 7)), G(2.6, { scored: false, w: -0.4 })];
  const graded = gradedVerdict([...pairs, ...gp([2.6])]);
  const out = wordCheckGate(graded, [...pairs, ...gp([2.6])]);
  assert.equal(out.word_check.pairs, 7);
  assert.equal(out.word_check.gate, 'off');
});

test('wordCheckGate: a judge verdict of review stays review and shows the word-check numbers', () => {
  const out = wordCheckGate(gradedVerdict(gp(STRADDLE)), gw(STRADDLE, W_UP));
  assert.equal(out.verdict, REVIEW);
  assert.equal(out.judge_verdict, REVIEW);
  assert.equal(out.word_check.vetoed, false);
  assert.ok(Math.abs(out.word_check.mean - 0.2) < 1e-12);
  assert.match(out.reason, /does not clear.*; word-check gap/);
  const few = wordCheckGate(gradedVerdict(gp(KEEP.slice(0, 7))), gw(KEEP.slice(0, 7), W_UP.slice(0, 7)));
  assert.equal(few.verdict, REVIEW);
  assert.match(few.reason, /only 7 scored pairs.*7 pairs with checks, need 8/);
});

test('wordCheckGate: never creates a keep or a prune from review', () => {
  for (const [means, ws] of [
    [STRADDLE, W_UP],
    [STRADDLE, W_DOWN],
    [KEEP.slice(0, 7), W_UP.slice(0, 7)],
  ]) {
    const pairs = gw(means, ws);
    assert.equal(wordCheckGate(gradedVerdict(pairs), pairs).verdict, REVIEW);
  }
  const blocked = gw(PRUNE, W_DOWN);
  const graded = gradedVerdict(blocked, { blocked_reason: 'x' });
  assert.equal(wordCheckGate(graded, blocked).verdict, REVIEW);
});

test('wordCheckGate: a gap that is not finite fails closed on a keep and is ignored by a review', () => {
  const huge = rep(1.7e308, 8);
  const pairs = gw(KEEP, huge);
  const out = wordCheckGate(gradedVerdict(pairs), pairs);
  assert.equal(out.verdict, REVIEW);
  assert.equal(out.word_check.vetoed, true);
  assert.match(out.reason, /word-check gap is not finite/);
  const rev = gw(STRADDLE, huge);
  assert.equal(wordCheckGate(gradedVerdict(rev), rev).verdict, REVIEW);
  assert.equal(wordCheckGate(gradedVerdict(rev), rev).word_check.vetoed, false);
});

test('wordCheckGate: a load failure stays review and the input is not changed', () => {
  const pairs = [...gw(KEEP, W_DOWN), G(2.6, { counted: false, loaded: false, w: 0.1 })];
  const graded = gradedVerdict(pairs);
  assert.equal(graded.verdict, REVIEW);
  const out = wordCheckGate(graded, pairs);
  assert.equal(out.verdict, REVIEW);
  assert.match(out.reason, /did not load in 1\/9/);
  const frozen = Object.freeze(gradedVerdict(gp(KEEP)));
  const frozenPairs = Object.freeze(gw(KEEP, W_DOWN).map(Object.freeze));
  assert.doesNotThrow(() => wordCheckGate(frozen, frozenPairs));
  assert.equal(frozen.verdict, 'keep', 'the verdict passed in is a different object from the result');
});

test('wordCheckGate: word checks do not move the judge numbers', () => {
  const graded = gradedVerdict(gp(KEEP));
  const out = wordCheckGate(graded, gw(KEEP, W_DOWN));
  for (const key of ['mean', 'ci', 'prune_ci', 'pairs', 'excluded', 'unscored', 'invalid']) {
    assert.deepEqual(out[key], graded[key], key);
  }
});

// ---- property: the gate never creates a decision ---------------------------------------------

/** A small deterministic generator, so a failure replays from the case number. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('property: the gate never outputs keep or prune unless the judge verdict already did', () => {
  const seen = { keep: 0, prune: 0, vetoedKeep: 0, vetoedPrune: 0, off: 0 };
  for (let c = 0; c < 600; c++) {
    const rnd = mulberry32(c + 1);
    const n = Math.floor(rnd() * 16);
    const gapCentre = [-1, 0, 1][Math.floor(rnd() * 3)];
    const wCentre = [-0.4, 0, 0.4][Math.floor(rnd() * 3)];
    const pairs = Array.from({ length: n }, () =>
      G(gapCentre + (rnd() - 0.5) * 0.6, {
        loaded: rnd() > 0.03,
        counted: rnd() > 0.03,
        scored: rnd() > 0.05,
        w: rnd() < 0.2 ? null : Math.max(-1, Math.min(1, wCentre + (rnd() - 0.5) * 0.4)),
      }),
    );
    const blocked = rnd() < 0.2 ? { blocked_reason: 'blocked' } : { blocked_reason: null };
    const judged = gradedVerdict(pairs, blocked);
    const out = wordCheckGate(judged, pairs);
    const label = `case ${c}`;
    assert.ok([judged.verdict, REVIEW].includes(out.verdict), label);
    if (judged.verdict === REVIEW) assert.equal(out.verdict, REVIEW, label);
    assert.equal(out.judge_verdict, judged.verdict, label);
    if (out.verdict !== judged.verdict) {
      assert.equal(out.word_check.vetoed, true, label);
      assert.equal(out.word_check.gate, 'on', label);
      if (judged.verdict === 'keep') assert.ok(out.word_check.ci[1] < 0, label);
      if (judged.verdict === 'prune') assert.ok(out.word_check.ci[0] > 0, label);
    }
    if (out.word_check.gate === 'off') {
      assert.equal(out.verdict, judged.verdict, label);
      assert.ok(out.word_check.pairs < rule.MIN_DECISION_PAIRS, label);
    }
    if (judged.verdict === 'keep') seen.keep++;
    if (judged.verdict === 'prune') seen.prune++;
    if (out.verdict !== judged.verdict && judged.verdict === 'keep') seen.vetoedKeep++;
    if (out.verdict !== judged.verdict && judged.verdict === 'prune') seen.vetoedPrune++;
    if (out.word_check.gate === 'off') seen.off++;
  }
  // The generator must reach every branch, or the property proves nothing.
  for (const [what, count] of Object.entries(seen)) assert.ok(count > 0, `${what} was never reached`);
});

// ---- unblind ---------------------------------------------------------------------------------

test('unblind: with-first makes A the with arm, without-first makes B the with arm', () => {
  assert.deepEqual(unblind('with-first', 5, 2), { with: 5, without: 2, delta: 3 });
  assert.deepEqual(unblind('without-first', 5, 2), { with: 2, without: 5, delta: -3 });
  assert.deepEqual(unblind('with-first', 2, 5), { with: 2, without: 5, delta: -3 });
  assert.deepEqual(unblind('without-first', 2, 5), { with: 5, without: 2, delta: 3 });
  assert.equal(unblind('with-first', 4, 4).delta, 0);
  assert.equal(unblind('without-first', 4, 4).delta, 0);
});

test('unblind: swapping the order and the scores together gives the same gap', () => {
  for (const [a, b] of [
    [5, 1],
    [1, 5],
    [3, 3],
    [2.5, 4],
  ]) {
    assert.equal(unblind('with-first', a, b).delta, unblind('without-first', b, a).delta);
  }
});

test('unblind: a positive delta favours the skill whichever order the judge saw', () => {
  // The judge preferred the with arm in both calls: it scored it 5 and the other answer 2.
  assert.equal(unblind('with-first', 5, 2).delta, 3);
  assert.equal(unblind('without-first', 2, 5).delta, 3);
});

test('unblind: an unknown or missing order throws, whatever the scores', () => {
  for (const order of [undefined, null, '', 'with', 'WITH-FIRST', 'sideways', 1, {}]) {
    assert.throws(() => unblind(order, 3, 2), /unknown presentation order/, String(order));
    assert.throws(() => unblind(order, null, null), /unknown presentation order/, String(order));
  }
  assert.deepEqual([...ORDERS], ['with-first', 'without-first']);
});

test('unblind: scores that are not both finite numbers give nulls, not a guess', () => {
  const none = { with: null, without: null, delta: null };
  for (const [a, b] of [
    [null, null],
    [3, null],
    [null, 3],
    [undefined, 2],
    ['3', 2],
    [3, '2'],
    [NaN, 2],
    [2, Infinity],
    [true, 2],
  ]) {
    for (const order of ORDERS) assert.deepEqual(unblind(order, a, b), none, `${a} ${b}`);
  }
});
