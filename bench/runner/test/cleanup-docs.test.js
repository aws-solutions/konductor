// SPDX-License-Identifier: Apache-2.0
'use strict';

// The cleanup section of the README and the runbook line say what the code does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { KINDS } = require('../lib/owned.js');
const gc = require('../lib/gc.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('the README has a Cleaning up section that names every kind, the defaults and the protect file', () => {
  const doc = read('README.md');
  const at = doc.indexOf('\n## Cleaning up\n');
  assert.ok(at > 0, 'no "Cleaning up" heading');
  const section = doc.slice(at, doc.indexOf('\n## ', at + 5));
  for (const k of KINDS) assert.ok(section.includes(`\`${k}\``), `kind ${k} is not named`);
  for (const k of gc.DEFAULT_KINDS) assert.ok(section.includes(`\`${k}\``), `default kind ${k} is not named`);
  for (const phrase of ['.bench-owner.json', '.bench-gc.log', 'bench-gc-protect.txt', '--adopt', '--keep-last', '--older-than', '--remove-originals', '--restore', 'archive-manifest.json', 'ARCHIVE.md', 'protect: false']) {
    assert.ok(section.includes(phrase), `${phrase} is not mentioned`);
  }
  assert.ok(section.includes('default `7d`'), 'the default age is not stated');
  assert.equal(gc.DEFAULT_OLDER_THAN_MS, 7 * 86400000);
  assert.ok(doc.includes('[Cleaning up](#cleaning-up)'), 'the jump list does not link the section');
  assert.match(doc, /\| What is taking my disk[^\n]*`gc`[^\n]*`archive --run/, 'the question table has no gc row');
});

test('the question-table row has the same number of cells as the rows around it', () => {
  const rows = read('README.md').split('\n').filter((l) => l.startsWith('| ') && l.includes('`gc`'));
  assert.equal(rows.length, 1);
  const cells = (l) => l.split(/(?<!\\)\|/).length;
  const neighbour = read('README.md').split('\n').find((l) => l.startsWith('| Does the answer depend on the harness'));
  assert.equal(cells(rows[0]), cells(neighbour));
});

test('the runbook points at gc, archive and the protect file', () => {
  const doc = read('RUNBOOK.md');
  assert.match(doc, /bench\.js gc/);
  assert.match(doc, /archive --run DIR/);
  assert.match(doc, /bench-gc-protect\.txt/);
});

test('the new docs and code carry no em dash, en dash or curly quote', () => {
  const bad = /[\u2013\u2014\u2018\u2019\u201C\u201D]/;
  const section = read('README.md');
  const at = section.indexOf('\n## Cleaning up\n');
  assert.doesNotMatch(section.slice(at, section.indexOf('\n## ', at + 5)), bad);
  for (const f of ['runner/lib/owned.js', 'runner/lib/gc.js', 'runner/lib/archive.js', 'runner/lib/cleanup-cmd.js']) assert.doesNotMatch(read(f), bad, f);
});
