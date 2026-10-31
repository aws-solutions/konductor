// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSkillCards, hakeGain, mappedVerdict, VERDICTS, MIN_EVIDENCE_N } = require('../../report/skillcard.js');
const { buildPruneDocument } = require('../../report/prunedoc.js');
const { wellFormed } = require('./svg-check.js');

function cap(id, o = {}) {
  const exposed = o.exposed ?? 20;
  const runsLoaded = o.runsLoaded ?? 8;
  return {
    id, name: id.replace('skill:', ''), bytes: o.bytes ?? 4000, estTokens: 1000, descriptionBytes: 200, registered: true, owner: 'x', registryClass: 'uplift',
    linkedTasks: o.linkedTasks ?? ['t1'], inboundRefs: o.inboundRefs ?? 0, neighbours: [], trim: o.trim ?? { flag: false, reasons: [] }, otherHarness: { signals: [] },
    harnesses: {
      'kiro-cli': {
        reachable: o.reachable ?? true, agents: ['konductor'], exposure: { runs: exposed, coarse: 0, basis: {} },
        loads: { runsLoaded, total: runsLoaded, rate: exposed ? runsLoaded / exposed : null, bytes: 8000, meanBytesPerLoad: 1000 }, byRef: {},
        evidence: o.evidence ?? [],
        classification: { class: o.cls ?? 'KEEP', provisional: o.provisional ?? false, reason: 'because', confidence: o.confidence ?? 'low', wouldChange: 'a controlled result' },
      },
    },
  };
}
const ev = (o = {}) => ({ capId: 'skill:a', harness: 'kiro-cli', kind: 'lift', task: 't1', n: 6, delta: 0.2, aaSpread: 0.05, verdict: 'helps', runId: 'r1', note: '', behaviorChange: false, withValue: null, withoutValue: null, ...o });
const report = (caps) => ({
  schemaVersion: 1, toolVersion: 'x', createdAt: '2026-01-01T00:00:00.000Z', harnesses: ['kiro-cli'], minExposure: 10, base: { label: 'v1.2.0', commitSha: 'abc' },
  inputs: { runDirs: [], evidence: null, loadRateMin: 0.3, nearDuplicateMin: 0.6, sizeP90Bytes: 5000 }, usage: { runs: { counted: 20, coarse: 0, byHarness: { 'kiro-cli': 20 } }, skipped: {}, refs: [] },
  summary: { skills: caps.length, byHarness: { 'kiro-cli': { HARMS: 0, RELOCATE: 0, PRUNE: 0, FIX: 0, KEEP: caps.length, 'KEEP (provisional)': 0, 'NEEDS DATA': 0 } }, trim: 0, needsDataShare: { 'kiro-cli': { count: 0, of: caps.length, share: 0 } } },
  costContext: { estimateNote: '', opencode: { skillCount: 1, indexBytes: 1, estTokens: 1, note: '', top: [] }, kiro: { note: '', skillDescriptionBytesAtStartup: 0, observedLoads: { loads: 0, bytes: 0, meanBytesPerLoad: null } } },
  capabilities: caps, warnings: [], notes: [],
});

test('Hake normalized gain: (with - without) / (1 - without), undefined at ceiling', () => {
  assert.equal(hakeGain(0.9, 0.5), 0.8);
  assert.ok(Math.abs(hakeGain(0.6, 0.5) - 0.2) < 1e-9);
  assert.equal(hakeGain(1, 1), null);
  assert.equal(hakeGain(null, 0.5), null);
  assert.ok(hakeGain(0.4, 0.5) < 0, 'a loss gives a negative gain');
});

test('a card shows load rate with a Wilson interval, exposure, size and the decision', () => {
  const [c] = buildSkillCards(report([cap('skill:a', { exposed: 20, runsLoaded: 8 })]));
  assert.equal(c.id, 'skill:a');
  assert.equal(c.exposed, 20);
  assert.equal(c.runsLoaded, 8);
  assert.equal(c.rate, 0.4);
  assert.ok(c.lo < 0.4 && c.hi > 0.4 && c.lo > 0.15 && c.hi < 0.7);
  assert.equal(c.bytes, 4000);
  assert.equal(c.cls, 'KEEP');
});

test('evidence: paired lift, normalized gain, negative delta flag and the A/A noise check', () => {
  const [c] = buildSkillCards(report([cap('skill:a', { evidence: [ev({ withValue: 0.8, withoutValue: 0.5, delta: 0.3, aaSpread: 0.05 }), ev({ task: 't2', delta: -0.1, aaSpread: 0.05, verdict: 'hurts', n: 3 })] })]));
  assert.equal(c.evidence.length, 2);
  assert.ok(Math.abs(c.evidence[0].liftPoints - 30) < 1e-9);
  assert.ok(Math.abs(c.evidence[0].gain - 0.6) < 1e-9);
  assert.equal(c.evidence[0].insideNoise, false);
  assert.equal(c.evidence[1].negative, true);
  assert.equal(c.evidence[1].insideNoise, false);
  const inside = buildSkillCards(report([cap('skill:a', { evidence: [ev({ delta: 0.04, aaSpread: 0.05, verdict: 'none' })] })]))[0];
  assert.equal(inside.evidence[0].insideNoise, true);
});

