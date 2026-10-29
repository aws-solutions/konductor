// SPDX-License-Identifier: Apache-2.0
'use strict';

// executeRun and the CLI against a fake opencode: no network, no cloud credentials.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeOpencode } = require('./fake-opencode.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { harnessFor, opencode: oc, kiro } = require('../lib/harness/index.js');
const { scanTree } = require('../lib/hygiene.js');
const { resolveArm } = require('../lib/arms.js');
const { buildResult, validateResult } = require('../lib/result.js');

const FX = path.join(__dirname, 'fixtures');
const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const MODEL = 'global.anthropic.claude-sonnet-5-5';
const SECRET = 'fakeSecretValueNotReal0123456789abcdefgh';
const TOKEN = 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==';
const KEY_ID = 'AK' + 'IATESTTESTTEST1234';
const OTHER_KEY_ID = 'AS' + 'IAOTHEROTHEROTHER1';
const CREDS = `[other]\naws_access_key_id = ${OTHER_KEY_ID}\naws_secret_access_key = otherSecret\n\n[bench]\naws_access_key_id = ${KEY_ID}\naws_secret_access_key = ${SECRET}\naws_session_token = ${TOKEN}\n`;
const OC_VANILLA = { id: 'oc-vanilla', label: 'oc-vanilla', ref: null, commitSha: null, harness: 'none', runtime: 'opencode', agent: null, vanilla: true };
const OC_KONDUCTOR = { id: 'oc-v1.2.0', label: 'oc-v1.2.0', ref: 'v1.2.0', commitSha: 'abc', harness: 'claude', runtime: 'opencode', agent: 'konductor', vanilla: false };

const AGENT = (name, tools) => `---\nname: ${name}\ndescription: ${name} agent\nmodel: claude-sonnet-5.5\ntools:\n${tools.map((t) => `- ${t}`).join('\n')}\n---\nBody of ${name}.\n`;

