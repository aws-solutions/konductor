// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap prune-report: classification rules, exposure and usage counting, evidence, TRIM thresholds, report shape and the
// command line. Synthetic repos and run directories only; every call gets a scratch HOME. No model, no credits.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { makeEnv, prefEntry, makeRunDir, V1, V2, VAN } = require('./cap-prune-helpers.js');
const { classify, trimFor, percentile90 } = require('../../cap/prune.js');
const { parseEvidence } = require('../../cap/evidence.js');
const { expandGlob } = require('../../cap/usage.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

function prune(env, args = [], { base = 'v0', out = path.join(env.root, 'out'), cwd } = {}) {
  const argv = [BENCH_JS, 'cap', 'prune-report', '--repo-root', env.repo, '--bench-dir', env.bench, ...(base ? ['--base', base] : []), '--out', out, ...args];
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', cwd, env: { PATH: process.env.PATH, HOME: env.home, TMPDIR: env.tmpdir } });
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(out, 'prune-report.json'), 'utf8')); } catch { /* exit 2 writes nothing */ }
  return { r, report, out };
}

const row = (rep, id, harness = 'kiro-cli') => rep.capabilities.find((c) => c.id === `skill:${id}`).harnesses[harness];
const cls = (rep, id, harness = 'kiro-cli') => row(rep, id, harness).classification;
const evRow = (over = {}) => ({ capId: 'skill:helped', harness: 'kiro-cli', kind: 'lift', task: 'tX', n: 6, delta: 0.3, aaSpread: 0.1, verdict: 'helps', runId: 'r1', note: 'n', ...over });
const writeEvidence = (env, rows) => { const f = path.join(env.root, 'evidence.json'); fs.writeFileSync(f, JSON.stringify(rows)); return f; };

// The scenario: vanilla runs that must not count, six v0 konductor runs, a second ref, a duplicate directory.
function scenario(env) {
  const kiro = (extra) => ({ arm: 'v1', ...extra });
  makeRunDir(path.join(env.runsDir, 'a'), {
    arms: [VAN, V1],
    runs: [
      { arm: 'vanilla', rep: 1, loads: ['used'] }, { arm: 'vanilla', rep: 2, loads: ['used', 'idle'] }, { arm: 'vanilla', rep: 3, loads: ['pref'] },
      kiro({ rep: 1, loads: ['used'] }),
      kiro({ rep: 2, loads: ['used', 'pref'] }),
      kiro({ rep: 3, loads: ['used', 'harmful'] }),
      kiro({ rep: 4, loads: ['harmful', 'helped'] }),
      kiro({ rep: 5, delegate: ['k-dev'] }),
      kiro({ rep: 6, delegate: ['k-dev'] }),
    ],
  });
  return path.join(env.runsDir, 'a');
}

// ---- classification through the command ----