test('checklist marks what is missing before anyone acts', () => {
  const none = buildSkillCards(report([cap('skill:a', { exposed: 3, runsLoaded: 0, cls: 'NEEDS DATA', evidence: [] })]))[0];
  const byId = Object.fromEntries(none.checks.map((x) => [x.id, x]));
  assert.equal(byId.exposure.status, 'NO');
  assert.equal(byId.evidence.status, 'NO');
  assert.equal(byId.reach.status, 'YES');
  const full = buildSkillCards(report([cap('skill:a', { exposed: 30, runsLoaded: 12, evidence: [ev({ n: 10, delta: 0.3 })] })]))[0];
  const f = Object.fromEntries(full.checks.map((x) => [x.id, x]));
  assert.equal(f.exposure.status, 'YES');
  assert.equal(f.evidence.status, 'YES');
  assert.equal(f.noise.status, 'YES');
  assert.equal(f.sample.status, 'YES');
  const refs = buildSkillCards(report([cap('skill:a', { inboundRefs: 2 })]))[0];
  assert.equal(refs.checks.find((x) => x.id === 'refs').status, 'NO');
});

test('mapped verdict follows the decision-board taxonomy and is labelled as a mapping', () => {
  assert.deepEqual(VERDICTS, ['keep', 'prune candidate', 'needs human review', 'incomplete']);
  assert.equal(mappedVerdict({ cls: 'KEEP', provisional: false, exposed: 30 }), 'keep');
  assert.equal(mappedVerdict({ cls: 'KEEP', provisional: true, exposed: 30 }), 'needs human review');
  assert.equal(mappedVerdict({ cls: 'PRUNE', exposed: 0, confidence: 'medium' }), 'prune candidate');
  assert.equal(mappedVerdict({ cls: 'HARMS', exposed: 30, confidence: 'high', evidenceN: 12 }), 'prune candidate');
  assert.equal(mappedVerdict({ cls: 'FIX', exposed: 30 }), 'needs human review');
  assert.equal(mappedVerdict({ cls: 'NEEDS DATA', exposed: 3 }), 'incomplete');
  assert.equal(mappedVerdict({ cls: 'NEEDS DATA', exposed: 30 }), 'needs human review');
});

test('the prune document renders charts, a decision table and cards; quick omits the cards', () => {
  const caps = [cap('skill:a', { evidence: [ev({ withValue: 0.8, withoutValue: 0.5 })], trim: { flag: true, reasons: [{ type: 'size', bytes: 9000, estTokens: 2250, p90: 5000 }] }, bytes: 9000 }), cap('skill:b', { exposed: 0, runsLoaded: 0, cls: 'NEEDS DATA' })];
  const rep = report(caps);
  const full = buildPruneDocument(rep, { detail: 'full' });
  const quick = buildPruneDocument(rep, { detail: 'quick' });
  for (const svg of full.charts.values()) assert.equal(wellFormed(svg), null);
  assert.ok(full.charts.has('class-distribution') && full.charts.has('load-rate') && full.charts.has('bytes-vs-load'));
  const text = JSON.stringify(full.blocks);
  assert.match(text, /Decision card: skill:a/);
  assert.match(text, /Hake|normalized gain/i);
  assert.ok(!JSON.stringify(quick.blocks).includes('Decision card'));
  assert.ok(quick.charts.size >= 1 && quick.charts.size <= full.charts.size);
  assert.ok(!/NaN|undefined/.test(text));
});

// ---- decision-card corrections ----

test('prune candidate needs confidence, enough evidence and a delta outside the A/A spread', () => {
  const base = { cls: 'HARMS', provisional: false, exposed: 30, confidence: 'medium', evidenceN: MIN_EVIDENCE_N, insideNoise: false };
  assert.equal(mappedVerdict(base), 'prune candidate');
  assert.equal(mappedVerdict({ ...base, confidence: 'low' }), 'needs human review', 'low confidence');
  assert.equal(mappedVerdict({ ...base, evidenceN: MIN_EVIDENCE_N - 1 }), 'needs human review', 'too few runs behind a harm');
  assert.equal(mappedVerdict({ ...base, insideNoise: true }), 'needs human review', 'delta inside the A/A spread');
  assert.equal(mappedVerdict({ ...base, unitMismatch: true }), 'needs human review', 'units disagree');
  const prune = { cls: 'PRUNE', provisional: false, exposed: 0, confidence: 'medium', evidenceN: 0, insideNoise: null };
  assert.equal(mappedVerdict(prune), 'prune candidate');
  assert.equal(mappedVerdict({ ...prune, confidence: 'low' }), 'needs human review');
  assert.equal(mappedVerdict({ cls: 'PRUNE', exposed: 0 }), 'needs human review', 'no confidence given fails safe');
});

