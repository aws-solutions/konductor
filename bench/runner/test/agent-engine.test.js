// SPDX-License-Identifier: Apache-2.0
'use strict';

// --agent-engine picks the kiro-cli engine, the matching `konductor install --harness`, and is recorded per run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { kiroInstallHarness, AGENT_ENGINES, DEFAULT_ENGINE } = require('../lib/harness/runtime.js');
const { kiro } = require('../lib/harness/index.js');
const sandbox = require('../lib/sandbox.js');
const { buildResult, validateResult } = require('../lib/result.js');
const { aggregateStream } = require('../lib/stream.js');

const BENCH = path.join(__dirname, '..', 'bench.js');

test('each engine maps to the install harness whose agents it loads; v2 is the default', () => {
  assert.deepEqual(AGENT_ENGINES, ['v2', 'v3']);
  assert.equal(DEFAULT_ENGINE, 'v2');
  assert.equal(kiroInstallHarness('v2'), 'kiro-cli-v2');
  assert.equal(kiroInstallHarness('v3'), 'kiro-v3');
  assert.equal(kiroInstallHarness(), 'kiro-cli-v2');
  assert.throws(() => kiroInstallHarness('v1'), /unknown agent engine "v1"/);
});

test('installInto runs konductor install with the harness for the engine', () => {
  const root = tmp();
  try {
    const argvFile = path.join(root, 'argv');
    const bin = path.join(root, 'konductor');
    fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> '${argvFile}'\n`, { mode: 0o755 });
    const prepared = { bin, exportDir: path.join(root, 'src') };
    sandbox.installInto(path.join(root, 'h2'), prepared, 'v2');
    sandbox.installInto(path.join(root, 'h3'), prepared, 'v3');
    const lines = fs.readFileSync(argvFile, 'utf8').trim().split('\n');
    assert.match(lines[0], /^install --harness kiro-cli-v2 --from /);
    assert.match(lines[1], /^install --harness kiro-v3 --from /);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the kiro-cli command line carries the configured engine', () => {
  const arm = { id: 'main', agent: 'konductor', vanilla: false };
  const { args } = kiro.buildCommand({ arm, task: { prompt: 'p' }, config: { model: 'm', effort: 'high', agentEngine: 'v3' }, ctx: {} });
  assert.equal(args[args.indexOf('--agent-engine') + 1], 'v3');
});

test('result.json records the engine and the install harness it used', () => {
  const agg = aggregateStream([{ type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: 'done', finalTextTruncated: false } }]);
  const build = (arm, agentEngine) => buildResult({
    arm, task: { id: 't1' }, replicate: 1, config: { model: 'm', effort: 'high', agentEngine }, exec: { timedOut: false, exitCode: 0, wallClockMs: 1 },
    agg, session: null, checks: [], transcript: { chars: 1, bytes: 1, partial: false }, env: { kiroCliVersion: 'k', modelListSnapshotPath: null },
  });
  const main = { id: 'main', label: 'main', ref: 'main', commitSha: 'abc', harness: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor', vanilla: false };
  const v3 = build(main, 'v3');
  assert.equal(v3.agentEngine, 'v3');
  assert.equal(v3.installHarness, 'kiro-v3');
  assert.deepEqual(validateResult(v3), []);
  assert.equal(build(main, 'v2').installHarness, 'kiro-cli-v2');
  const vanilla = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', runtime: 'kiro-cli', agent: null, vanilla: true };
  assert.equal(build(vanilla, 'v3').installHarness, 'none');
});

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  fs.mkdirSync(path.join(bench, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(bench, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], arms: ['vanilla'], replicates: 1, parallel: 1 }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  write(path.join(repo, 'README'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  fs.mkdirSync(path.join(root, 'home'));
  return { root, bench, repo };
}
const prepareOnly = (s, args) => spawnSync('node', [BENCH, 'run', '--suite', 'lite', '--bench-dir', s.bench, '--repo-root', s.repo, '--cache', path.join(s.root, 'cache'), '--prepare-only', ...args], {
  encoding: 'utf8', env: { ...process.env, HOME: path.join(s.root, 'home') },
});

test('run accepts --agent-engine v3, rejects an unknown engine, and rejects the flag for opencode arms', () => {
  const s = setup();
  try {
    const ok = prepareOnly(s, ['--arms', 'vanilla', '--agent-engine', 'v3']);
    assert.equal(ok.status, 0, ok.stderr);
    const bad = prepareOnly(s, ['--arms', 'vanilla', '--agent-engine', 'v4']);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--agent-engine must be v2 or v3/);
    const oc = prepareOnly(s, ['--arms', 'oc-vanilla', '--agent-engine', 'v2']);
    assert.equal(oc.status, 1);
    assert.match(oc.stderr, /--agent-engine applies to kiro-cli arms only/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
