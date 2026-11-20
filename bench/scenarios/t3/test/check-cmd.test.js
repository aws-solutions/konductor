// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-144: a solution/ folder (or file) the agent made must not stop a T3 tests check before its tests run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DIR = path.join(__dirname, '..');
const GUARD = '( [ -L solution ] || [ ! -e solution ] || mv solution .bench-agent-solution ) && ln -sfn . solution';
const testsChecks = () => fs.readdirSync(DIR).filter((f) => /^t3-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).checks.filter((c) => c.type === 'tests').map((c) => [f, c.cmd]));

test('every T3 tests check that links solution/ guards an existing one first', () => {
  for (const [file, cmd] of testsChecks()) {
    if (cmd.includes('ln -sfn . solution')) assert.ok(cmd.includes(GUARD), file);
  }
});

test('the guard moves an agent-made solution/ folder or file aside and links the root', () => {
  for (const kind of ['dir', 'file', 'none', 'link']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3-guard-'));
    try {
      if (kind === 'dir') fs.mkdirSync(path.join(dir, 'solution', 'docs'), { recursive: true });
      if (kind === 'file') fs.writeFileSync(path.join(dir, 'solution'), 'x');
      if (kind === 'link') fs.symlinkSync('.', path.join(dir, 'solution'));
      fs.writeFileSync(path.join(dir, 'marker'), '');
      execFileSync('sh', ['-c', `${GUARD} && test -f solution/marker`], { cwd: dir, stdio: 'ignore' });
      assert.equal(fs.readlinkSync(path.join(dir, 'solution')), '.', kind);
      assert.equal(fs.existsSync(path.join(dir, '.bench-agent-solution')), kind === 'dir' || kind === 'file', kind);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