test('every class is produced by its rule, including RELOCATE for a skill wired for another harness', () => {
  const env = makeEnv([prefEntry()]);
  try {
    const dir = scenario(env);
    const ev = writeEvidence(env, [evRow(), evRow({ capId: 'skill:harmful', verdict: 'hurts', delta: -0.4, note: 'worse' })]);
    const { r, report } = prune(env, ['--harness', 'kiro-cli', '--runs', dir, '--min-exposure', '4', '--evidence', ev]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(cls(report, 'harmful').class, 'HARMS');
    assert.equal(cls(report, 'claudey').class, 'RELOCATE');
    assert.equal(cls(report, 'orphan').class, 'PRUNE');
    assert.equal(cls(report, 'idle').class, 'FIX');
    assert.equal(cls(report, 'helped').class, 'KEEP');
    assert.equal(cls(report, 'helped').provisional, false);
    assert.equal(cls(report, 'pref').class, 'KEEP');
    assert.equal(cls(report, 'used').class, 'KEEP');
    assert.equal(cls(report, 'used').provisional, true);
    assert.equal(cls(report, 'devonly').class, 'NEEDS DATA');
    assert.deepEqual(report.capabilities.find((c) => c.id === 'skill:idle').otherHarness.signals, [], 'listed by a kiro agent, so a claudeCli list is not a sign of another home');
    assert.doesNotMatch(cls(report, 'idle').reason, /another harness/);
    assert.equal(report.capabilities.find((c) => c.id === 'skill:claudey').otherHarness.signals.length, 2);
    for (const c of report.capabilities) {
      const k = c.harnesses['kiro-cli'].classification;
      assert.ok(['low', 'medium', 'high'].includes(k.confidence), c.id);
      assert.ok(k.reason.length > 10 && k.wouldChange.length > 10, c.id);
    }
  } finally { env.done(); }
});

test('a skill unreachable on kiro is not pruned when another assessed harness installs it', () => {
  const env = makeEnv();
  try {
    const { report } = prune(env, ['--harness', 'both']);
    assert.equal(cls(report, 'orphan', 'kiro-cli').class, 'NEEDS DATA');
    assert.match(cls(report, 'orphan', 'kiro-cli').reason, /reachable on opencode/);
    assert.equal(cls(report, 'orphan', 'opencode').class, 'NEEDS DATA');
    assert.equal(cls(report, 'claudey', 'kiro-cli').class, 'RELOCATE');
    assert.ok(!report.capabilities.some((c) => Object.values(c.harnesses).some((h) => h.classification.class === 'PRUNE')));
  } finally { env.done(); }
});

test('evidence verdicts, the preference class and the load-rate threshold drive KEEP', () => {
  const env = makeEnv([prefEntry()]);
  try {
    const dir = scenario(env);
    const ev = writeEvidence(env, [evRow({ capId: 'skill:used', verdict: 'none', delta: 0, behaviorChange: false }), evRow({ capId: 'skill:harmful', verdict: 'hurts', delta: -0.4 })]);
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', dir, '--min-exposure', '4', '--evidence', ev]);
    assert.equal(cls(report, 'used').class, 'KEEP');
    assert.equal(cls(report, 'used').provisional, true, 'a null evidence verdict is not evidence of effect');
    assert.match(cls(report, 'pref').reason, /preference/);
    const withChange = writeEvidence(env, [evRow({ capId: 'skill:used', verdict: 'unmeasurable', delta: 0.02, aaSpread: 0.09, behaviorChange: true })]);
    const second = prune(env, ['--harness', 'kiro-cli', '--runs', dir, '--min-exposure', '4', '--evidence', withChange], { out: path.join(env.root, 'out2') }).report;
    assert.equal(cls(second, 'used').class, 'KEEP');
    assert.equal(cls(second, 'used').provisional, false, 'a recorded behavior change makes it non-provisional');
  } finally { env.done(); }
});

test('TRIM is a flag beside the primary class: size above the 90th percentile and near duplicates', () => {
  const env = makeEnv();
  try {
    const { report } = prune(env, ['--harness', 'kiro-cli']);
    const trim = (id) => report.capabilities.find((c) => c.id === `skill:${id}`).trim;
    assert.equal(trim('big').flag, true);
    assert.ok(trim('big').reasons.some((x) => x.type === 'size'));
    assert.equal(trim('twina').flag, true);
    const dup = trim('twina').reasons.find((x) => x.type === 'near-duplicate');
    assert.equal(dup.neighbour, 'skill:twinb');
    assert.ok(dup.score > 0.6);
    assert.ok(dup.neighbourBytes > 0 && dup.bytes > 0);
    assert.equal(trim('used').flag, false);
    assert.equal(report.summary.trim, 3);
  } finally { env.done(); }
});

// ---- classify() ----

const SPEC_SIGNAL = { type: 'spec-list', text: 'listed in the claudeCli skills of konductor' };
const base = { harness: 'kiro-cli', reachable: true, reachableElsewhere: false, cls: 'uplift', exposed: 20, coarse: 0, runsLoaded: 0, loads: 0, evidence: [], minExposure: 10, signals: [], assessedCount: 1, refs: 1 };

test('classify: HARMS wins over everything, even a helps row and an unreachable skill', () => {
  const hurts = { verdict: 'hurts', n: 6, delta: -0.5, aaSpread: 0.1, behaviorChange: false, kind: 'lift' };
  const helps = { verdict: 'helps', n: 6, delta: 0.5, aaSpread: 0.1, behaviorChange: false, kind: 'lift' };
  assert.equal(classify({ ...base, evidence: [helps, hurts] }).class, 'HARMS');
  assert.equal(classify({ ...base, reachable: false, evidence: [hurts] }).class, 'HARMS');
});

test('classify: unreachable decides RELOCATE only with a sign of another harness, else PRUNE, and PRUNE needs every assessed harness to miss it', () => {
  const u = { ...base, reachable: false, exposed: 0 };
  assert.equal(classify(u).class, 'PRUNE');
  assert.equal(classify({ ...u, signals: [SPEC_SIGNAL] }).class, 'RELOCATE');
  const elsewhere = classify({ ...u, reachableElsewhere: true, assessedCount: 2 });
  assert.equal(elsewhere.class, 'NEEDS DATA');
  assert.equal(classify({ ...u, reachableElsewhere: true, assessedCount: 2, signals: [SPEC_SIGNAL] }).class, 'RELOCATE');
  assert.equal(classify(u).confidence, 'low', 'one harness assessed: never more than low');
});

test('classify: FIX needs exposure at the minimum and no loads; one run less is NEEDS DATA; loads end FIX', () => {
  assert.equal(classify({ ...base, exposed: 10 }).class, 'FIX');
  assert.equal(classify({ ...base, exposed: 9 }).class, 'NEEDS DATA');
  assert.equal(classify({ ...base, exposed: 10, minExposure: 11 }).class, 'NEEDS DATA');
  assert.notEqual(classify({ ...base, exposed: 10, loads: 1, runsLoaded: 1 }).class, 'FIX');
});

test('classify: FIX confidence follows exposure and drops when no task is linked or the skill was offered only through delegation', () => {
  assert.equal(classify({ ...base, exposed: 30 }).confidence, 'high');
  assert.equal(classify({ ...base, exposed: 15 }).confidence, 'medium');
  assert.equal(classify({ ...base, exposed: 30, hasTask: false }).confidence, 'medium');
  assert.equal(classify({ ...base, exposed: 30, delegatedOnly: true }).confidence, 'medium');
  assert.equal(classify({ ...base, exposed: 30, hasTask: false, delegatedOnly: true }).confidence, 'low');
  assert.equal(classify({ ...base, exposed: 30, coarse: 2 }).confidence, 'medium');
  assert.match(classify({ ...base, exposed: 30, hasTask: false }).reason, /no bench task is linked/);
  assert.match(classify({ ...base, exposed: 30 }).reason, /not that the task needed it/);
});

test('classify: a skill that looks wired for another harness but is installed here says so in its reason', () => {
  const out = classify({ ...base, exposed: 2, signals: [SPEC_SIGNAL] });
  assert.equal(out.class, 'NEEDS DATA');
  assert.match(out.reason, /wired for another harness.*yet kiro-cli lists it/);
});

test('classify: FIX comes before KEEP, so a skill that helps when loaded but is never loaded is a discovery problem', () => {
  const helps = { verdict: 'helps', n: 6, delta: 0.5, aaSpread: 0.1, behaviorChange: false, kind: 'lift' };
  assert.equal(classify({ ...base, exposed: 12, evidence: [helps] }).class, 'FIX');
  assert.equal(classify({ ...base, exposed: 2, evidence: [helps] }).class, 'KEEP');
});

test('classify: load rate 30% is provisional KEEP, 29% is not, and it needs the minimum exposure', () => {
  assert.deepEqual([classify({ ...base, exposed: 10, runsLoaded: 3, loads: 3 }).class, classify({ ...base, exposed: 10, runsLoaded: 3, loads: 3 }).provisional], ['KEEP', true]);
  assert.equal(classify({ ...base, exposed: 11, runsLoaded: 3, loads: 3 }).class, 'NEEDS DATA');
  assert.equal(classify({ ...base, exposed: 9, runsLoaded: 9, loads: 9 }).class, 'NEEDS DATA');
});

test('classify: a load rate just under 30% stays NEEDS DATA and says whether a behavior change is on file', () => {
  const change = { verdict: 'unmeasurable', n: 3, delta: 0.08, aaSpread: 0.09, behaviorChange: true, kind: 'ablation', task: 't' };
  const plain = classify({ ...base, exposed: 31, runsLoaded: 9, loads: 9 });
  assert.equal(plain.class, 'NEEDS DATA');
  assert.match(plain.reason, /29%.*no evidence of effect/);
  const noted = classify({ ...base, exposed: 31, runsLoaded: 9, loads: 9, evidence: [change] });
  assert.equal(noted.class, 'NEEDS DATA');
  assert.match(noted.reason, /behavior change on file but no result showing an effect/);
});

test('classify: an evidence row whose delta sits inside the A/A spread caps confidence at low', () => {
  const inside = { verdict: 'helps', n: 20, delta: 0.05, aaSpread: 0.1, behaviorChange: false, kind: 'lift' };
  const out = classify({ ...base, exposed: 0, evidence: [inside] });
  assert.equal(out.class, 'KEEP');
  assert.equal(out.confidence, 'low');
  const clear = classify({ ...base, exposed: 0, evidence: [{ ...inside, delta: 0.5 }] });
  assert.equal(clear.confidence, 'high');
});

// ---- TRIM thresholds ----

test('percentile90 uses the nearest rank and trimFor flags strictly above it, and strictly above a 0.6 score', () => {
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile90(sizes), 9);
  assert.equal(percentile90([5]), 5);
  const mk = (bytes, score) => ({ id: 'skill:x', bytes, neighbours: score === null ? [] : [{ id: 'skill:y', score }] });
  const sizeOf = () => 50;
  assert.equal(trimFor(mk(9, null), 9, sizeOf).flag, false);
  assert.equal(trimFor(mk(10, null), 9, sizeOf).flag, true);
  assert.equal(trimFor(mk(1, 0.6), 9, sizeOf).flag, false);
  assert.equal(trimFor(mk(1, 0.601), 9, sizeOf).flag, true);
  const both = trimFor(mk(10, 0.9), 9, sizeOf);
  assert.deepEqual(both.reasons.map((x) => x.type), ['size', 'near-duplicate']);
});

