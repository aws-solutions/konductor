// SPDX-License-Identifier: Apache-2.0
'use strict';

// STANDARD study 2026-11-26: an agent's own test that waits forever on the original code (here a promise nobody
// resolves) made the t8-bug-retry-storm regress proof run into the 60 s check limit, so the whole hidden suite read
// "did not parse" and the 10 behaviour tests that passed were lost. A hang on the original code is a failing suite:
// the hidden check must still count every test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck } = require('../../../runner/lib/check-matcher.js');

const T8 = path.join(__dirname, '..');
const TASK = 't8-bug-retry-storm';
const HANGING_TEST = `'use strict';
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared-http-client.js'), 'utf8');
test('waits for a promise nobody resolves while the bug is present', async () => {
  if (/backoffMs\\(attempt, response\\) \\/ 1000/.test(src)) await new Promise(() => {});
});
`;

test('an agent suite that hangs on the original code still scores every hidden test', () => {
  const task = JSON.parse(fs.readFileSync(path.join(T8, `${TASK}.json`), 'utf8'));
  const check = task.checks.find((c) => c.type === 'tests');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't8-hang-'));
  try {
    fs.cpSync(path.join(T8, 'fixtures', TASK), ws, { recursive: true });
    fs.cpSync(path.join(T8, 'solutions', TASK, 'src'), path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'test', 'hang.test.js'), HANGING_TEST);
    const r = evalCheck(ws, check, { hiddenDir: path.join(T8, 'hidden', TASK), testsTimeoutMs: 45000 });
    assert.equal(r.tests.unparsed, false, r.detail);
    assert.equal(r.tests.passed, r.tests.total, r.detail);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
