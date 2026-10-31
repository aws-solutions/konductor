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

test('the README documents the profiles, the ledger, the graded judge, the generator, the controls and the verdict', () => {
  const doc = read('README.md');
  for (const re of [/--profile quick\|detailed/, /credit-ledger\.jsonl/, /--mode graded/, /cap scenarios/, /cap controls/, /--verdict platform/, /calibration-sample\.json/, /orderDisagreement/, /exit code 3/]) assert.match(doc, re);
  assert.doesNotMatch(doc, /More than 10 planned runs need `--budget-credits`/);
});

test('the playbook documents the scenario, controls and verdict steps and the optional cap', () => {
  const doc = read('CAP-PLAYBOOK.md');
  for (const s of [/cap scenarios --cap ID --dry-run/, /cap controls --out DIR/, /report --verdict platform/, /A cap is optional/, /references\/NAME\.md/]) assert.match(doc, s);
  assert.doesNotMatch(doc, /Always pass `--budget-credits`/);
});

test('the shipped profiles match what the README table says', () => {
  const q = JSON.parse(read('profiles/quick.json'));
  const d = JSON.parse(read('profiles/detailed.json'));
  const doc = read('README.md');
  assert.match(doc, /\| replicates per cell \| 1 to 3 \(default 2\)/);
  assert.match(doc, /at least 5 \(default 5\)/);
  assert.deepEqual([q.replicates.min, q.replicates.max, q.replicates.default], [1, 3, 2]);
  assert.deepEqual([d.replicates.min, d.replicates.default], [5, 5]);
});