test('a HARMS card built from one weak hurts row inside its A/A spread is not a prune candidate', () => {
  const weak = ev({ verdict: 'hurts', delta: -0.04, aaSpread: 0.09, n: 3 });
  const [c] = buildSkillCards(report([cap('skill:a', { cls: 'HARMS', confidence: 'low', evidence: [weak] })]));
  assert.equal(c.verdict, 'needs human review');
  const strong = ev({ verdict: 'hurts', delta: -0.4, aaSpread: 0.05, n: 8 });
  const [d] = buildSkillCards(report([cap('skill:a', { cls: 'HARMS', confidence: 'medium', evidence: [strong] })]));
  assert.equal(d.verdict, 'prune candidate');
  const [e] = buildSkillCards(report([cap('skill:a', { cls: 'HARMS', confidence: 'medium', evidence: [ev({ verdict: 'hurts', delta: -0.4, aaSpread: 0.05, n: 2 })] })]));
  assert.equal(e.verdict, 'needs human review', 'n under the minimum');
});

test('normalized change for a loss divides by the baseline: 0.90 to 0.50 is -0.44, not -4.0', () => {
  assert.ok(Math.abs(hakeGain(0.5, 0.9) - (-0.4 / 0.9)) < 1e-9);
  assert.equal(hakeGain(0, 1), -1);
  assert.equal(hakeGain(0.5, 1), -0.5);
  assert.equal(hakeGain(0.9, 0.9), 0);
  assert.equal(hakeGain(1, 1), null, 'no gain is defined when the baseline is already perfect and nothing was lost');
  const [c] = buildSkillCards(report([cap('skill:a', { evidence: [ev({ withValue: 0.5, withoutValue: 0.9, delta: -0.4, verdict: 'hurts' })] })]));
  assert.equal(c.evidence[0].gainKind, 'change');
  const [g] = buildSkillCards(report([cap('skill:a', { evidence: [ev({ withValue: 0.8, withoutValue: 0.5, delta: 0.3 })] })]));
  assert.equal(g.evidence[0].gainKind, 'gain');
});

test('the ceiling warning shows whenever the baseline is at 0.95 or more, with a finite gain too', () => {
  const rep = report([cap('skill:a', { cls: 'KEEP', evidence: [ev({ withValue: 0.99, withoutValue: 0.97, delta: 0.02, aaSpread: 0.01 }), ev({ task: 't2', withValue: 0.5, withoutValue: 0.96, delta: -0.46, verdict: 'hurts' })] })]);
  const doc = buildPruneDocument(rep, { detail: 'full' });
  const text = JSON.stringify(doc.blocks);
  const cells = doc.cards[0].evidence;
  assert.ok(Number.isFinite(cells[0].gain) && cells[0].atCeiling);
  assert.ok(Number.isFinite(cells[1].gain) && cells[1].atCeiling);
  assert.equal((text.match(/at ceiling/g) || []).length >= 4, true, 'flag and gain cell on both rows');
  assert.match(text, /normalized change/);
});

test('cards say load rate, not invocation rate, and the notes carry the caveats', () => {
  const rep = report([cap('skill:a', { evidence: [ev({ withValue: 0.8, withoutValue: 0.5, delta: 0.3 })] })]);
  const text = JSON.stringify(buildPruneDocument(rep, { detail: 'full' }).blocks);
  assert.match(text, /Load rate \(runs that loaded it/);
  assert.doesNotMatch(text, /Invocation rate/);
  assert.match(text, /not comparable to SkillsBench/);
  assert.match(text, /direct read of a SKILL\.md is not counted/);
  assert.match(text, /our own, not from an external source/);
  for (const q of ['quick', 'full']) assert.match(JSON.stringify(buildPruneDocument(rep, { detail: q }).blocks), /our own, not from an external source/);
});

test('the lift column says it is not paired and has no interval; a unit mismatch is flagged on the row', () => {
  const rep = report([cap('skill:a', { evidence: [ev({ withValue: 0.8, withoutValue: 0.5, delta: 0.08, aaSpread: 0.02 })] })]);
  const doc = buildPruneDocument(rep, { detail: 'full' });
  const text = JSON.stringify(doc.blocks);
  assert.match(text, /lift \(points; with minus without, not paired, no interval\)/);
  assert.doesNotMatch(text, /paired lift/i);
  assert.equal(doc.cards[0].evidence[0].unitMismatch, true);
  assert.match(text, /units differ/);
});

test('README and playbook use load rate, no longer claim a paired lift, and tag our own thresholds', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  for (const f of ['README.md', 'CAP-PLAYBOOK.md']) {
    const doc = read(f);
    for (const line of doc.split('\n')) {
      if (/invocation rate/i.test(line)) assert.match(line, /SkillsBench/, `${f}: ${line}`);
      assert.doesNotMatch(line, /paired lift/i, `${f}: ${line}`);
    }
  }
  const play = read('CAP-PLAYBOOK.md');
  assert.match(play, /not comparable to SkillsBench/);
  assert.match(play, /our own, not from an external source/);
  assert.match(play, /direct read of a SKILL\.md is not counted/);
  assert.match(play, /per query by majority vote/);
  assert.match(read('README.md'), /our own, not from an external source/);
});