// ---- exposure and usage ----

test('exposure: the entry agent counts for its skills, a delegated agent for its own, vanilla runs for nothing', () => {
  const env = makeEnv();
  try {
    const dir = scenario(env);
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', dir, '--min-exposure', '4']);
    assert.equal(row(report, 'used').exposure.runs, 6, 'six konductor runs; the three vanilla runs are not counted');
    assert.equal(row(report, 'used').loads.runsLoaded, 3);
    assert.equal(row(report, 'used').loads.total, 3);
    assert.equal(row(report, 'idle').loads.total, 0, 'a vanilla load of idle is ignored');
    assert.equal(row(report, 'devonly').exposure.runs, 2, 'only the two runs that delegated to k-dev');
    assert.equal(report.usage.runs.counted, 6);
    assert.equal(report.usage.skipped.vanilla, 3);
  } finally { env.done(); }
});

test('exposure: a load outside the listed agents still counts as exposed, and the installed agent filter beats the base listing', () => {
  const env = makeEnv();
  try {
    makeRunDir(path.join(env.runsDir, 'f'), {
      arms: [V1],
      runs: [
        { arm: 'v1', rep: 1, filter: ['idle'], loads: [] },
        { arm: 'v1', rep: 2, filter: ['idle'], loads: [] },
        { arm: 'v1', rep: 3, loads: ['orphan'] },
      ],
    });
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', path.join(env.runsDir, 'f')]);
    assert.equal(row(report, 'idle').exposure.runs, 3, 'two by filter, one by the base listing');
    assert.equal(row(report, 'used').exposure.runs, 1, 'the filtered runs do not offer used');
    assert.equal(row(report, 'orphan').exposure.runs, 1, 'a load proves the skill was reachable');
    assert.equal(row(report, 'orphan').loads.total, 1);
  } finally { env.done(); }
});

