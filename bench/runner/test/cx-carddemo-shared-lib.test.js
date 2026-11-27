// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-288: the cx-carddemo-port and cx-carddemo-batchday hidden suites share one helper, bench/scenarios/lib/hidden/carddemo-cd.js,
// named in each task's .bench-lib.json. Neither task commits its own hidden/lib/cd.js, so a helper fix is made once.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sharedHelpers } = require('../lib/hidden-lib.js');

const HIDDEN = path.join(__dirname, '..', '..', 'complex', 'hidden');
const TASKS = ['cx-carddemo-port', 'cx-carddemo-batchday'];

for (const task of TASKS) {
  test(`${task}: hidden/lib/cd.js comes from the shared carddemo-cd.js helper, not a copy`, () => {
    const dir = path.join(HIDDEN, task);
    assert.ok(!fs.existsSync(path.join(dir, 'hidden', 'lib', 'cd.js')), 'the task still commits its own cd.js');
    const dests = sharedHelpers(dir).map(([dest, src]) => [dest, path.basename(src)]);
    assert.deepEqual(dests, [['hidden/lib/cd.js', 'carddemo-cd.js']]);
  });
}

test('the shared carddemo-cd.js exports what both suites read', () => {
  const cd = require('../../scenarios/lib/hidden/carddemo-cd.js');
  for (const name of ['pad', 'blankKeptFiller', 'run', 'postInputs', 'interestInputs', 'assertRefused']) assert.equal(typeof cd[name], 'function', name);
});
