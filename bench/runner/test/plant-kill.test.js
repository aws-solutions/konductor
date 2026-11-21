// SPDX-License-Identifier: Apache-2.0
'use strict';

// A plant run killed mid-trial (SIGTERM while the agent holds) leaves no runner-private kplant-* dir (DEBT D-93). The
// child process runs one trial on the test rig (signed stub release, fake Kiro CLI, real gateway, --isolate none) under
// the runner's own signal handlers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { tmp } = require('./helpers.js');

const CHILD = `
const procs = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'procs.js'))});
const { rig, plantRun } = require(${JSON.stringify(path.join(__dirname, 'plant-run-rig.js'))});
(async () => {
  procs.installSignalHandlers({ flush: () => {} });
  const r = rig();
  const p = await plantRun(r, { hold: true, calls: [] });
  process.stdout.write(JSON.stringify({ probe: r.probe }) + '\\n');
  await p.run();
})().catch((e) => { console.error(e.stack); process.exit(3); });
`;

// The killed child never ran the rig cleanup, so its release copy under the rig root is still read-only.
function removeTree(dir) {
  const open = (d) => { try { fs.chmodSync(d, 0o700); } catch { return; } for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) open(path.join(d, e.name)); };
  open(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

test('SIGTERM during a plant trial removes the runner-private dir with its read-only release copy', async (t) => {
  const tmpdir = tmp();
  t.after(() => removeTree(tmpdir));
  const child = spawn(process.execPath, ['-e', CHILD], { env: { ...process.env, TMPDIR: tmpdir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  const deadline = Date.now() + 90000;
  let probe = null;
  while (Date.now() < deadline) {
    probe ??= out.includes('\n') ? JSON.parse(out.split('\n')[0]).probe : null;
    if (probe && fs.existsSync(path.join(probe, 'held.json'))) break;
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  assert.ok(probe && fs.existsSync(path.join(probe, 'held.json')), `the agent never reached its hold: ${err}`);
  const kplant = () => fs.readdirSync(tmpdir).filter((n) => n.startsWith('kplant-'));
  assert.equal(kplant().length, 1, 'the trial made its private dir');
  child.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 143, err);
  assert.deepEqual(kplant(), [], 'no kplant-* dir is left after the kill');
});
