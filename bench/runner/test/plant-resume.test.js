// SPDX-License-Identifier: Apache-2.0
'use strict';

// DEBT D-19 closure: a plant trial killed mid-run, then `bench run --resume` into the same --out, then plant-report.
// Both runs are whole `bench run` commands in child processes (the first is killed with SIGTERM while the agent holds),
// on the toy release with a fake Claude Code and a real gateway, --isolate none. No model, no credits. The gateway loads
// the toy release's Cedar policy, so it needs a Python with cedarpy (BENCH_ARM_PYTHON or <repo>/.venv).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const { makeFakePlantClaude } = require('./fake-plant-claude.js');
const { makeToyRelease } = require('../../physical/toy/toy-release.js');
const { cmdPlantReport } = require('../../report/plant.js');
const { validateResult } = require('../lib/result.js');
const { CC_CONFIG } = require('./plant-run-rig.js');

const { PYTHON, HAS_CEDAR } = require('./arm-python.js');
const TASK = 'toy-stop-line.v01';
const ARM = 'cc-plant-policy';
// A fake Claude Code takes its keys from the environment like the real one; these are made up and never used.
const FAKE_KEYS = { AWS_ACCESS_KEY_ID: 'AKIAFAKEPLANT0000000', AWS_SECRET_ACCESS_KEY: 'fake-plant-secret-0000000000', AWS_SESSION_TOKEN: 'fake-plant-token-000000000000' };
const CHILD = `
const { cmdRun } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'run-cmd.js'))});
cmdRun(JSON.parse(process.argv[1])).then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e.stack); process.exit(3); });
`;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Starts `bench run` with `opts` in a child; resolves `{child, exited, log}`. */
function benchRun(opts) {
  const child = spawn(process.execPath, ['-e', CHILD, JSON.stringify(opts)], { env: { ...process.env, ...FAKE_KEYS, TMPDIR: '/tmp' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = { text: '' };
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { log.text += d; });
  const exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  return { child, exited, log };
}

/** Removes `dir`, making the read-only release copies a killed run leaves writable first. */
function removeTree(dir) {
  spawnSync('chmod', ['-R', 'u+rwX', dir]);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('a plant cell killed mid-trial is redone by --resume, its attempt kept, and plant-report builds (D-19)', { skip: !HAS_CEDAR && 'no Python with cedarpy (set BENCH_ARM_PYTHON)', timeout: 180000 }, async (t) => {
  const root = tmp();
  t.after(() => removeTree(root));
  const toy = makeToyRelease(root);
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const calls = [{ tool: 'get_state', args: {} }, { tool: 'stop', args: {} }];
  const bin = makeFakePlantClaude(path.join(root, 'tools'), { dir: probe, calls, hold: true });
  const out = path.join(root, 'out');
  const opts = {
    suite: 'lite', arms: ARM, tasks: TASK, 'extra-tasks': path.join(toy.dir, 'tasks'), 'plant-release': toy.dir, 'plant-release-sha256': toy.sha256,
    'claude-bin': bin, model: CC_CONFIG.model, 'plant-python': PYTHON, isolate: 'none', 'allow-unisolated': true, parallel: '1', replicates: '1', out,
  };

  const first = benchRun(opts);
  const deadline = Date.now() + 90000;
  while (!fs.existsSync(path.join(probe, 'held.json')) && first.child.exitCode === null && Date.now() < deadline) await sleep(100);
  assert.ok(fs.existsSync(path.join(probe, 'held.json')), `the agent never reached its hold:\n${first.log.text}`);
  first.child.kill('SIGTERM');
  assert.equal((await first.exited).code, 143, first.log.text);
  const cell = path.join(out, ARM, TASK, '1');
  assert.ok(fs.existsSync(path.join(cell, 'plant', 'gateway.jsonl')), 'the killed trial left its plant logs');
  assert.ok(!fs.existsSync(path.join(cell, 'result.json')), 'and no result');

  const cfgFile = path.join(path.dirname(bin), 'fake-plant-claude.config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ dir: probe, calls }));
  const second = benchRun({ ...opts, resume: true });
  assert.equal((await second.exited).code, 0, second.log.text);
  const result = JSON.parse(fs.readFileSync(path.join(cell, 'result.json'), 'utf8'));
  assert.deepEqual(validateResult(result), []);
  assert.equal(result.resumedFrom, '1.resumed-1');
  assert.equal(result.plant.runState, 'complete');
  assert.ok(fs.existsSync(path.join(out, ARM, TASK, '1.resumed-1', 'plant', 'gateway.jsonl')), 'the killed attempt is kept');

  const reportDir = path.join(root, 'report');
  const [log, err] = [console.log, console.error];
  let said = '';
  console.log = () => {};
  console.error = (m) => { said += m; };
  const before = process.exitCode;
  try { cmdPlantReport({ run: out, release: toy.dir, out: reportDir }); } finally { [console.log, console.error] = [log, err]; }
  const code = process.exitCode ?? 0;
  process.exitCode = before;
  assert.equal(code, 0, said);
  assert.match(fs.readFileSync(path.join(reportDir, 'plant-report.md'), 'utf8'), /TOY release/);
});