test('exposure: delegation without a named agent leaves the count coarse and is labelled', () => {
  const env = makeEnv();
  try {
    makeRunDir(path.join(env.runsDir, 'u'), { arms: [V1], runs: [{ arm: 'v1', rep: 1, unnamedDelegate: 1 }, { arm: 'v1', rep: 2, delegate: ['k-dev'] }, { arm: 'v1', rep: 3 }] });
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', path.join(env.runsDir, 'u')]);
    assert.equal(row(report, 'devonly').exposure.runs, 1);
    assert.equal(row(report, 'devonly').exposure.coarse, 1);
    assert.equal(row(report, 'used').exposure.coarse, 0, 'the entry agent lists it, so the unnamed hop cannot change the count');
    assert.equal(report.usage.runs.coarse, 1);
  } finally { env.done(); }
});

test('usage is kept per ref and overall; two refs are never merged into one row', () => {
  const env = makeEnv();
  try {
    makeRunDir(path.join(env.runsDir, 'a'), { arms: [V1], runs: [{ arm: 'v1', rep: 1, loads: [{ name: 'used', bytes: 300 }] }, { arm: 'v1', rep: 2 }] });
    makeRunDir(path.join(env.runsDir, 'b'), { arms: [V2], runs: [{ arm: 'v2', rep: 1, loads: ['used'] }, { arm: 'v2', rep: 2, loads: ['used'] }, { arm: 'v2', rep: 3 }] });
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', `${path.join(env.runsDir, 'a')},${path.join(env.runsDir, 'b')}`]);
    const u = row(report, 'used');
    assert.equal(u.exposure.runs, 5);
    assert.equal(u.loads.runsLoaded, 3);
    const keys = Object.keys(u.byRef).sort();
    assert.deepEqual(keys, ['origin/main@7428dd9', 'v0@4430696']);
    assert.deepEqual([u.byRef['v0@4430696'].exposed, u.byRef['v0@4430696'].runsLoaded], [2, 1]);
    assert.deepEqual([u.byRef['origin/main@7428dd9'].exposed, u.byRef['origin/main@7428dd9'].runsLoaded], [3, 2]);
    assert.deepEqual(report.usage.refs.map((x) => [x.ref, x.runs]).sort(), [['origin/main@7428dd9', 3], ['v0@4430696', 2]]);
    assert.ok(u.loads.bytes > 0 && u.byRef['v0@4430696'].bytes > 300);
    assert.ok(report.usage.refs.every((x) => x.matchesBase === false), 'neither fixture commit is the synthetic base commit');
    assert.ok(report.warnings.some((w) => /different commit than the base/.test(w) && /origin\/main/.test(w)));
    assert.ok(report.warnings.some((w) => /combine 2 ref rows/.test(w)));
  } finally { env.done(); }
});

test('a run built from the base commit is marked as matching and raises no off-base warning', () => {
  const env = makeEnv();
  try {
    makeRunDir(path.join(env.runsDir, 'a'), { arms: [{ id: 'v1', label: 'v1', ref: 'v0', sha: env.sha }], runs: [{ arm: 'v1', rep: 1 }] });
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', path.join(env.runsDir, 'a')]);
    assert.equal(report.usage.refs[0].matchesBase, true);
    assert.ok(!report.warnings.some((w) => /different commit/.test(w)));
  } finally { env.done(); }
});

