// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/pilot-wave.sh: the owner's one-line pilot wave command. Free checks only: usage, the wave table,
// and the refusals that fire before any spend (shim Python, an unpinned kiro-cli). The real prepare-only path needs a
// clean worktree and is run by hand (plan section 8a).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'pilot-wave.sh');
const run = (args, env = {}) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });

function stubDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-wave-'));
  const kiro = path.join(d, 'kiro-cli');
  fs.writeFileSync(kiro, '#!/bin/sh\n[ "$1" = --version ] && echo "kiro-cli 3.5.0"\nexit 0\n', { mode: 0o755 });
  const py = path.join(d, 'python3.12');
  fs.writeFileSync(py, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} -e "process.exit(0)"\n`, { mode: 0o755 });
  return { d, kiro, py };
}

test('pilot-wave.sh is valid bash and shellcheck-clean when shellcheck exists', () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0);
  const sc = spawnSync('shellcheck', ['--version']);
  if (sc.status === 0) {
    const r = spawnSync('shellcheck', ['-S', 'warning', SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
  }
});

test('usage errors exit 64 and --list prints all eight waves', () => {
  assert.equal(run([]).status, 64);
  assert.equal(run(['9']).status, 64);
  const l = run(['--list']);
  assert.equal(l.status, 0);
  for (const b of ['t4', 't5', 't6', 't3', 't1', 't2', 't7', 't8']) assert.match(l.stdout, new RegExp(` ${b} `));
});

test('a version-manager shim as PY312 stops before any run', () => {
  const s = stubDir();
  const shim = path.join(s.d, 'shims');
  fs.mkdirSync(shim);
  fs.copyFileSync(s.py, path.join(shim, 'python3.12'));
  fs.chmodSync(path.join(shim, 'python3.12'), 0o755);
  const r = run(['1', '--prepare-only'], { KBIN: s.kiro, PY312: path.join(shim, 'python3.12') });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP: PY312 is a version-manager shim/);
  fs.rmSync(s.d, { recursive: true, force: true });
});

test('a kiro-cli that is not the pinned copy stops, and the pin can be set for a stub', () => {
  const s = stubDir();
  const bad = run(['1', '--prepare-only'], { KBIN: s.kiro, PY312: s.py });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /STOP: (.*not the pinned kiro-cli copy|PY312 .* is not Python 3\.12|.*has local changes)/);
  const sha = execFileSync('sha256sum', [s.kiro], { encoding: 'utf8' }).split(' ')[0];
  const ok = run(['1', '--prepare-only'], { KBIN: s.kiro, PY312: s.py, KBIN_SHA256: sha });
  assert.doesNotMatch(ok.stderr, /not the pinned kiro-cli copy/);
  fs.rmSync(s.d, { recursive: true, force: true });
});
