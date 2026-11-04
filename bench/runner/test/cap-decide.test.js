// SPDX-License-Identifier: Apache-2.0
'use strict';

// The delete / prune / keep call for one skill from arm scores. Pure: scores in, a decision and its evidence out.

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareArms, decideSkill, evidenceRowsFor, renderDecisions, censoring, uneven, MARGIN, MIN_RUNS } = require('../../cap/decide.js');
const { parseEvidence } = require('../../cap/evidence.js');

// n values centred on `mean`, alternating by `spread`, so the sample mean is exact and the sd is about `spread`.
const arm = (mean, n = 40, { spread = 0.05, loaded = 1, credits = 4 } = {}) => ({
  scores: Array.from({ length: n }, (_, i) => mean + (i % 2 ? spread : -spread)),
  credits: Array.from({ length: n }, (_, i) => credits + (i % 2 ? 0.5 : -0.5)),
  loaded: Array.from({ length: n }, (_, i) => i < Math.round(n * loaded)),
});

const SECTIONS = [
  { id: 'workflow', title: 'Workflow', startLine: 10, endLine: 60, kind: 'procedure', bytes: 3000, estTokens: 750 },
  { id: 'template', title: 'Output template', startLine: 61, endLine: 120, kind: 'reference', bytes: 4000, estTokens: 1000 },
  { id: 'checklist', title: 'Checklist', startLine: 121, endLine: 150, kind: 'procedure', bytes: 1200, estTokens: 300 },
];
const SKILL = { id: 'skill:demo', name: 'demo', bytes: 9000, estTokens: 2250, sections: SECTIONS };
const TRUSTED = { trusted: true };

const wave1 = (del, { ctl = arm(0.8), aa = arm(0.8) } = {}) => ({ wave: 1, arms: { ctl, 'ctl-b': aa, del } });
const decide = (waves, over = {}) => decideSkill({ skill: SKILL, controls: TRUSTED, waves, ...over });

test('compareArms gives the difference, a Welch interval and the run counts', () => {
  const c = compareArms(arm(0.6).scores, arm(0.8).scores);
  assert.ok(Math.abs(c.delta - -0.2) < 1e-9);
  assert.equal(c.nHead, 40);
  assert.equal(c.nBase, 40);
  assert.ok(c.ci.lo < c.delta && c.delta < c.ci.hi);
  assert.ok(c.ci.hi < 0, 'a 0.2 drop with sd 0.05 over 40 runs excludes zero');
  const same = compareArms(arm(0.8).scores, arm(0.8).scores);
  assert.ok(Math.abs(same.delta) < 1e-9 && same.ci.lo < 0 && same.ci.hi > 0);
  assert.equal(compareArms([0.5], [0.5, 0.6]).ci, null, 'one run on a side has no interval');
});

test('a delete variant that clearly loses quality keeps the skill when sections were not tested', () => {
  const d = decide([wave1(arm(0.5))]);
  assert.equal(d.decision, 'KEEP');
  assert.ok(['medium', 'high'].includes(d.confidence));
  assert.equal(d.verdict, 'keep');
  assert.match(d.reasons.join(' '), /removing the skill lost/);
  assert.ok(d.missing.some((m) => /wave 2/.test(m)), 'sections are still untested');
  assert.deepEqual(d.sections.map((s) => s.action), ['untested', 'untested', 'untested']);
});

test('a delete variant that is within the margin, powered and loaded is a DELETE call', () => {
  const d = decide([wave1(arm(0.79))]);
  assert.equal(d.decision, 'DELETE');
  assert.ok(['medium', 'high'].includes(d.confidence));
  assert.equal(d.verdict, 'prune candidate');
  assert.equal(d.tokensSaved, 2250);
  assert.equal(d.evidence.del.status, 'safe');
});

