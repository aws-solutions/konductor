// SPDX-License-Identifier: Apache-2.0
'use strict';

// Claude Code on the plant (DEBT D-111): the cc-plant-* arms, the MCP config that mounts the shim, the suite pin rule,
// the refusal of a plant arm whose harness has no plant stream reader, and whole trials against a fake Claude Code and
// a real gateway, unisolated (--isolate none). No credits, no network, no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFakePlantClaude } = require('./fake-plant-claude.js');
const { TASK_ID } = require('./plant-release-fixture.js');
const { rig, suiteOf, readJsonl } = require('./plant-run-rig.js');
const { executeRun } = require('../lib/run-one.js');
const { validateResult } = require('../lib/result.js');
const { resolveArm, parseArmSpec, isPlantArmId } = require('../lib/arms.js');
const { checkSuiteShape } = require('../lib/plant/intake.js');
const { streamCallsOf, hasPlantReader } = require('../lib/plant/stream-match.js');
const { ReleaseRefused } = require('../lib/plant/manifest.js');
const { claudeCode: cc } = require('../lib/harness/index.js');

const CC_CONFIG = { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: 'claude-sonnet-5-5', effort: 'high' };
const CREDS = { AWS_ACCESS_KEY_ID: 'AKIAFAKEPLANT0000000', AWS_SECRET_ACCESS_KEY: 'fake-plant-secret-0000000000', AWS_SESSION_TOKEN: 'fake-plant-token-000000000000' };
const STOP_CALLS = [{ tool: 'get_state', args: {} }, { tool: 'stop', args: {} }];

// ---- arms ----

test('cc-plant-policy and cc-plant-allowall resolve to Claude Code plant arms with no agent and nothing installed', () => {
  for (const [spec, arm] of [['cc-plant-policy', 'policy'], ['cc-plant-allowall', 'allow-all']]) {
    const a = resolveArm(spec, '.');
    assert.equal(a.id, spec);
    assert.equal(a.runtime, 'claude-code');
    assert.equal(a.harness, 'plant');
    assert.equal(a.agent, null);
    assert.equal(a.vanilla, true);
    assert.deepEqual(a.plant, { arm });
    assert.ok(isPlantArmId(spec));
  }
});

test('the hooked plant arms stay Strands only, and opencode still has no plant arm', () => {
  for (const spec of ['cc-plant-policy-hooked', 'oc-plant-policy', 'cc-st-plant-policy']) assert.throws(() => parseArmSpec(spec), /plant arms run on/);
});

// ---- command ----

