// SPDX-License-Identifier: Apache-2.0
'use strict';

// DEBT D-6: bench/scripts/host-bound-tests.sh runs the tests the dev host skips (they need user namespaces) as one
// command on a host that has them. Free: a stub `unshare` and a stub `node` stand in, so no sandbox starts here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');

const BENCH = path.join(__dirname, '..', '..');
const SCRIPT = path.join(BENCH, 'scripts', 'host-bound-tests.sh');

/** A folder with an executable `name` that runs `body` under sh. */
function stub(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

/** Runs the script with a stub unshare (`unshareOk`) and a stub node that prints `tap` and exits `nodeCode`. */
function runScript({ unshareOk = true, tap = '', nodeCode = 0, args = [] }) {
  const dir = mkScratch('hbt-');
  try {
    const unshare = stub(dir, 'unshare', unshareOk ? 'exit 0' : 'echo "unshare: unshare failed: Operation not permitted" >&2; exit 1');
    fs.writeFileSync(path.join(dir, 'tap.txt'), tap);
    const node = stub(dir, 'node', `cat "${path.join(dir, 'tap.txt')}"; echo "$@" > "${path.join(dir, 'node-args.txt')}"; exit ${nodeCode}`);
    const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, HBT_UNSHARE: unshare, HBT_NODE: node } });
    const nodeArgs = fs.existsSync(path.join(dir, 'node-args.txt')) ? fs.readFileSync(path.join(dir, 'node-args.txt'), 'utf8') : null;
    return { ...r, nodeArgs };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const summary = (pass, fail, skipped) => `# tests ${pass + fail + skipped}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n`;

test('--list names the eight test files of D-6, and every one exists', () => {
  const r = runScript({ args: ['--list'] });
  assert.equal(r.status, 0, r.stderr);
  const files = r.stdout.trim().split('\n');
  assert.equal(files.length, 8);
  for (const f of ['plant-walls.test.js', 'isolate.test.js', 'judge-opencode-read.test.js', 'resume.test.js']) assert.ok(files.includes(f), f);
  for (const f of files) assert.ok(fs.existsSync(path.join(BENCH, 'runner', 'test', f)), f);
  assert.equal(r.nodeArgs, null, '--list runs no test');
});

test('a host that refuses user namespaces stops before any test runs, and says D-6 and where to run it', () => {
  const r = runScript({ unshareOk: false });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP: this host refuses user namespaces/);
  assert.match(r.stderr, /D-6/);
  assert.equal(r.nodeArgs, null, 'no test ran');
});

test('all pass and none skipped for the sandbox: exit 0 and the counts', () => {
  const r = runScript({ tap: `ok 1 - a\nok 2 - b # SKIP set BENCH_STRANDS_PYTHON\n${summary(1, 0, 1)}` });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /host-bound tests: pass 1, fail 0, skipped 1, 0 skipped for the sandbox/);
  assert.match(r.nodeArgs, /--test/);
  assert.match(r.nodeArgs, /plant-walls\.test\.js/);
});

test('a test skipped for user namespaces on a host that has them is a failure, and is listed with its reason', () => {
  const tap = `ok 5 - a read call under real OS isolation # SKIP user namespaces are blocked on this host\n${summary(3, 0, 1)}`;
  const r = runScript({ tap });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /skipped for the sandbox: a read call under real OS isolation/);
  assert.match(r.stderr, /FAIL: 1 test/);
});

test('a failing test fails the run, and node exit code is not hidden', () => {
  const r = runScript({ tap: `not ok 2 - b\n${summary(1, 1, 0)}`, nodeCode: 1 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /fail 1/);
});

test('node gives no summary: the run fails rather than reporting success', () => {
  const r = runScript({ tap: 'garbage\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no TAP summary/);
});
