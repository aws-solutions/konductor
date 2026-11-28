// SPDX-License-Identifier: Apache-2.0
'use strict';

// The STANDARD run kit (bench/scenarios/konductor/standard): syntax, no host paths or login names, no branch-only local read after its
// branch (scripts/shell-unbound.js), and each script's paid path on stubs (the kit's own test-*.sh: a stub bench,
// helper, kiro-cli and claude; no model, no keys, no spend, every dir under /var/tmp).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');

const KIT = path.join(__dirname, '..', '..', 'scenarios', 'konductor', 'standard');
const UNBOUND = path.join(__dirname, '..', '..', 'scripts', 'shell-unbound.js');
const FILES = fs.readdirSync(KIT).filter((f) => f.endsWith('.sh') || f.endsWith('.js'));
const SCRIPTS = FILES.filter((f) => f.endsWith('.sh') && !f.startsWith('test-'));
const TESTS = FILES.filter((f) => f.startsWith('test-') && f.endsWith('.sh'));

// Patterns are built from parts so this file does not match itself.
const j = (...p) => p.join('');
const HOST = new RegExp(`${j('/lo', 'cal/home')}|${j('/ho', 'me/')}[a-z]|${j('nihit', 'kas')}|${j('/var/tmp/k', '2x')}`);

test('kit standard: every script parses and names no host path or login', () => {
  assert.deepEqual(SCRIPTS.sort(), ['claude-standard.sh', 'judge-standard.sh', 'run-standard.sh']);
  for (const f of FILES) {
    const file = path.join(KIT, f);
    if (f.endsWith('.sh')) assert.equal(spawnSync('bash', ['-n', file], { encoding: 'utf8' }).status, 0, `${f}: bash -n`);
    else assert.equal(spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }).status, 0, `${f}: node --check`);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), HOST, `${f} names a host path or login`);
  }
});

test('kit standard: no local read after the branch that binds it (D-157)', () => {
  const r = spawnSync(process.execPath, [UNBOUND, ...SCRIPTS.map((f) => path.join(KIT, f))], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('kit standard: helper plan places every DEV task in run or skipped, a probe task under its own dir', () => {
  const repo = path.join(__dirname, '..', '..', '..');
  // R given as '.', relative to the cwd: the helper must resolve it, not hand require() a bare "bench/..." name.
  const r = spawnSync(process.execPath, [path.join(KIT, 'helper.js'), 'plan', '.'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  const placed = [...p.run.map((t) => t.id), ...p.skipped.map((s) => s.id)].sort();
  assert.deepEqual(placed, [...p.levelIds].sort());
  for (const t of p.run) assert.ok(p.batches[t.batch].tasks.includes(t.id));
  const probe = [...p.run, ...p.skipped].find((t) => t.id.startsWith('probe-'));
  if (probe) assert.ok(!/not in the scenario pack/.test(probe.why || ''), 'a probe DEV task is gated, not dropped as unknown');
});

test('kit standard: helper cc-plan mirrors the plan under the cc- prefix and prices it from the plain credits', () => {
  const repo = path.join(__dirname, '..', '..', '..');
  const dir = mkScratch('ccplan-');
  try {
    // expected is in Kiro credits over the four Kiro arms (ratio sum 5.35): 53.5 is 10 plain credits, 10.7 is 2
    const plan = { konductorSha: 'kon-sha', noskillsArm: 'konductor-noskills=dir:/var/tmp/x/tree', listArm: 'konductor-list=dir:/var/tmp/x/list', run: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], batches: { t1: { tasks: ['a', 'b'], expected: 53.5 }, t9: { tasks: ['c'], expected: 10.7 } } };
    const file = path.join(dir, 'plan.json');
    fs.writeFileSync(file, JSON.stringify(plan));
    const r = spawnSync(process.execPath, [path.join(KIT, 'helper.js'), 'cc-plan', '.', file], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(r.stdout);
    assert.deepEqual(c.arms, ['cc-vanilla', 'cc-konductor=kon-sha', 'cc-konductor-noskills=dir:/var/tmp/x/tree', 'cc-konductor-list=dir:/var/tmp/x/list']);
    assert.deepEqual(c.armIds, ['cc-vanilla', 'cc-konductor', 'cc-konductor-noskills', 'cc-konductor-list']);
    // t1: 10 plain credits x 0.071 USD x (1 + 1.59 + 1.3 + 1.7) = 3.97
    assert.equal(c.batches.t1.expectedUsd, 3.97);
    assert.equal(c.batches.t9.expectedUsd, 0.79);
    assert.equal(c.expectedUsdPerStage, 4.76);
    assert.equal(c.runsPerStage, 12);
    // a plan frozen before the list arm keeps three cc- arms
    fs.writeFileSync(file, JSON.stringify({ ...plan, listArm: undefined }));
    const r3 = spawnSync(process.execPath, [path.join(KIT, 'helper.js'), 'cc-plan', '.', file], { cwd: repo, encoding: 'utf8' });
    assert.equal(JSON.parse(r3.stdout).armIds.length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kit standard: the default STANDARD stage cap is one named constant, 1600, and the repo plan fits under it', () => {
  const src = fs.readFileSync(path.join(KIT, 'run-standard.sh'), 'utf8');
  const m = src.match(/^STAGE_CAP_DEFAULT=(\d+)(?:\s+#.*)?$/m);
  assert.ok(m, 'run-standard.sh sets STAGE_CAP_DEFAULT=<credits> on its own line');
  const cap = Number(m[1]);
  assert.equal(cap, 1600);
  assert.match(src, /^STAGE_CAP=\$\{STAGE_CAP:-\$STAGE_CAP_DEFAULT\}/m);
  assert.doesNotMatch(src, /STAGE_CAP:-\d/, 'no second literal default');
  // 1519: the 2026-11-24 prepare-only preview, priced from the LITE pilot costs (owner host data, not in the repo)
  assert.ok(1519 <= cap);
  const repo = path.join(__dirname, '..', '..', '..');
  const r = spawnSync(process.execPath, [path.join(KIT, 'helper.js'), 'plan', '.'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).expectedPerStage <= cap, 'the repo plan preview fits under the default cap');
});

for (const t of TESTS) {
  test(`kit standard: ${t} (paid path on stubs)`, () => {
    const r = spawnSync('bash', [path.join(KIT, t)], { encoding: 'utf8', timeout: 240000, env: { ...process.env, TMPDIR: '/tmp' } });
    assert.equal(r.status, 0, r.stdout.split('\n').filter((l) => !l.startsWith('PASS')).join('\n') + r.stderr);
    assert.match(r.stdout, /ALL PASS/);
  });
}