test('a variant arm is its own ref, and its filter keeps a dropped skill from counting as exposed', () => {
  const env = makeEnv();
  try {
    const VAR = { id: 'minus', label: 'minus@04b8e41e1337', ref: 'dir:/x/variants/y/tree', sha: null };
    makeRunDir(path.join(env.runsDir, 'v'), { arms: [VAR], runs: [{ arm: 'minus', rep: 1, filter: ['idle'] }, { arm: 'minus', rep: 2, filter: ['idle'] }] });
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', path.join(env.runsDir, 'v')]);
    assert.deepEqual(report.usage.refs.map((x) => x.ref), ['variant:04b8e41e1337']);
    assert.equal(report.usage.refs[0].variant, true);
    assert.equal(row(report, 'used').exposure.runs, 0);
  } finally { env.done(); }
});

test('runs are skipped, and counted by reason: no stream, no result, infra error, duplicates', () => {
  const env = makeEnv();
  try {
    const dir = makeRunDir(path.join(env.runsDir, 'a'), {
      arms: [VAN, V1],
      runs: [
        { arm: 'v1', rep: 1, loads: ['used'] }, { arm: 'v1', rep: 2, noStream: true }, { arm: 'v1', rep: 3, noResult: true },
        { arm: 'v1', rep: 4, infraError: 'mcp failed', loads: ['used'] }, { arm: 'vanilla', rep: 1, loads: ['used'] },
      ],
    });
    fs.cpSync(dir, path.join(env.runsDir, 'a.bak'), { recursive: true });
    const { r, report } = prune(env, ['--harness', 'kiro-cli', '--runs-glob', path.join(env.runsDir, '*')]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(report.usage.runs.counted, 1);
    assert.deepEqual(report.usage.skipped, { vanilla: 2, noStream: 2, noResult: 2, infraError: 2, duplicate: 1, otherHarness: 0 });
    assert.equal(row(report, 'used').loads.runsLoaded, 1);
    assert.equal(report.inputs.runDirs.length, 2);
  } finally { env.done(); }
});

test('opencode: every non-vanilla opencode run is exposed to every skill; kiro runs are not counted there', () => {
  const env = makeEnv();
  try {
    const OC = { id: 'oc-v1', label: 'oc-v1', ref: 'v0', sha: '4430696d98aafa46f1c992c5fb0ca3479259ccd9' };
    makeRunDir(path.join(env.runsDir, 'oc'), {
      arms: [OC],
      runs: [
        { arm: 'oc-v1', rep: 1, harness: 'opencode', loads: ['orphan', 'used'] }, { arm: 'oc-v1', rep: 2, harness: 'opencode', loads: ['orphan'] },
        { arm: 'oc-v1', rep: 3, harness: 'opencode', loads: [] },
      ],
    });
    makeRunDir(path.join(env.runsDir, 'k'), { arms: [V1], runs: [{ arm: 'v1', rep: 1, loads: ['used'] }] });
    const { report } = prune(env, ['--harness', 'both', '--runs', `${path.join(env.runsDir, 'oc')},${path.join(env.runsDir, 'k')}`, '--min-exposure', '3']);
    assert.equal(row(report, 'orphan', 'opencode').exposure.runs, 3);
    assert.equal(row(report, 'orphan', 'opencode').loads.runsLoaded, 2);
    assert.equal(cls(report, 'orphan', 'opencode').class, 'KEEP');
    assert.equal(cls(report, 'orphan', 'opencode').provisional, true);
    assert.equal(row(report, 'used', 'opencode').exposure.runs, 3);
    assert.equal(row(report, 'used', 'kiro-cli').exposure.runs, 1);
    assert.equal(cls(report, 'idle', 'opencode').class, 'FIX');
    assert.match(cls(report, 'idle', 'opencode').reason, /index/);
    assert.deepEqual(report.usage.refs.map((x) => x.harness).sort(), ['kiro-cli', 'opencode']);
  } finally { env.done(); }
});

test('a harness that is not assessed is not counted', () => {
  const env = makeEnv();
  try {
    const OC = { id: 'oc-v1', label: 'oc-v1', ref: 'v0', sha: null };
    makeRunDir(path.join(env.runsDir, 'oc'), { arms: [OC], runs: [{ arm: 'oc-v1', rep: 1, harness: 'opencode', loads: ['used'] }] });
    const { report } = prune(env, ['--harness', 'kiro-cli', '--runs', path.join(env.runsDir, 'oc')]);
    assert.equal(report.usage.runs.counted, 0);
    assert.equal(report.usage.skipped.otherHarness, 1);
    assert.equal(report.capabilities[0].harnesses.opencode, undefined);
  } finally { env.done(); }
});

test('expandGlob matches directories per path segment and ignores files', () => {
  const env = makeEnv();
  try {
    for (const d of ['run-1', 'run-2', 'other', 'run-3.bak']) fs.mkdirSync(path.join(env.runsDir, d), { recursive: true });
    fs.writeFileSync(path.join(env.runsDir, 'run-9'), 'file');
    assert.deepEqual(expandGlob(path.join(env.runsDir, 'run-*')).map((p) => path.basename(p)), ['run-1', 'run-2', 'run-3.bak']);
    assert.deepEqual(expandGlob(path.join(env.runsDir, 'run-?')).map((p) => path.basename(p)), ['run-1', 'run-2']);
    assert.deepEqual(expandGlob(path.join(env.runsDir, 'none-*')), []);
    assert.deepEqual(expandGlob(path.join(env.runsDir, '*', 'x')), []);
  } finally { env.done(); }
});

// ---- evidence ----

test('parseEvidence accepts the documented rows and normalises the kiro alias', () => {
  const { rows, errors, warnings } = parseEvidence(JSON.stringify([evRow({ harness: 'kiro' }), evRow({ capId: 'skill:a', kind: 'trigger', delta: null, aaSpread: null, verdict: 'none', runId: undefined, note: undefined })]));
  assert.deepEqual(errors, []);
  assert.equal(rows[0].harness, 'kiro-cli');
  assert.equal(rows[1].runId, null);
  assert.equal(rows[1].behaviorChange, false);
  assert.deepEqual(warnings, []);
});

test('parseEvidence reports every problem: shape, enums, types, unknown keys and a verdict inside the spread', () => {
  const bad = [
    'x', evRow({ capId: 'alpha' }), evRow({ harness: 'claude' }), evRow({ kind: 'vibes' }), evRow({ verdict: 'great' }), evRow({ n: 0 }), evRow({ n: 2.5 }),
    evRow({ delta: 'big' }), evRow({ aaSpread: -1 }), evRow({ task: '' }), evRow({ extra: 1 }), evRow({ behaviorChange: 'yes' }),
  ];
  const { errors } = parseEvidence(JSON.stringify(bad));
  assert.equal(errors.length, bad.length);
  assert.match(errors[0], /row 1.*object/);
  assert.match(errors.join('\n'), /row 2.*capId/);
  assert.match(errors.join('\n'), /row 11.*unknown key "extra"/);
  assert.equal(parseEvidence('{}').errors.length, 1);
  assert.match(parseEvidence('{}').errors[0], /list/);
  const inside = parseEvidence(JSON.stringify([evRow({ delta: 0.05, aaSpread: 0.1 }), evRow({ verdict: 'hurts', delta: null, runId: 'r2' })]));
  assert.equal(inside.errors.length, 0);
  assert.equal(inside.warnings.length, 2);
  assert.match(inside.warnings[0], /inside the A\/A spread/);
});

test('evidence for an unknown capability is a warning, and invalid evidence is an input error (exit 2)', () => {
  const env = makeEnv();
  try {
    const ok = prune(env, ['--harness', 'kiro-cli', '--evidence', writeEvidence(env, [evRow({ capId: 'skill:nonesuch' })])]);
    assert.equal(ok.r.status, 0, ok.r.stderr);
    assert.ok(ok.report.warnings.some((w) => /skill:nonesuch/.test(w)));
    const bad = prune(env, ['--evidence', writeEvidence(env, [evRow({ verdict: 'great' }), evRow({ n: 0 })])], { out: path.join(env.root, 'out3') });
    assert.equal(bad.r.status, 2);
    assert.match(bad.r.stderr, /row 1.*verdict/);
    assert.match(bad.r.stderr, /row 2.*n/);
    assert.equal(fs.existsSync(path.join(env.root, 'out3', 'prune-report.json')), false);
    const missing = prune(env, ['--evidence', path.join(env.root, 'nope.json')]);
    assert.equal(missing.r.status, 2);
    fs.writeFileSync(path.join(env.root, 'junk.json'), '{ not json');
    const junk = prune(env, ['--evidence', path.join(env.root, 'junk.json')]);
    assert.equal(junk.r.status, 2);
    assert.match(junk.r.stderr, /not valid JSON/);
  } finally { env.done(); }
});

test('the shipped example evidence file parses, targets delegation-protocol on kiro-cli and is labelled as an example', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'capabilities', 'evidence.example.json'), 'utf8');
  const { rows, errors } = parseEvidence(text);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].capId, 'skill:delegation-protocol');
  assert.equal(rows[0].harness, 'kiro-cli');
  assert.equal(rows[0].n, 3);
  assert.equal(rows[0].verdict, 'unmeasurable');
  assert.equal(rows[0].behaviorChange, true);
  assert.match(rows[0].note, /^EXAMPLE/);
  assert.match(rows[0].note, /8 fields/);
});