test('no delete call when the skill barely loaded: it cannot show lift or harm', () => {
  const d = decide([wave1(arm(0.8), { ctl: arm(0.8, 40, { loaded: 0.1 }) })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /loaded in 4 of 40 control runs/);
  assert.match(d.next.join(' '), /discovery|trigger/);
});

test('no call at all when the known-answer controls failed or were not run', () => {
  for (const controls of [{ trusted: false }, { trusted: null }, undefined]) {
    const d = decideSkill({ skill: SKILL, controls, waves: [wave1(arm(0.5))] });
    assert.equal(d.decision, 'NEEDS DATA');
    assert.match(d.reasons.join(' '), /controls/);
  }
});

test('a noisy A/A pair wider than the margin makes the study unable to read a no-effect result', () => {
  const d = decide([wave1(arm(0.8), { aa: arm(0.8 - (MARGIN + 0.05)) })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /A\/A/);
  assert.equal(d.evidence.del.status, 'unclear');
});

test('too few runs is NEEDS DATA however the means look (the earlier n=3 case)', () => {
  const small = (m) => arm(m, 3);
  const d = decide([wave1(small(0.79), { ctl: small(0.8), aa: small(0.8) })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), new RegExp(`${MIN_RUNS}`));
});

test('removing the skill clearly improves quality: DELETE as a harm call', () => {
  const d = decide([wave1(arm(0.95), { ctl: arm(0.7), aa: arm(0.7) })]);
  assert.equal(d.decision, 'DELETE');
  assert.match(d.reasons.join(' '), /improved/);
  assert.equal(d.evidence.del.status, 'gained');
});

test('a missing A/A arm blocks any call', () => {
  const d = decide([{ wave: 1, arms: { ctl: arm(0.8), del: arm(0.8) } }]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /A\/A/);
});

test('scores outside 0 to 1 are a unit error, not a result', () => {
  const bad = { scores: Array.from({ length: 40 }, () => 80), credits: [], loaded: Array.from({ length: 40 }, () => true) };
  const d = decide([wave1(bad, { ctl: bad, aa: bad })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /units/);
});

test('when the skill is needed, sections that can go are listed with file lines and the action for each', () => {
  const w2 = { wave: 2, arms: { ctl: arm(0.8), 'ctl-b': arm(0.8), rm1: arm(0.79), rm2: arm(0.55), rm3: arm(0.4) } };
  const w3 = { wave: 3, arms: { ctl: arm(0.8), 'ctl-b': arm(0.8), mv2: arm(0.79, 40), mv3: arm(0.4) }, opened: { mv2: 12, mv3: 30 } };
  const d = decide([wave1(arm(0.5)), w2, w3]);
  assert.equal(d.decision, 'PRUNE');
  const by = Object.fromEntries(d.sections.map((s) => [s.id, s]));
  assert.equal(by.workflow.action, 'remove');
  assert.equal(by.template.action, 'move');
  assert.equal(by.checklist.action, 'keep');
  assert.deepEqual([by.workflow.startLine, by.workflow.endLine], [10, 60]);
  assert.match(by.template.openWhen, /output template/i);
  assert.equal(d.tokensSaved, 750 + (1000 - by.template.pointerTokens));
  assert.equal(d.confidence, 'medium', 'two cuts were tested one at a time, so the combined cut caps at medium');
  assert.match(d.next.join(' '), /combined/);
  assert.equal(by.template.evidence.opened, 12);
});

test('a moved section that no run opened is flagged: the move behaves like a removal', () => {
  const w2 = { wave: 2, arms: { ctl: arm(0.8), 'ctl-b': arm(0.8), rm1: arm(0.5), rm2: arm(0.55), rm3: arm(0.4) } };
  const w3 = { wave: 3, arms: { ctl: arm(0.8), 'ctl-b': arm(0.8), mv1: arm(0.79), mv2: arm(0.4), mv3: arm(0.4) }, opened: { mv1: 0 } };
  const d = decide([wave1(arm(0.5)), w2, w3]);
  const s = d.sections.find((x) => x.id === 'workflow');
  assert.equal(s.action, 'move');
  assert.match(s.note, /never opened/);
});

test('a needed skill whose every section is needed too is a KEEP', () => {
  const w2 = { wave: 2, arms: { ctl: arm(0.8), 'ctl-b': arm(0.8), rm1: arm(0.5), rm2: arm(0.5), rm3: arm(0.5) } };
  const w3 = { wave: 3, arms: { ctl: arm(0.8), 'ctl-b': arm(0.8), mv1: arm(0.5), mv2: arm(0.5), mv3: arm(0.5) } };
  const d = decide([wave1(arm(0.5)), w2, w3]);
  assert.equal(d.decision, 'KEEP');
  assert.deepEqual([...new Set(d.sections.map((s) => s.action))], ['keep']);
});

test('a section whose removal result is unclear is left alone and named as needing data', () => {
  const w2 = { wave: 2, arms: { ctl: arm(0.5), 'ctl-b': arm(0.5), rm1: arm(0.49), rm2: arm(0.44, 40, { spread: 0.3 }), rm3: arm(0.1, 40, { spread: 0.05 }) } };
  const d = decide([wave1(arm(0.5)), w2]);
  assert.equal(d.decision, 'PRUNE');
  assert.equal(d.sections.find((s) => s.id === 'template').action, 'keep');
  assert.match(d.sections.find((s) => s.id === 'template').note, /unclear/);
});

test('evidence rows use the 0 to 1 scale of the evidence file and pass its validator', () => {
  const d = decide([wave1(arm(0.5))]);
  const rows = evidenceRowsFor(d, { runId: 'study/w1' });
  assert.equal(rows.length, 1);
  const parsed = parseEvidence(JSON.stringify(rows));
  assert.deepEqual(parsed.errors, []);
  assert.equal(rows[0].capId, 'skill:demo');
  assert.equal(rows[0].kind, 'ablation');
  assert.ok(rows[0].delta > 0, 'with the skill minus without: positive when the skill helps');
  assert.equal(rows[0].verdict, 'helps');
  assert.ok(Math.abs(rows[0].withValue - 0.8) < 1e-9 && Math.abs(rows[0].withoutValue - 0.5) < 1e-9);
});

test('the credit and token effect of each variant is reported next to quality', () => {
  const d = decide([wave1(arm(0.79, 40, { credits: 3 }), { ctl: arm(0.8, 40, { credits: 4 }) })]);
  assert.ok(d.evidence.del.credits.delta < 0);
  assert.equal(d.evidence.del.credits.unit, 'credits');
});

// ---- timeouts (censored runs) ----

const withTimeouts = (a, t, over = {}) => ({ ...a, runs: a.scores.length, timeouts: t, timeoutTasks: t ? { 'design-hold-service': t } : {}, ...over });

test('censoring: more than 10% timeouts on either side, or counts that differ by more than one, is censored', () => {
  const ctl = withTimeouts(arm(0.8, 40), 0);
  assert.equal(censoring(withTimeouts(arm(0.8, 40), 4), withTimeouts(arm(0.8, 40), 4)), null, '4 of 40 on both sides is exactly 10%, not over it');
  assert.match(censoring(withTimeouts(arm(0.8, 40), 5), withTimeouts(arm(0.8, 40), 5)).reason, /5 of 40 runs of the variant timed out/);
  assert.match(censoring(ctl, withTimeouts(arm(0.8, 40), 5)).reason, /5 of 40 control runs timed out/);
  assert.equal(censoring(withTimeouts(arm(0.8, 40), 1), withTimeouts(arm(0.8, 40), 0)), null, 'a gap of one is allowed');
  assert.match(censoring(withTimeouts(arm(0.8, 40), 0), withTimeouts(arm(0.8, 40), 2)).reason, /timeout counts differ \(0 of 40 against 2 of 40\)/);
  assert.match(censoring(withTimeouts(arm(0.8, 40), 2), withTimeouts(arm(0.8, 40), 0)).reason, /timeout counts differ/);
  assert.equal(censoring(arm(0.8, 40), arm(0.8, 40)), null, 'arms without timeout counts are not censored');
  assert.match(censoring(withTimeouts(arm(0.8, 40), 5), ctl).reason, /design-hold-service 5/, 'the tasks that timed out are named');
});

test('censoring scales the count gap by the smaller side when the sides have different run counts', () => {
  assert.equal(censoring(withTimeouts(arm(0.8, 20), 2), withTimeouts(arm(0.8, 40), 4)), null, 'same share, no gap');
  assert.match(censoring(withTimeouts(arm(0.8, 20), 2), withTimeouts(arm(0.8, 40), 0)).reason, /differ/, '10% of 20 runs against none is a gap of 2');
});

test('a delete variant that looks safe is NEEDS DATA when too many runs timed out, never a DELETE', () => {
  const clean = decide([wave1(arm(0.8), { ctl: arm(0.8) })]);
  assert.equal(clean.decision, 'DELETE', 'control: the same scores without timeouts are a DELETE call');
  const d = decide([wave1(withTimeouts(arm(0.8), 6), { ctl: withTimeouts(arm(0.8), 0), aa: withTimeouts(arm(0.8), 0) })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /censored by the time limit.*6 of 40 runs of the variant/);
  assert.equal(d.evidence.del.censored, true);
});

test('a delete variant that lost quality is NEEDS DATA, not KEEP, when its timeouts are unbalanced', () => {
  const kept = decide([wave1(arm(0.5))]);
  assert.equal(kept.decision, 'KEEP', 'control: without timeouts the loss is a KEEP');
  const d = decide([wave1(withTimeouts(arm(0.5), 2), { ctl: withTimeouts(arm(0.8), 0), aa: withTimeouts(arm(0.8), 0) })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /timeout counts differ/);
});

test('timeouts spread evenly and under the limit do not change the call', () => {
  const d = decide([wave1(withTimeouts(arm(0.8), 2), { ctl: withTimeouts(arm(0.8), 1), aa: withTimeouts(arm(0.8), 1) })]);
  assert.equal(d.decision, 'DELETE');
});

test('a censored harm call (removal looks better) is NEEDS DATA too', () => {
  const clean = decide([wave1(arm(0.95), { ctl: arm(0.7), aa: arm(0.7) })]);
  assert.equal(clean.decision, 'DELETE');
  const d = decide([wave1(withTimeouts(arm(0.95), 0), { ctl: withTimeouts(arm(0.7), 5), aa: arm(0.7) })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /5 of 40 control runs timed out/);
});

test('the report shows the timeout counts and the reason on a NEEDS DATA row', () => {
  const d = decide([wave1(withTimeouts(arm(0.8), 6), { ctl: withTimeouts(arm(0.8), 0), aa: withTimeouts(arm(0.8), 0) })]);
  const md = renderDecisions([{ ...d, tier: 'loaded', waves: [1] }], { base: 'b', controls: TRUSTED });
  assert.match(md, /timeouts: 6 of 40 variant runs, 0 of 40 control runs/);
  assert.match(md, /censored by the time limit/);
});

// ---- skills the agent never loads ----

test('a skill that never loaded in the control arm is NEEDS DATA with no information, whatever the scores show', () => {
  for (const del of [arm(0.8), arm(0.95), arm(0.4)]) {
    const d = decide([wave1(del, { ctl: arm(0.8, 40, { loaded: 0 }) })]);
    assert.equal(d.decision, 'NEEDS DATA');
    assert.notEqual(d.decision, 'DELETE');
    assert.match(d.reasons.join(' '), /loaded in 0 of 40 control runs.*no information/);
    assert.equal(d.tokensSaved, 0);
    assert.equal(d.evidence.ctlLoad.loaded, 0);
  }
});

test('no load data at all (an empty list) is NEEDS DATA, never a DELETE or PRUNE', () => {
  const ctl = { ...arm(0.8), loaded: [] };
  const d = decide([wave1(arm(0.8), { ctl })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /loaded in 0 of 0 control runs/);
});

test('a skill that loads only in the variant arm still has no information', () => {
  const del = { ...arm(0.8), loaded: Array.from({ length: 40 }, () => true) };
  const d = decide([wave1(del, { ctl: arm(0.8, 40, { loaded: 0 }) })]);
  assert.equal(d.decision, 'NEEDS DATA');
});

// ---- runs scored differently ----

const withMix = (a, over) => ({ ...a, runs: a.scores.length, ...over });

test('uneven: more than 20% of a side left out as infra errors or wrong model is not like for like', () => {
  assert.equal(uneven(withMix(arm(0.8, 40), { excluded: { infraError: 10, modelMismatch: 0 } }), withMix(arm(0.8, 40), { excluded: { infraError: 0, modelMismatch: 0 } })), null, '10 of 50 is exactly 20%');
  assert.match(uneven(withMix(arm(0.8, 40), { excluded: { infraError: 8, modelMismatch: 3 } }), arm(0.8, 40)).reason, /11 of 51 variant runs were left out/);
  assert.match(uneven(arm(0.8, 40), withMix(arm(0.8, 40), { excluded: { infraError: 0, modelMismatch: 11 } })).reason, /control runs were left out/);
  assert.equal(uneven(arm(0.8, 40), arm(0.8, 40)), null, 'arms without the counts are not flagged');
});

test('uneven: a task scored on a rubric in some runs and without one in others is flagged; the same mix on every run is not', () => {
  const same = withMix(arm(0.8, 40), { components: { a: { 'checks+rubric': 20 }, b: { checks: 20 } } });
  assert.equal(uneven(same, same), null, 'a task that has no rubric by design is fine');
  const mixed = withMix(arm(0.8, 40), { components: { a: { 'checks+rubric': 17, checks: 3 }, b: { checks: 20 } } });
  assert.match(uneven(mixed, same).reason, /task a was scored on different components in different runs \(37 on checks\+rubric, 3 on checks\)/);
  const other = withMix(arm(0.8, 40), { components: { a: { checks: 20 }, b: { checks: 20 } } });
  assert.match(uneven(same, other).reason, /task a was scored on different components/, 'the sides differ for the same task');
});

test('a delete variant that looks safe is NEEDS DATA when its runs were scored on different components', () => {
  const ok = withMix(arm(0.8), { components: { a: { 'checks+rubric': 40 } } });
  assert.equal(decide([wave1(ok, { ctl: ok, aa: ok })]).decision, 'DELETE', 'control: scored the same way, a DELETE call');
  const mixed = withMix(arm(0.8), { components: { a: { 'checks+rubric': 30, checks: 10 } } });
  const d = decide([wave1(mixed, { ctl: ok, aa: ok })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /not like for like.*task a/);
  assert.equal(d.evidence.del.uneven, true);
});

test('a delete variant with too many runs left out is NEEDS DATA', () => {
  const d = decide([wave1(withMix(arm(0.8), { excluded: { infraError: 20, modelMismatch: 0 } }), { ctl: arm(0.8), aa: arm(0.8) })]);
  assert.equal(d.decision, 'NEEDS DATA');
  assert.match(d.reasons.join(' '), /20 of 60 variant runs were left out/);
});