function setup(cfg = {}, { rows = 'vanilla' } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const bin = makeFakeOpencode(path.join(root, 'bin'), {
    dir: probe, streamFile: path.join(FX, `opencode-${rows}.stream.jsonl`), rowsFile: path.join(FX, `opencode-${rows}.rows.json`),
    sessionID: 'ses_e7b047669ffea6BvJf34zDKxOm', ...cfg,
  });
  write(path.join(root, 'creds'), CREDS);
  write(path.join(root, 'rg'), '#!/bin/sh\n');
  write(path.join(root, 'claude/agents/konductor.md'), AGENT('konductor', ['Read', 'Write', 'Agent(k-researcher)', 'Workflow']));
  write(path.join(root, 'claude/agents/k-researcher.md'), AGENT('k-researcher', ['Read', 'Grep']));
  write(path.join(root, 'claude/skills/demo/SKILL.md'), '---\nname: demo\ndescription: d\n---\n');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: MODEL, effort: 'high' }, scratchDir, awsCredsFile: path.join(root, 'creds'), awsProfile: 'bench',
    opencode: { bin, version: '1.19.5', sha256: 'x' }, rgBin: path.join(root, 'rg'), envKeep: [],
    envInfo: { kiroCliVersion: null, harnessVersion: '1.19.5', modelListSnapshotPath: null, region: 'us-east-1' },
    isolation: { mode: 'none' },
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  const task = loadTasks(bench).get('t1');
  return { root, bench, ctx, task, probe, scratchDir, prepared: { claudeDir: path.join(root, 'claude') }, outDir: path.join(root, 'out', 't1'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const started = (s) => JSON.parse(fs.readFileSync(path.join(s.probe, 'started.json'), 'utf8'));

test('buildCommand: pinned model, variant, json events, title set, agent only for konductor arms', () => {
  const ctx = { opencode: { bin: '/x/opencode' } };
  const config = { model: MODEL, effort: 'high' };
  const van = oc.buildCommand({ arm: OC_VANILLA, task: { prompt: 'do it' }, config, ctx, cwd: '/w' });
  assert.equal(van.file, '/x/opencode');
  assert.deepEqual(van.args, ['run', '--dir', '/w', '-m', `amazon-bedrock/${MODEL}`, '--variant', 'high', '--format', 'json', '--auto', '--title', 'bench', 'do it']);
  const kon = oc.buildCommand({ arm: OC_KONDUCTOR, task: { prompt: 'do it' }, config: { ...config, effort: 'max' }, ctx, cwd: '/w' });
  assert.deepEqual(kon.args.slice(-4), ['bench', '--agent', 'konductor', 'do it']);
  assert.ok(kon.args.includes('max'));
  assert.throws(() => oc.variantOf('turbo'), /no opencode variant/);
});

test('the harness is chosen by the arm: oc- arms use opencode, everything else kiro-cli', () => {
  assert.equal(harnessFor(OC_VANILLA), oc);
  assert.equal(harnessFor({ id: 'vanilla' }), kiro);
  assert.equal(harnessFor(resolveArm('vanilla', '/nonexistent')), kiro);
  assert.equal(resolveArm('oc-vanilla', '/nonexistent').runtime, 'opencode');
  assert.equal(harnessFor({ harness: 'opencode' }), oc, 'a result record maps to its harness');
  assert.equal(harnessFor({ harness: 'none' }), kiro, 'results written before the field existed are kiro-cli');
});

test('vanilla run: usage from the database, credentials present only during the run, nothing left behind', async () => {
  const s = setup();
  s.ctx.config.effort = 'low';
  try {
    const r = await executeRun({ arm: OC_VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.harness, 'opencode');
    assert.equal(r.harnessVersion, '1.19.5');
    assert.match(r.runStartedAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(r.credits, null);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.costCensored, false);
    assert.deepEqual(r.tokens, { input: 6, output: 127, reasoning: 0, cacheRead: 10568, cacheWrite: 10685, total: 6 + 127 + 10568 + 10685 });
    assert.ok(Math.abs(r.costUsd - 0.0290513) < 1e-9);
    assert.deepEqual(r.estTokens, { value: r.tokens.total, isEstimate: false });
    assert.deepEqual(r.modelCalls, { meteringEntries: 2, totalRequestCount: 2 });
    assert.equal(r.toolCalls, 1);
    assert.equal(r.subagentCalls, 0);
    assert.equal(r.sessionsRolledUp, 1);
    assert.equal(r.sessionModel, MODEL);
    assert.deepEqual(r.flags, []);
    assert.match(r.finalText, /^I created/);
    assert.equal(r.checks[0].passed, true);
    assert.deepEqual(validateResult(r), []);

    const st = started(s);
    assert.deepEqual(st.credentials, ['[bench]'], 'only the named profile reaches the scratch home');
    assert.equal(st.rg, true);
    assert.match(st.cwd, /scratch\/r-[^/]+\/work$/);
    assert.ok(st.args.includes('--title') && st.args.includes('bench'));
    for (const k of ['AWS_PROFILE', 'AWS_REGION', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'OPENCODE_DISABLE_MODELS_FETCH']) assert.ok(st.envKeys.includes(k), k);
    for (const k of ['AWS_SESSION_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'GITHUB_TOKEN']) assert.equal(st.envKeys.includes(k), false, k);
    assert.equal(st.env.AWS_REGION, 'us-east-1');
    assert.deepEqual(st.agents, [], 'vanilla gets no agents');

    assert.deepEqual(fs.readdirSync(s.scratchDir), [], 'run root removed');
    assert.deepEqual(scanTree(s.root, { literals: [] }).filter((h) => !h.file.endsWith('/creds') && !h.file.includes('/probe/')), []);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.outDir, 'installed-config.json'), 'utf8')).agent, undefined, 'vanilla config defines no agents');
  } finally {
    s.cleanup();
  }
});

test('konductor run: translated agents and skills are installed and subagent sessions are rolled up', async () => {
  const s = setup({}, { rows: 'konductor' });
  s.ctx.config.effort = 'low';
  try {
    const r = await executeRun({ arm: OC_KONDUCTOR, task: s.task, replicate: 1, ctx: s.ctx, prepared: s.prepared, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    const st = started(s);
    assert.deepEqual(st.agents, ['k-researcher.md', 'konductor.md']);
    assert.deepEqual(st.configFiles, ['agents', 'opencode.json', 'skills']);
    assert.deepEqual(st.args.slice(-4, -1), ['bench', '--agent', 'konductor']);
    assert.equal(r.sessionsRolledUp, 2);
    assert.equal(r.tokens.total, 14 + 765 + 91613 + 64506);
    assert.ok(Math.abs(r.costUsd - 0.1781043) < 1e-9);
    assert.equal(r.subagentCalls, 1);
    assert.equal(r.workToolCalls, 3);
    assert.equal(r.toolCalls, 4);
    assert.equal(r.modelCalls.meteringEntries, 5);
    assert.deepEqual(r.rewrittenAgents, ['k-researcher', 'konductor']);
    assert.equal(r.modelNormalized, true);
    assert.ok(r.flags.includes('variantMismatch'), 'the child session ran on the default variant in this capture');
    assert.match(fs.readFileSync(path.join(s.outDir, 'install.log'), 'utf8'), /agents: k-researcher, konductor/);
    assert.equal(fs.existsSync(path.join(s.outDir, 'installed-config.json')), true);
  } finally {
    s.cleanup();
  }
});

test('a secret the agent prints is scrubbed from every output and the run is flagged', async () => {
  const s = setup({ leak: true });
  try {
    const r = await executeRun({ arm: OC_VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.ok(r.flags.includes('credsRedacted'));
    assert.deepEqual(scanTree(s.outDir, { literals: [SECRET, TOKEN] }).filter((h) => h.pattern === 'exact secret value'), []);
    assert.equal(fs.readFileSync(path.join(s.outDir, 'stream.jsonl'), 'utf8').includes(SECRET), false);
    assert.equal(JSON.stringify(r).includes(SECRET), false);
  } finally {
    s.cleanup();
  }
});

test('a throttling error is flagged and the run is an error, not a success', async () => {
  const s = setup({ throttle: true });
  try {
    const r = await executeRun({ arm: OC_VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('throttled'));
    assert.equal(r.runFinishedStatus, 'error');
  } finally {
    s.cleanup();
  }
});

test('a timed-out run keeps the partial database rows and marks the cost censored', async () => {
  const s = setup({ sleepSec: 30 });
  s.task.timeoutSec = 1;
  try {
    const r = await executeRun({ arm: OC_VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.status, 'timeout');
    assert.equal(r.costCensored, true);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.turnDurationMs, null);
    assert.equal(r.credits, null);
    assert.equal(typeof r.costUsd, 'number', 'the rows present at the kill are used');
    assert.throws(() => process.kill(started(s).pid, 0), /ESRCH/);
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
  } finally {
    s.cleanup();
  }
});

test('an unreadable session database is flagged and falls back to the parent stream', async () => {
  const s = setup({ dbFails: true });
  try {
    const r = await executeRun({ arm: OC_VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.ok(r.flags.includes('usageUnavailable'));
    assert.equal(r.tokens.cacheWrite, 10685, 'parent stream totals');
  } finally {
    s.cleanup();
  }
});

test('trialInstall refuses an install opencode cannot load, before any model call', () => {
  const s = setup({ debugFails: true });
  try {
    s.ctx.config = { model: MODEL, effort: 'high' };
    assert.throws(() => oc.trialInstall(s.prepared, s.ctx), /opencode cannot load the installed agents: config invalid/);
  } finally {
    s.cleanup();
  }
  const ok = setup();
  try {
    assert.deepEqual(oc.trialInstall(ok.prepared, ok.ctx), ['k-researcher', 'konductor']);
  } finally {
    ok.cleanup();
  }
});

test('resolveOpencode records version and sha256 of a given binary and refuses a missing one', () => {
  const s = setup();
  try {
    const r = oc.resolveOpencode({ cacheDir: s.root, binOverride: s.ctx.opencode.bin });
    assert.equal(r.version, '1.19.5');
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.throws(() => oc.resolveOpencode({ cacheDir: s.root, binOverride: '/nonexistent/opencode' }), /did not report a version/);
  } finally {
    s.cleanup();
  }
});

test('a result built for opencode validates and keeps credits null', () => {
  const r = buildResult({
    arm: OC_VANILLA, task: { id: 't1' }, replicate: 1, config: { model: MODEL, effort: 'high' }, exec: { exitCode: 0, timedOut: false, wallClockMs: 5 },
    agg: { runFinishedStatus: 'success', meteringEntries: 0, credits: 0, toolCalls: 1, workToolCalls: 1, subagentCalls: 0, toolNames: {} },
    usage: { tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 3, cacheWrite: 4, total: 10 }, costUsd: 0.5, modelCalls: 2, sessions: 1 },
    checks: [], transcript: { bytes: 1, chars: 1 }, env: { harnessVersion: '1.19.5' },
  });
  assert.equal(r.credits, null);
  assert.equal(r.costUsd, 0.5);
  assert.deepEqual(validateResult(r), []);
});

function runCli(root, extra, envExtra = {}) {
  return spawn(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--tasks', 't1', '--isolate', 'none', '--bench-dir', path.join(root, 'bench'),
    '--cache', path.join(root, 'cache'), '--aws-creds-file', path.join(root, 'creds'), '--opencode-bin', path.join(root, 'bin', 'opencode'),
    '--rg-bin', path.join(root, 'rg'), '--repo-root', root, ...extra], { env: { PATH: process.env.PATH, HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), ...envExtra }, stdio: ['ignore', 'pipe', 'pipe'] });
}

function prepareRoot(cfg) {
  const s = setup(cfg);
  fs.mkdirSync(path.join(s.root, 'home'));
  fs.mkdirSync(path.join(s.root, 'tmp'));
  return s;
}

const collect = (child) => new Promise((resolve) => {
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code, signal) => resolve({ code, signal, out, err }));
});

test('CLI: an opencode run writes run-config pins, names-only env.json and a USD summary, and report works on it', async () => {
  const s = prepareRoot({});
  const out = path.join(s.root, 'out-cli');
  try {
    const r = await collect(runCli(s.root, ['--arms', 'oc-vanilla', '--out', out, '--seed', '1', '--budget-usd', '1', '--effort', 'low']));
    assert.equal(r.code, 0, r.err);
    const cfg = JSON.parse(fs.readFileSync(path.join(out, 'run-config.json'), 'utf8'));
    assert.equal(cfg.harness, 'opencode');
    assert.equal(cfg.opencode.version, '1.19.5');
    assert.match(cfg.opencode.binarySha256, /^[0-9a-f]{64}$/);
    assert.deepEqual([cfg.opencode.modelId, cfg.opencode.region, cfg.opencode.variant, cfg.opencode.title], [MODEL, 'us-east-1', 'low', 'bench']);
    assert.equal(cfg.seed, 1);
    assert.ok(cfg.startedAt);
    const envJson = fs.readFileSync(path.join(out, 'env.json'), 'utf8');
    assert.ok(envJson.includes('AWS_PROFILE'));
    assert.equal(envJson.includes(SECRET) || envJson.includes(TOKEN), false);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.ok(summary.totalCostUsd > 0);
    assert.equal('totalCredits' in summary, false);
    assert.deepEqual(scanTree(out, { literals: [SECRET, TOKEN] }), [], 'run outputs hold no credential material');
    const rep = spawnSync(process.execPath, [BENCH_JS, 'report', '--run', out, '--bench-dir', path.join(s.root, 'bench'), '--baseline', 'oc-vanilla'], { encoding: 'utf8' });
    assert.equal(rep.status, 0, rep.stderr);
    const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    assert.match(md, /USD/);
    assert.match(md, /tokens/i);
    assert.equal(/credits per successful run/.test(md), false, 'no kiro credit columns for an opencode run');
  } finally {
    s.cleanup();
  }
});

test('CLI: arms of two harnesses in one run are refused', async () => {
  const s = prepareRoot({});
  try {
    const r = await collect(runCli(s.root, ['--arms', 'vanilla,oc-vanilla', '--out', path.join(s.root, 'o')]));
    assert.notEqual(r.code, 0);
    assert.match(r.err, /different harnesses cannot share one run/);
    const r2 = await collect(runCli(s.root, ['--arms', 'oc-vanilla', '--budget-credits', '5', '--out', path.join(s.root, 'o2')]));
    assert.match(r2.err, /use --budget-usd/);
    const r3 = await collect(runCli(s.root, ['--arms', 'oc-vanilla', '--effort', 'turbo', '--out', path.join(s.root, 'o3')]));
    assert.match(r3.err, /no opencode variant/);
  } finally {
    s.cleanup();
  }
});

for (const signal of ['SIGTERM', 'SIGHUP']) {
  test(`CLI: ${signal} kills the opencode group and leaves no credential copy`, async () => {
    const s = prepareRoot({ sleepSec: 60 });
    const out = path.join(s.root, 'out-sig');
    const child = runCli(s.root, ['--arms', 'oc-vanilla', '--out', out]);
    const done = collect(child);
    try {
      const end = Date.now() + 20000;
      while (!fs.existsSync(path.join(s.probe, 'started.json'))) {
        if (Date.now() > end) throw new Error('fake opencode never started');
        await new Promise((r) => setTimeout(r, 50));
      }
      const credsNow = fs.readdirSync(path.join(s.root, 'tmp'), { recursive: true }).filter((f) => String(f).endsWith('.aws/credentials'));
      assert.equal(credsNow.length, 1, 'the credential copy exists while the agent runs');
      child.kill(signal);
      const r = await done;
      assert.notEqual(r.code, 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.throws(() => process.kill(started(s).pid, 0), /ESRCH/);
      assert.deepEqual(fs.readdirSync(path.join(s.root, 'tmp'), { recursive: true }).filter((f) => /credentials|\.aws/.test(String(f))), []);
      assert.deepEqual(fs.readdirSync(path.join(s.root, 'tmp')).filter((n) => n.startsWith('w-')), []);
      assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).interrupted, signal);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      s.cleanup();
    }
  });
}

test('trialInstall records the arm startup resources, and a run with skill-tool events records skills and the startup count', async () => {
  const s = setup({ streamFile: path.join(FX, 'opencode-skill.stream.jsonl') }, { rows: 'konductor' });
  s.ctx.config.effort = 'low';
  try {
    oc.trialInstall(s.prepared, s.ctx);
    const startup = s.prepared.skillInfo.startup;
    assert.deepEqual(startup.resources.map((r) => r.kind), ['agent-prompt', 'skill-index']);
    assert.deepEqual(startup.skillNames, ['demo']);
    s.ctx.skillInfo = new Map([[OC_KONDUCTOR.id, s.prepared.skillInfo]]);
    const r = await executeRun({ arm: OC_KONDUCTOR, task: s.task, replicate: 1, ctx: s.ctx, prepared: s.prepared, outDir: s.outDir, inFlightAtStart: 0 });
    assert.deepEqual(r.skillsLoaded.map((x) => `${x.name}:${x.via}:${x.count}`), ['backend-review:skill-tool:2', 'sop-k-verify:skill-tool:1']);
    assert.deepEqual(r.sopsLoaded.map((x) => x.name), ['sop-k-verify']);
    assert.equal(r.skillCallsFailed, 2);
    assert.equal(r.startupResourceCount, 2);
    assert.equal(r.skillsScope, 'parent-session');
    assert.equal(r.targetLoaded, null, 'the task has no target');
    assert.deepEqual(validateResult(r), []);
  } finally {
    s.cleanup();
  }
});