// ---- report shape and the command ----

function shapeErrors(rep) {
  const errs = [];
  const need = (obj, keys, where) => { for (const [k, t] of Object.entries(keys)) { const v = obj?.[k]; const ok = t === 'array' ? Array.isArray(v) : t === 'null|string' ? v === null || typeof v === 'string' : t === 'null|number' ? v === null || typeof v === 'number' : typeof v === t; if (!ok) errs.push(`${where}.${k}: expected ${t}, got ${JSON.stringify(v)?.slice(0, 40)}`); } };
  need(rep, { schemaVersion: 'number', toolVersion: 'string', createdAt: 'string', harnesses: 'array', minExposure: 'number', base: 'object', inputs: 'object', usage: 'object', costContext: 'object', summary: 'object', capabilities: 'array', warnings: 'array', notes: 'array' }, 'report');
  need(rep.usage, { runs: 'object', skipped: 'object', refs: 'array' }, 'usage');
  need(rep.summary, { skills: 'number', byHarness: 'object', trim: 'number', needsDataShare: 'object' }, 'summary');
  need(rep.costContext, { opencode: 'object', kiro: 'object' }, 'costContext');
  for (const c of rep.capabilities) {
    need(c, { id: 'string', name: 'string', bytes: 'number', estTokens: 'number', registryClass: 'string', trim: 'object', otherHarness: 'object', harnesses: 'object', neighbours: 'array' }, c.id);
    need(c.trim, { flag: 'boolean', reasons: 'array' }, `${c.id}.trim`);
    for (const [h, v] of Object.entries(c.harnesses)) {
      need(v, { reachable: 'boolean', exposure: 'object', loads: 'object', byRef: 'object', evidence: 'array', classification: 'object' }, `${c.id}.${h}`);
      need(v.exposure, { runs: 'number', coarse: 'number', basis: 'object' }, `${c.id}.${h}.exposure`);
      need(v.loads, { runsLoaded: 'number', total: 'number', rate: 'null|number', bytes: 'number' }, `${c.id}.${h}.loads`);
      need(v.classification, { class: 'string', provisional: 'boolean', reason: 'string', confidence: 'string', wouldChange: 'string' }, `${c.id}.${h}.classification`);
    }
  }
  return errs;
}