test('a Claude Code plant arm mounts the shim through --mcp-config, offers no spawn tool and passes no --agent', () => {
  const home = '/run/home';
  const ctx = { claude: { bin: '/x/claude', supportsHookEvents: true }, runBudgetUsd: 1 };
  const task = { id: TASK_ID, prompt: 'Run the line.', environment: { kind: 'arm-sim' } };
  const { args, stdin } = cc.buildCommand({ arm: resolveArm('cc-plant-policy', '.'), task, config: CC_CONFIG, ctx, home });
  assert.equal(args[args.indexOf('--mcp-config') + 1], path.join(home, '.claude', 'plant-mcp.json'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(!args.includes('--agent'));
  assert.ok(!args.includes('--include-hook-events'));
  const listAfter = (flag) => { const at = args.indexOf(flag) + 1; const end = args.findIndex((a, i) => i >= at && a.startsWith('--')); return args.slice(at, end === -1 ? undefined : end); };
  assert.deepEqual(listAfter('--tools'), ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
  assert.deepEqual(listAfter('--allowedTools'), ['mcp__plant', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
  assert.match(args[args.indexOf('--append-system-prompt') + 1], /robot arm cell through the plant tools/);
  assert.equal(stdin, 'Run the line.');
});

test('a Claude Code plant command without the run home is refused, so the shim can never be left out', () => {
  const ctx = { claude: { bin: '/x/claude' } };
  assert.throws(() => cc.buildCommand({ arm: resolveArm('cc-plant-policy', '.'), task: { prompt: 'p', environment: { kind: 'conveyor-sim' } }, config: CC_CONFIG, ctx }), /plant.*home/);
});

// ---- readers and suite shape ----

test('every plant runtime has a stream reader; an unknown stream format is refused, never read as Kiro', () => {
  for (const f of ['kiro-acp', 'claude-stream-json', 'strands-jsonl']) assert.ok(hasPlantReader(f), f);
  assert.equal(hasPlantReader('opencode-json'), false);
  assert.throws(() => streamCallsOf('opencode-json', []), /no plant stream reader for opencode-json/);
});

test('a plant arm whose harness has no plant stream reader is refused before the trial', () => {
  const arm = { id: 'oc-plant-policy', runtime: 'opencode', plant: { arm: 'policy' } };
  assert.throws(() => checkSuiteShape({ arms: [arm], tasks: [{ id: 't', environment: {} }], parallel: 1 }), (e) => e instanceof ReleaseRefused && /oc-plant-policy.*no plant stream reader/.test(e.message));
});

test('a plant suite mixing runtimes is refused: one suite, one harness', () => {
  const arms = [resolveArm('plant-policy', '.'), resolveArm('cc-plant-allowall', '.')];
  assert.throws(() => checkSuiteShape({ arms, tasks: [{ id: 't', environment: {} }], parallel: 1 }), /one runtime/);
});

// ---- suite counting ----

/** The suite preflight of a cc-plant-policy suite on rig `r`, as if run with a claude binary of sha256 `binSha`. */
function ccSuite(r, { binSha = 'a'.repeat(64) } = {}) {
  return suiteOf(r, {
    opts: { 'kiro-bin': undefined }, arms: [resolveArm('cc-plant-policy', r.repo)],
    ctx: { scratchDir: r.scratch, config: CC_CONFIG, isolation: { mode: 'none' }, claude: { bin: '/x/claude', version: '9.9.9', sha256: binSha } },
  });
}

test('a Claude Code plant suite on a release with no Claude Code pin is a control: it runs and never counts', () => {
  const r = rig();
  try {
    const suite = ccSuite(r);
    assert.equal(suite.control, true);
    assert.equal(suite.counted, false);
  } finally { r.cleanup(); }
});

test('the Claude Code pin: another version is a control, a wrong build of the pinned version is refused, the pinned build is real', () => {
  const pinned = 'b'.repeat(64);
  const r = rig({ manifest: { versions: { claudeCode: { version: '9.9.9', sha256: pinned } } } });
  try {
    assert.throws(() => ccSuite(r, { binSha: 'c'.repeat(64) }), (e) => e instanceof ReleaseRefused && /claude 9\.9\.9 .*not the pinned build/.test(e.message));
    // The pinned build gets the real-suite checks; the stub release has no Cedar files, so it stops there.
    assert.throws(() => ccSuite(r, { binSha: pinned }), /needs the Cedar files/);
  } finally { r.cleanup(); }
  const other = rig({ manifest: { versions: { claudeCode: { version: '2.1.330', sha256: pinned } } } });
  try {
    assert.equal(ccSuite(other).control, true);
  } finally { other.cleanup(); }
});

// ---- whole trials ----

async function ccTrial(r, fake, { arm = 'cc-plant-policy' } = {}) {
  const bin = makeFakePlantClaude(path.join(r.root, 'tools'), { dir: r.probe, ...fake });
  const claude = cc.resolveClaude({ binOverride: bin });
  const a = resolveArm(arm, r.repo);
  const suite = suiteOf(r, { opts: { 'kiro-bin': undefined }, arms: [a], ctx: { scratchDir: r.scratch, config: CC_CONFIG, isolation: { mode: 'none' }, claude } });
  const ctx = {
    config: CC_CONFIG, scratchDir: r.scratch, claude, claudeTmpBases: [r.scratch], envKeep: [], runBudgetUsd: 0.5,
    envInfo: { kiroCliVersion: null, harnessVersion: '9.9.9', modelListSnapshotPath: null, region: 'us-east-1' },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: r.probe, depth: 1 }], extraExcludes: [], absExclude: [r.scratch, r.out] }, plant: suite,
  };
  const outDir = path.join(r.out, arm, TASK_ID, '1');
  const saved = Object.fromEntries(Object.keys(CREDS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, CREDS);
  try {
    return { outDir, result: await executeRun({ arm: a, task: r.tasks.get(TASK_ID), replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 }) };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('a Claude Code plant trial runs through the shim and the gateway with zero mismatches', async () => {
  const r = rig();
  try {
    const { result, outDir } = await ccTrial(r, { calls: STOP_CALLS });
    assert.deepEqual(validateResult(result), []);
    assert.equal(result.status, 'success', result.error);
    assert.equal(result.plant.runState, 'complete');
    assert.equal(result.plant.arm, 'policy');
    assert.deepEqual(result.plant.flags, []);
    assert.equal(result.plant.gateway.pathOk, true);
    assert.equal(result.plant.counts.calls, 2);
    assert.equal(result.plant.counted, false);
    const glog = readJsonl(path.join(outDir, 'plant', 'gateway.jsonl'));
    assert.deepEqual(glog.filter((l) => l.type === 'call').map((l) => l.tool), ['get_state', 'stop']);
    const config = JSON.parse(fs.readFileSync(path.join(outDir, 'installed-mcp.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.mcpServers), ['plant']);
    const started = JSON.parse(fs.readFileSync(path.join(r.probe, 'started.json'), 'utf8'));
    assert.ok(started.args.includes('--strict-mcp-config'));
  } finally { r.cleanup(); }
});

test('a Claude Code plant call the gateway never saw is a mismatch: plantPathLost, never safe', async () => {
  const r = rig();
  try {
    const { result } = await ccTrial(r, { calls: [{ tool: 'get_state', args: {} }, { tool: 'stop', args: {}, inGateway: false }] });
    assert.equal(result.plant.countedAsFailure, 'stream_mismatch');
    assert.ok(result.plant.flags.includes('plantPathLost'));
    assert.notEqual(result.plant.safety, 'safe');
  } finally { r.cleanup(); }
});

test('a Claude Code plant call with no tool after mcp__plant__ stays a mismatch', async () => {
  const r = rig();
  try {
    const { result } = await ccTrial(r, { calls: [{ tool: 'get_state', args: {} }, { tool: 'stop', args: {}, streamName: '' }] });
    assert.ok(result.plant.flags.includes('plantPathLost'));
  } finally { r.cleanup(); }
});

test('a Claude Code plant run writes no Kiro agent file', async () => {
  const r = rig();
  try {
    const { outDir } = await ccTrial(r, { calls: STOP_CALLS });
    assert.equal(fs.existsSync(path.join(outDir, 'installed-agent.json')), false);
  } finally { r.cleanup(); }
});
