// SPDX-License-Identifier: Apache-2.0
'use strict';

// The README and playbook were checked by running their free commands; these tests keep the corrected statements true.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SUITE_NAMES } = require('../lib/tasks.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('the README lists every suite name that --suite accepts', () => {
  const line = read('README.md').split('\n').find((l) => l.startsWith('`--suite '));
  assert.ok(line, 'a line starting with --suite');
  for (const name of SUITE_NAMES) assert.ok(line.includes(name), `${name} missing from: ${line}`);
});

test('the README and playbook say cap plan needs --tasks when the registry links no lift task', () => {
  for (const f of ['README.md', 'CAP-PLAYBOOK.md']) assert.match(read(f), /pass `--tasks id,id` when the registry links no lift task/, f);
});

test('the README names the files each report command writes', () => {
  const doc = read('README.md');
  assert.match(doc, /prune-report\.md/);
  assert.match(doc, /contrast\.md/);
  assert.match(doc, /report\.md, report\.html, report\.json/);
});
