// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { addedLines, scanCopy, leakScan } = require('../../real/leakscan.js');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'leak-')));
const touch = (f, t = '') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

const PATCH = [
  'diff --git a/rich/console.py b/rich/console.py',
  'index 1..2 100644',
  '--- a/rich/console.py',
  '+++ b/rich/console.py',
  '@@ -1,3 +1,6 @@',
  ' import os',
  '+        if force_interactive is None:',
  '+            tty_interactive = self._environ.get("TTY_INTERACTIVE", None)',
  '+        x = 1',
  '-old line that was removed from the file',
  'diff --git a/tests/test_console.py b/tests/test_console.py',
  '--- a/tests/test_console.py',
  '+++ b/tests/test_console.py',
  '@@ -1 +1,2 @@',
  '+def test_a_very_distinctive_test_name_here(): pass',
  '',
].join('\n');

test('added lines are grouped per file, trimmed, and short or blank lines are dropped', () => {
  const m = addedLines(PATCH);
  assert.deepEqual([...m.keys()], ['rich/console.py', 'tests/test_console.py']);
  assert.deepEqual(m.get('rich/console.py'), ['if force_interactive is None:', 'tty_interactive = self._environ.get("TTY_INTERACTIVE", None)']);
});

test('a copy that holds the added lines scores 1, one that lacks them scores 0', () => {
  const dir = tmp();
  try {
    touch(path.join(dir, 'console.py'), 'a\n    if force_interactive is None:\n        tty_interactive = self._environ.get("TTY_INTERACTIVE", None)\n');
    const lines = addedLines(PATCH).get('rich/console.py');
    assert.deepEqual(scanCopy(dir, 'console.py', lines), { matched: 2, total: 2 });
    touch(path.join(dir, 'other.py'), 'nothing here\n');
    assert.deepEqual(scanCopy(dir, 'other.py', lines), { matched: 0, total: 2 });
    assert.deepEqual(scanCopy(dir, 'missing.py', lines), { matched: 0, total: 2 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a vendored copy holding the fix is reported unmaskable; a masked copy is reported as masked', () => {
  const home = tmp();
  try {
    const sp = path.join(home, '.local/share/mise/installs/python/3.12.2/lib/python3.12/site-packages');
    const fixed = 'x\n    if force_interactive is None:\n        tty_interactive = self._environ.get("TTY_INTERACTIVE", None)\n';
    touch(path.join(sp, 'rich/console.py'), fixed);
    touch(path.join(sp, 'pip/_vendor/rich/console.py'), fixed);
    const entry = { language: 'python', repo: { packageNames: ['rich'] }, test: { probeModules: ['rich'] }, fixFiles: ['rich/console.py'] };
    const found = leakScan(entry, PATCH, { home });
    const by = Object.fromEntries(found.map((f) => [path.relative(sp, f.copy), f]));
    assert.equal(by.rich.masked, true);
    assert.equal(by.rich.ratio, 1);
    assert.equal(by['pip/_vendor/rich'].masked, false);
    assert.equal(by['pip/_vendor/rich'].ratio, 1);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a copy without the fix scores 0', () => {
  const home = tmp();
  try {
    const sp = path.join(home, '.local/share/mise/installs/python/3.12.2/lib/python3.12/site-packages');
    touch(path.join(sp, 'rich/console.py'), 'old = 1\n');
    const entry = { language: 'python', repo: { packageNames: ['rich'] }, test: { probeModules: ['rich'] }, fixFiles: ['rich/console.py'] };
    assert.equal(leakScan(entry, PATCH, { home })[0].ratio, 0);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('added lines that already exist in the base version of the file are not counted as new', () => {
  const home = tmp();
  const base = tmp();
  try {
    const sp = path.join(home, '.local/share/mise/installs/python/3.12.2/lib/python3.12/site-packages');
    const fixed = 'x\n    if force_interactive is None:\n        tty_interactive = self._environ.get("TTY_INTERACTIVE", None)\n';
    touch(path.join(sp, 'rich/console.py'), fixed);
    const entry = { language: 'python', repo: { packageNames: ['rich'] }, test: { probeModules: ['rich'] }, fixFiles: ['rich/console.py'] };
    // The base already had the first added line; only the second is new, and the host copy holds it.
    touch(path.join(base, 'rich/console.py'), 'import os\n    if force_interactive is None:\n');
    const withBase = leakScan(entry, PATCH, { home, baseDir: base });
    assert.deepEqual([withBase[0].matched, withBase[0].total], [1, 1]);
    // A host copy that only repeats what the base had scores nothing.
    touch(path.join(sp, 'rich/console.py'), 'if force_interactive is None:\n');
    const old = leakScan(entry, PATCH, { home, baseDir: base });
    assert.deepEqual([old[0].matched, old[0].total], [0, 1]);
    assert.equal(leakScan(entry, PATCH, { home })[0].total, 2, 'without a base tree every added line counts');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(base, { recursive: true, force: true }); }
});
