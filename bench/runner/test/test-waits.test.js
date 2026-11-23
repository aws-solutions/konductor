// SPDX-License-Identifier: Apache-2.0
'use strict';

// Class check for DEBT D-96 (flaky under load): a test waits for an event with helpers.js waitFor (poll with a deadline
// sized for a loaded host), not with its own copy of that loop or a bounded counter of fixed sleeps, whose deadline is
// whatever the copy happened to pick (3 s, 10 s, 20 s were found).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const OWN_LOOP = /async function (?:waitFor|until)\b|function untilHeld\b|for \(let i = 0; i < \d+ && [^;]+; i\+\+\) await new Promise/;

test('no test file has its own wait loop: they use helpers.js waitFor', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'helpers.js' && f !== 'test-waits.test.js');
  const found = files.filter((f) => OWN_LOOP.test(fs.readFileSync(path.join(DIR, f), 'utf8')));
  assert.deepEqual(found, [], 'require waitFor from ./helpers.js');
});
