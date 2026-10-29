// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planRuns, runPool, makeLedger, prepareAll, preflightTable } = require('../lib/orchestrate.js');
const { parseArgs } = require('../bench.js');
const { buildChildEnv, buildCheckEnv, describeEnv, snapshotKiroEnv } = require('../lib/env.js');

test('planRuns is replicate-major and every (task, arm) pair runs once per replicate', () => {
  const tasks = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  const arms = [{ id: 'a' }, { id: 'b' }];
  const plan = planRuns(tasks, arms, 2, 7);
  assert.equal(plan.length, 12);
  assert.deepEqual([...new Set(plan.slice(0, 6).map((p) => p.replicate))], [1]);
  assert.deepEqual([...new Set(plan.slice(6).map((p) => p.replicate))], [2]);
  for (const rep of [1, 2]) {
    const keys = plan.filter((p) => p.replicate === rep).map((p) => `${p.task.id}/${p.arm.id}`).sort();
    assert.deepEqual(keys, ['t1/a', 't1/b', 't2/a', 't2/b', 't3/a', 't3/b']);
  }
});

test('planRuns order is reproducible from the seed and differs between seeds', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` }));
  const arms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const key = (plan) => plan.map((p) => `${p.task.id}/${p.arm.id}/${p.replicate}`).join(',');
  assert.equal(key(planRuns(tasks, arms, 2, 5)), key(planRuns(tasks, arms, 2, 5)));
  assert.notEqual(key(planRuns(tasks, arms, 2, 5)), key(planRuns(tasks, arms, 2, 6)));
});

test('planRuns does not put one arm or one task first in every replicate', () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));
  const arms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const firstArms = new Set();
  for (let seed = 1; seed <= 10; seed++) firstArms.add(planRuns(tasks, arms, 1, seed)[0].arm.id);
  assert.ok(firstArms.size > 1);
});

test('ledger charges a censored run at the arm median, or the floor when the arm has no completed run', () => {
  const ledger = makeLedger({ budgetCredits: 100, floor: 1.5, runsPerReplicate: 4 });
  assert.equal(ledger.add({ armId: 'a', credits: null, creditsCensored: true }), 1.5);
  ledger.add({ armId: 'a', credits: 2, creditsCensored: false });
  ledger.add({ armId: 'a', credits: 6, creditsCensored: false });
  assert.equal(ledger.add({ armId: 'a', credits: 0.1, creditsCensored: true }), 4);
  assert.equal(ledger.add({ armId: 'b', credits: 9, creditsCensored: true }), 9);
  assert.ok(Math.abs(ledger.observed - 17.1) < 1e-9);
  assert.ok(Math.abs(ledger.charged - (1.5 + 2 + 6 + 4 + 9)) < 1e-9);
});

test('ledger skips whole later replicates when the next one is projected to overshoot', () => {
  const ledger = makeLedger({ budgetCredits: 13, runsPerReplicate: 2 });
  assert.equal(ledger.shouldSkip({ replicate: 1 }), false);
  ledger.add({ armId: 'a', credits: 3, creditsCensored: false });
  ledger.add({ armId: 'b', credits: 3, creditsCensored: false });
  assert.equal(ledger.shouldSkip({ replicate: 2 }), false);
  ledger.add({ armId: 'a', credits: 3, creditsCensored: false });
  assert.equal(ledger.shouldSkip({ replicate: 2 }), false, 'decision for a replicate is made once');
  assert.equal(ledger.shouldSkip({ replicate: 3 }), true);
  assert.equal(ledger.shouldSkip({ replicate: 4 }), true);
});

test('runPool never exceeds the parallel limit and returns results in plan order', async () => {
  let active = 0;
  let peak = 0;
  const worker = async (item) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return item * 2;
  };
  const out = await runPool([1, 2, 3, 4, 5, 6], 2, worker, () => false, () => null);
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
});

test('runPool skips remaining items once the guard trips, keeping them in the output', async () => {
  let spent = 0;
  const worker = async () => { spent += 1; return 'ran'; };
  const out = await runPool([1, 2, 3, 4], 1, worker, () => spent >= 2, () => 'skipped');
  assert.deepEqual(out, ['ran', 'ran', 'skipped', 'skipped']);
});

test('parseArgs handles values, bare flags and positionals', () => {
  const o = parseArgs(['--suite', 'lite', '--cargo-online', '--arms', 'a,b']);
  assert.equal(o.suite, 'lite');
  assert.equal(o['cargo-online'], true);
  assert.equal(o.arms, 'a,b');
});

test('buildChildEnv passes only the allowlist, pins its own values, and reports what it dropped', () => {
  const base = {
    PATH: '/bin', HOME: '/real', LANG: 'C.UTF-8', GITHUB_TOKEN: 'g', AWS_ACCESS_KEY_ID: 'a', SSH_AUTH_SOCK: '/s',
    NODE_OPTIONS: '--require x', KIRO_SESSION_ID: 'x', KIRO_TUI_READY_FILE: 'y', KIRO_AGENT_ENGINE: 'kas',
    KIRO_FEED_FILE: '/real/feed', ACME_KIRO_MANDATORY_MCPS: 'creds-agent', https_proxy: 'http://p:1', TERM: 'xterm',
  };
  const { env, unset, keys } = buildChildEnv(base, { home: '/scratch/h', tmpdir: '/scratch/t', agentEngine: 'v2' });
  assert.deepEqual(keys, ['HOME', 'KIRO_AGENT_ENGINE', 'KIRO_FEED_FILE', 'KIRO_TURN_MARKER_DIR', 'KONDUCTOR_TELEMETRY', 'LANG', 'PATH', 'TERM', 'TMPDIR', 'https_proxy']);
  assert.equal(env.HOME, '/scratch/h');
  assert.equal(env.TMPDIR, '/scratch/t');
  assert.equal(env.TERM, 'dumb');
  assert.equal(env.KONDUCTOR_TELEMETRY, 'off');
  assert.equal(env.KIRO_AGENT_ENGINE, 'v2');
  assert.equal(env.KIRO_FEED_FILE, '/scratch/h/.local/share/kiro-cli/feed.json');
  assert.equal(env.ACME_KIRO_MANDATORY_MCPS, undefined);
  assert.deepEqual(unset.sort(), ['ACME_KIRO_MANDATORY_MCPS', 'KIRO_SESSION_ID']);
  assert.equal(base.HOME, '/real');
});

test('buildChildEnv passes extra Kiro variables only when asked; check env never gets Kiro variables', () => {
  const base = { PATH: '/bin', KIRO_INTERNAL: '1' };
  assert.equal(buildChildEnv(base, { home: '/h', agentEngine: 'v2' }).env.KIRO_INTERNAL, undefined);
  assert.equal(buildChildEnv(base, { home: '/h', agentEngine: 'v2', keep: ['KIRO_INTERNAL'] }).env.KIRO_INTERNAL, '1');
  const check = buildCheckEnv(base, { home: '/h', keep: ['KIRO_INTERNAL'] });
  assert.equal(check.env.KIRO_INTERNAL, undefined);
  assert.equal(check.env.KIRO_AGENT_ENGINE, undefined);
  assert.equal(check.env.HOME, '/h');
});

test('describeEnv lists final key names, never inherited values of secrets', () => {
  const base = { PATH: '/bin', KIRO_TUI_READY_TOKEN: 'secret', GITHUB_TOKEN: 'g', ACME_KIRO_MANDATORY_MCPS: 'creds-agent' };
  const d = describeEnv(base, buildChildEnv(base, { home: '/h', agentEngine: 'v2' }));
  assert.equal(JSON.stringify(d).includes('secret'), false);
  assert.equal(JSON.stringify(d).includes('"g"'), false);
  assert.ok(d.finalKeys.includes('PATH'));
  assert.deepEqual(d.notPassed, ['ACME_KIRO_MANDATORY_MCPS']);
  assert.equal(d.inherited.KIRO_TUI_READY_TOKEN, '<redacted>');
});

test('snapshotKiroEnv lists only KIRO_ variables and redacts secret-like ones', () => {
  const snap = snapshotKiroEnv({ PATH: '/bin', KIRO_VERSION: '2', KIRO_TUI_READY_TOKEN: 'secret', ACME_KIRO_X: '1' });
  assert.deepEqual(snap, { KIRO_VERSION: '2', KIRO_TUI_READY_TOKEN: '<redacted>', ACME_KIRO_X: '1' });
});

test('prepareAll fails fast on an arm that cannot be built, and --allow-partial keeps the rest', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-'));
  const bad = { id: 'v0', label: 'v0', ref: 'v0', commitSha: '0'.repeat(40), vanilla: false, warnings: [] };
  const vanilla = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, vanilla: true, warnings: [] };
  const ctx = { repo: path.resolve(__dirname, '..', '..', '..'), cacheDir: cache, cargoTarget: path.join(cache, 't'), cargoOnline: false, config: { model: 'm' } };
  try {
    assert.throws(() => prepareAll({ arms: [vanilla, bad], ctx, log: () => {} }), /arm v0 could not be prepared.*--allow-partial/s);
    const { prepared, errors } = prepareAll({ arms: [vanilla, bad], ctx, log: () => {}, allowPartial: true });
    assert.equal(prepared.size, 0);
    assert.ok(errors.has('v0'));
    const table = preflightTable([vanilla, bad], prepared, errors);
    assert.match(table, /vanilla.*ready/);
    assert.match(table, /v0.*FAILED/);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});
