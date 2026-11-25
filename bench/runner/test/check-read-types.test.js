// SPDX-License-Identifier: Apache-2.0
'use strict';

// The five read-only check types live in one table of parts in the core (check-type plugin design, step 1).
// evalCheck still owns the path rules (inside the workspace, no symlink) and the three core types.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { READ_TYPES, CHECK_TYPES, evalCheck } = require('../lib/check-matcher.js');
const { mkScratch } = require('./scratch.js');

test('the table holds the five read-only types, frozen, and no core type', () => {
  assert.deepEqual(Object.keys(READ_TYPES), ['file_exists', 'contains', 'not_contains', 'min_matches', 'labelled_findings']);
  assert.ok(Object.isFrozen(READ_TYPES));
  for (const [id, part] of Object.entries(READ_TYPES)) {
    assert.ok(CHECK_TYPES.includes(id));
    assert.ok(Object.isFrozen(part));
    assert.equal(typeof part.evaluate, 'function');
  }
  for (const core of ['cmd', 'tests', 'fixture_unchanged']) assert.equal(Object.hasOwn(READ_TYPES, core), false);
});

test('CHECK_TYPES keeps its order, which the validator prints', () => {
  assert.deepEqual(CHECK_TYPES, ['file_exists', 'contains', 'not_contains', 'min_matches', 'fixture_unchanged', 'cmd', 'labelled_findings', 'tests']);
});

test('evalCheck gives each read-only type the same results through the table', () => {
  const dir = mkScratch('bench-read-types-');
  try {
    fs.writeFileSync(path.join(dir, 'a.md'), 'Finding one\nfinding two\n## F1: x\n');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.symlinkSync(path.join(dir, 'a.md'), path.join(dir, 'link.md'));
    const cases = [
      [{ type: 'file_exists', path: 'a.md' }, { passed: true, detail: 'present' }],
      [{ type: 'file_exists', path: 'sub' }, { passed: false, detail: 'missing' }],
      [{ type: 'contains', path: 'a.md', pattern: '^finding' }, { passed: true, detail: 'matched' }],
      [{ type: 'contains', path: 'nope.md', pattern: 'x' }, { passed: false, detail: 'file missing' }],
      [{ type: 'contains', path: 'a.md', pattern: '(' }, { passed: false, detail: 'invalid pattern: Invalid regular expression: /(/im: Unterminated group' }],
      [{ type: 'not_contains', path: 'a.md', pattern: 'zebra' }, { passed: true, detail: 'no match' }],
      [{ type: 'not_contains', path: 'a.md', pattern: 'two' }, { passed: false, detail: 'matched' }],
      [{ type: 'min_matches', path: 'a.md', pattern: 'finding', min: 2 }, { passed: true, detail: '2 matches, need 2' }],
      [{ type: 'min_matches', path: 'a.md', pattern: 'finding', min: 3 }, { passed: false, detail: '2 matches, need 3' }],
      [{ type: 'min_matches', path: 'sub', pattern: 'x', min: 1 }, { passed: false, detail: 'file missing' }],
      [{ type: 'labelled_findings', path: 'nope.md', labels: ['F'], min: 1 }, { passed: false, detail: 'file missing' }],
      [{ type: 'contains', path: 'link.md', pattern: 'x' }, { passed: false, detail: 'path is a symlink: link.md' }],
      [{ type: 'json_path', path: 'a.md' }, { passed: false, detail: 'unknown check type json_path' }],
    ];
    for (const [check, want] of cases) assert.deepEqual(evalCheck(dir, check), want, JSON.stringify(check));
    assert.throws(() => evalCheck(dir, { type: 'contains', path: '../x', pattern: 'x' }), /path escapes workspace/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a labelled_findings part counts what countLabelledFindings counts', () => {
  const dir = mkScratch('bench-read-types-');
  try {
    fs.writeFileSync(path.join(dir, 'r.md'), 'nothing labelled here\n');
    const r = evalCheck(dir, { type: 'labelled_findings', path: 'r.md', labels: ['SEC'], min: 1 });
    assert.equal(r.passed, false);
    assert.match(r.detail, /^0 labelled findings, need 1$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
