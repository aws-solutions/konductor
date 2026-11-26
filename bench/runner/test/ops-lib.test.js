// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/ops/lib.sh holds the say, stop and fail helpers the ops scripts had copied (BACKLOG B-005). These tests pin what
// each helper prints and how it exits, that no ops script keeps its own copy of a helper's exact line, and that each
// script that sources the library names a path that exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OPS = path.join(__dirname, '..', '..', 'ops');
const LIB = path.join(OPS, 'lib.sh');
const SOURCE_RE = /^\. "\$\(dirname "\$0"\)\/((?:\.\.\/)+)lib\.sh"/m;

/** Every .sh file under bench/ops except the library itself, relative to bench/ops. */
function opsScripts() {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(OPS, rel), { withFileTypes: true })) {
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (r.endsWith('.sh') && r !== 'lib.sh') out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/** Runs `body` in sh after sourcing lib.sh. */
const sh = (body) => spawnSync('sh', ['-c', `. "${LIB}"; ${body}`], { encoding: 'utf8' });

test('lib.sh say prints a UTC time stamp; stop says STOP and exits 1; fail prints FAIL and exits 1 (B-005)', () => {
  const said = sh('say hello world');
  assert.equal(said.status, 0, said.stderr);
  assert.match(said.stdout, /^\[\d\d:\d\d\] hello world\n$/);
  const stopped = sh('stop no room; echo after');
  assert.equal(stopped.status, 1);
  assert.match(stopped.stdout, /^\[\d\d:\d\d\] STOP: no room\n$/);
  const failed = sh('fail case 2; echo after');
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, 'FAIL: case 2\n');
});

test('no ops script keeps a copy of a lib.sh helper line, and each one that sources lib.sh names a path that exists (B-005)', () => {
  const helpers = fs.readFileSync(LIB, 'utf8').split('\n').filter((l) => /^(say|stop|fail)\(\) \{/.test(l));
  assert.equal(helpers.length, 3, 'lib.sh defines say, stop and fail on one line each');
  const copies = [];
  const missing = [];
  let sourcing = 0;
  for (const rel of opsScripts()) {
    const text = fs.readFileSync(path.join(OPS, rel), 'utf8');
    const lines = new Set(text.split('\n'));
    for (const h of helpers) if (lines.has(h)) copies.push(`${rel}: ${h}`);
    const m = text.match(SOURCE_RE);
    if (!m) continue;
    sourcing++;
    if (path.resolve(OPS, path.dirname(rel), m[1], 'lib.sh') !== LIB) missing.push(rel);
  }
  assert.deepEqual(copies, []);
  assert.deepEqual(missing, []);
  assert.ok(sourcing >= 25, `only ${sourcing} ops scripts source lib.sh`);
});
