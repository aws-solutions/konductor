// SPDX-License-Identifier: Apache-2.0
// bench/core/load-run.js reads a run with the harness rule and rubric policy it is given (FW-10), and the old
// report/load.js path still gives the same readers. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeRunLoader } = require('../../core/load-run.js');

function runDir(results) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-load-run-'));
  for (const [arm, harness] of results) {
    fs.mkdirSync(path.join(dir, arm, 't1', '1'), { recursive: true });
    fs.writeFileSync(path.join(dir, arm, 't1', '1', 'result.json'), JSON.stringify({ harness }));
  }
  return dir;
}

test('the loader uses the harness rule it is given', (t) => {
  const dir = runDir([['a', 'x'], ['b', 'y']]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const same = makeRunLoader({ harnessOf: () => 'one', rubricPolicy: 'p' });
  assert.equal(same.loadRun(dir).harness, 'one');
  const byField = makeRunLoader({ harnessOf: (r) => r.harness, rubricPolicy: 'p' });
  assert.throws(() => byField.loadRun(dir), /mixes harnesses \(x, y\)/);
});

test('the loader refuses to be built without both facts', () => {
  assert.throws(() => makeRunLoader({ rubricPolicy: 'p' }), /needs harnessOf and rubricPolicy/);
  assert.throws(() => makeRunLoader({ harnessOf: () => 'k' }), /needs harnessOf and rubricPolicy/);
});

test('report/load.js still gives the runner-bound readers', () => {
  assert.equal(require('../../report/load.js'), require('../lib/load-run.js'));
  assert.equal(typeof require('../../report/load.js').loadRuns, 'function');
});