test('the JSON report has the documented shape and the markdown report groups by class', () => {
  const env = makeEnv([prefEntry()]);
  try {
    const dir = scenario(env);
    const ev = writeEvidence(env, [evRow(), evRow({ capId: 'skill:harmful', verdict: 'hurts', delta: -0.4 })]);
    const { r, report, out } = prune(env, ['--runs', dir, '--min-exposure', '4', '--evidence', ev]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(shapeErrors(report), []);
    assert.equal(report.summary.skills, 11);
    assert.equal(report.base.ref, 'v0');
    assert.deepEqual(report.harnesses, ['kiro-cli', 'opencode']);
    assert.equal(report.inputs.evidence.rows, 2);
    const md = fs.readFileSync(path.join(out, 'prune-report.md'), 'utf8');
    const order = ['## Summary', '## HARMS', '## RELOCATE', '## PRUNE', '## FIX', '## KEEP', '## TRIM', '## NEEDS DATA', '## Cost context', '## Usage by ref'].map((h) => md.indexOf(h));
    assert.ok(order.every((i) => i >= 0), `sections: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections appear in the documented order');
    assert.match(md, /recommendation/i);
    assert.match(md, /estimate/i);
    const total = Object.values(report.summary.byHarness['kiro-cli']).reduce((a, b) => a + b, 0);
    assert.equal(total, 11);
    const share = report.summary.needsDataShare['kiro-cli'];
    assert.equal(typeof share.count, 'number');
    assert.equal(share.of, 11);
  } finally { env.done(); }
});

test('cost context: opencode startup bytes by skill, kiro on-demand; the ten biggest are sorted', () => {
  const env = makeEnv();
  try {
    const { report } = prune(env, []);
    const oc = report.costContext.opencode;
    assert.equal(oc.skillCount, 11);
    assert.equal(oc.indexBytes, oc.top.length ? report.capabilities.reduce((n, c) => n + c.descriptionBytes + Buffer.byteLength(c.name), 0) : -1);
    assert.equal(oc.estTokens, Math.round(oc.indexBytes / 4));
    const sizes = oc.top.map((t) => t.bytes);
    assert.deepEqual([...sizes].sort((a, b) => b - a), sizes);
    assert.ok(oc.top.length <= 10);
    assert.match(report.costContext.kiro.note, /on demand/);
    assert.equal(report.costContext.kiro.skillDescriptionBytesAtStartup, 0);
    assert.equal(report.costContext.estimateNote.includes('bytes / 4'), true);
  } finally { env.done(); }
});

test('the command is read-only: scratch HOME untouched, run directories byte-identical, repo clean', () => {
  const env = makeEnv();
  try {
    const dir = scenario(env);
    const digest = (d) => {
      const h = crypto.createHash('sha256');
      for (const f of fs.readdirSync(d, { recursive: true }).sort()) { const p = path.join(d, f); if (fs.statSync(p).isFile()) h.update(f).update(fs.readFileSync(p)); }
      return h.digest('hex');
    };
    const before = digest(dir);
    const status = env.git('status', '--porcelain');
    const { r, out } = prune(env, ['--runs', dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(digest(dir), before);
    assert.equal(env.git('status', '--porcelain'), status);
    assert.deepEqual(fs.readdirSync(env.home), []);
    assert.deepEqual(fs.readdirSync(out).sort(), ['charts', 'prune-report.html', 'prune-report.json', 'prune-report.md']);
  } finally { env.done(); }
});

test('input errors exit 2 and write nothing: missing --base, bad harness, bad min-exposure, missing runs, empty glob, output inside the repo', () => {
  const env = makeEnv();
  try {
    const cases = [
      [[], { base: null }, /needs --base/],
      [['--harness', 'claude'], {}, /--harness takes/],
      [['--min-exposure', '0'], {}, /--min-exposure/],
      [['--min-exposure', 'x'], {}, /--min-exposure/],
      [['--runs', path.join(env.root, 'nope')], {}, /run directory not found/],
      [['--runs-glob', path.join(env.root, 'zzz-*')], {}, /matched no directory/],
      [[], { base: 'no-such-ref' }, /no-such-ref/],
      [[], { out: path.join(env.repo, 'out') }, /inside the repository/],
    ];
    for (const [args, opt, re] of cases) {
      const { r } = prune(env, args, opt);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, re);
    }
    assert.equal(fs.existsSync(path.join(env.repo, 'out')), false);
    const typo = spawnSync(process.execPath, [BENCH_JS, 'cap', 'prune-report', '--base', 'v0', '--evidance', 'x'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: env.home, TMPDIR: env.tmpdir } });
    assert.equal(typo.status, 2);
    assert.match(typo.stderr, /unknown flag --evidance \(did you mean --evidence\?\)/);
  } finally { env.done(); }
});

test('with no run directories the report still classifies by reach and says no usage was read', () => {
  const env = makeEnv();
  try {
    const { r, report } = prune(env, ['--harness', 'kiro-cli', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).summary, report.summary);
    assert.equal(report.usage.runs.counted, 0);
    assert.ok(report.warnings.some((w) => /no run directories/.test(w)));
    assert.equal(cls(report, 'idle').class, 'NEEDS DATA');
    assert.equal(cls(report, 'orphan').class, 'PRUNE');
  } finally { env.done(); }
});

test('the example evidence file does not change a class it does not name', () => {
  const env = makeEnv();
  try {
    const example = path.join(__dirname, '..', '..', 'capabilities', 'evidence.example.json');
    const a = prune(env, ['--harness', 'kiro-cli']).report;
    const b = prune(env, ['--harness', 'kiro-cli', '--evidence', example], { out: path.join(env.root, 'o2') });
    assert.equal(b.r.status, 0, b.r.stderr);
    assert.ok(b.report.warnings.some((w) => /skill:delegation-protocol/.test(w)), 'unknown in this synthetic repo');
    assert.deepEqual(b.report.capabilities.map((c) => cls(b.report, c.id.slice(6)).class), a.capabilities.map((c) => cls(a, c.id.slice(6)).class));
  } finally { env.done(); }
});

// ---- units and own thresholds ----

test('parseEvidence rejects delta and aaSpread given in percentage points and warns when delta disagrees with with/without', () => {
  const { errors } = parseEvidence(JSON.stringify([evRow({ delta: 8 }), evRow({ aaSpread: 5 }), evRow({ delta: -30 })]));
  assert.equal(errors.length, 3);
  assert.match(errors[0], /row 1.*delta 8.*between -1 and 1.*percentage points/);
  assert.match(errors[1], /row 2.*aaSpread 5/);
  const ok = parseEvidence(JSON.stringify([evRow({ withValue: 0.8, withoutValue: 0.5, delta: 0.3 })]));
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
  const off = parseEvidence(JSON.stringify([evRow({ withValue: 0.8, withoutValue: 0.5, delta: 0.08, aaSpread: 0.02 })]));
  assert.deepEqual(off.errors, []);
  assert.match(off.warnings.join('\n'), /row 1.*delta 0.08.*with minus without is 0.3.*units/);
  const flipped = parseEvidence(JSON.stringify([evRow({ withValue: 0.5, withoutValue: 0.8, delta: 0.3, verdict: 'none' })]));
  assert.match(flipped.warnings.join('\n'), /with minus without is -0.3/);
});

test('the text report tags our own thresholds and says a direct SKILL.md read is not counted', () => {
  const env = makeEnv([prefEntry()]);
  try {
    const { r, out } = prune(env, ['--runs', scenario(env), '--min-exposure', '4']);
    assert.equal(r.status, 0, r.stderr);
    const md = fs.readFileSync(path.join(out, 'prune-report.md'), 'utf8');
    assert.match(md, /our own, not from an external source: .*30%.*0\.6.*p90.*10/s);
    assert.match(md, /direct read of a SKILL\.md is not counted/);
    assert.match(md, /not comparable to SkillsBench/);
  } finally { env.done(); }
});
