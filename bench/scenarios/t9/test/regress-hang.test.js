// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-281 (same shape as D-280 in t8): an agent's own test that waits forever on the original code would keep the t9
// regress proof running to its 60 s limit, which is also the whole `tests` check limit, so the hidden suite would read
// "did not parse" and every behaviour test that passed would be lost. A hang on the original code is a failing suite:
// the hidden check must still count every test. Needs the shared Playwright install for the browser tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck } = require('../../../runner/lib/check-matcher.js');

const T9 = path.join(__dirname, '..');

// Each task with the source file to read, a pattern that matches only the original (buggy) code, and whether its
// package.json makes test files ES modules.
const TASKS = [
  { id: 't9-browser-tab-regression', file: 'src/router.js', bug: String.raw`^\s*history\.pushState\(`, esm: true },
  { id: 't9-bug-tabs-focus', file: 'src/roving.js', bug: String.raw`items\.length \? Math\.min\(Math\.max\(preferredIndex, 0\)`, esm: false },
];

// A test that never ends while the bug is present. The interval keeps the event loop alive: a bare pending promise
// would let node:test cancel the test at once, which is a quick failure, not a hang.
const hangingTest = ({ file, bug, esm }) => `${esm
  ? `import test from 'node:test';
import fs from 'node:fs';
const src = fs.readFileSync(new URL(${JSON.stringify(`../${file}`)}, import.meta.url), 'utf8');`
  : `'use strict';
const test = require('node:test');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', ${JSON.stringify(file)}), 'utf8');`}
test('waits forever while the bug is present', async () => {
  if (new RegExp(${JSON.stringify(bug)}, 'm').test(src)) await new Promise(() => setInterval(() => {}, 1000));
});
`;

for (const t of TASKS) {
  test(`${t.id}: an agent suite that hangs on the original code still scores every hidden test`, () => {
    const task = JSON.parse(fs.readFileSync(path.join(T9, `${t.id}.json`), 'utf8'));
    const check = task.checks.find((c) => c.type === 'tests');
    const original = fs.readFileSync(path.join(T9, 'hidden', t.id, 'regress-kit', 'original', t.file), 'utf8');
    const fixed = fs.readFileSync(path.join(T9, 'solutions', t.id, t.file), 'utf8');
    assert.match(original, new RegExp(t.bug, 'm'), 'the bug pattern must match the original code');
    assert.doesNotMatch(fixed, new RegExp(t.bug, 'm'), 'the bug pattern must not match the fixed code');
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't9-hang-'));
    try {
      fs.cpSync(path.join(T9, 'fixtures', t.id), ws, { recursive: true });
      fs.cpSync(path.join(T9, 'solutions', t.id), ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'test', 'hang.test.js'), hangingTest(t));
      // `node --test test/` runs only test/index.js, which requires each test file by name.
      const index = path.join(ws, 'test', 'index.js');
      if (fs.existsSync(index)) fs.appendFileSync(index, "require('./hang.test.js');\n");
      const r = evalCheck(ws, check, { hiddenDir: path.join(T9, 'hidden', t.id), testsTimeoutMs: 60000 });
      assert.equal(r.tests.unparsed, false, r.detail);
      assert.equal(r.tests.passed, r.tests.total, r.detail);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
}
