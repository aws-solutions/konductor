// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const rt = require('../lib/realtests.js');

const PYTEST_OUT = [
  '============================= test session starts ==============================',
  'collecting ... collected 6 items',
  '',
  'tests/test_a.py::test_one PASSED                                         [ 16%]',
  'tests/test_a.py::test_two FAILED                                         [ 33%]',
  'tests/test_a.py::test_param[a b-1] PASSED                                [ 50%]',
  'tests/test_b.py::test_skip SKIPPED (windows only)                        [ 66%]',
  'tests/test_b.py::test_err ERROR                                          [ 83%]',
  'tests/test_b.py::test_xf XFAIL                                           [100%]',
  '',
  '=================================== FAILURES ===================================',
  'FAILED tests/test_a.py::test_two - AssertionError: assert 1 == 2',
  'ERROR tests/test_b.py::test_err - RuntimeError: boom',
].join('\n');

test('pytest output: statuses by node id, summary lines are ignored', () => {
  const r = rt.parsePytest(PYTEST_OUT);
  assert.equal(r.get('tests/test_a.py::test_one'), 'pass');
  assert.equal(r.get('tests/test_a.py::test_two'), 'fail');
  assert.equal(r.get('tests/test_a.py::test_param[a b-1]'), 'pass');
  assert.equal(r.get('tests/test_b.py::test_skip'), 'fail');
  assert.equal(r.get('tests/test_b.py::test_err'), 'fail');
  assert.equal(r.get('tests/test_b.py::test_xf'), 'fail');
  assert.equal(r.size, 6);
});

test('pytest output: a repeated id passes only when every occurrence passes', () => {
  const r = rt.parsePytest('t.py::a PASSED [ 50%]\nt.py::a FAILED [100%]\n');
  assert.equal(r.get('t.py::a'), 'fail');
});

test('node-test lines: only @@T lines count, duplicates combine', () => {
  const out = [
    'noise from a test',
    `@@T ${JSON.stringify({ file: 'tests/a.test.js', path: ['suite', 'works'], status: 'pass' })}`,
    `@@T ${JSON.stringify({ file: 'tests/a.test.js', path: ['suite', 'breaks'], status: 'fail' })}`,
    `@@T ${JSON.stringify({ file: 'tests/b.test.js', path: ['top'], status: 'pass' })}`,
    `@@T ${JSON.stringify({ file: 'tests/b.test.js', path: ['top'], status: 'fail' })}`,
    '@@T {not json',
  ].join('\n');
  const r = rt.parseNodeTest(out);
  assert.equal(r.get('tests/a.test.js::suite > works'), 'pass');
  assert.equal(r.get('tests/a.test.js::suite > breaks'), 'fail');
  assert.equal(r.get('tests/b.test.js::top'), 'fail');
  assert.equal(r.size, 3);
});

test('scoreReal: counts listed ids that passed; missing ids count as failed', () => {
  const results = new Map([['a', 'pass'], ['b', 'fail'], ['c', 'pass']]);
  const s = rt.scoreReal({ results, failToPass: ['a', 'b', 'x'], passToPass: ['c'] });
  assert.deepEqual(s, { failToPass: { passed: 1, total: 3 }, passToPass: { passed: 1, total: 1 } });
});

test('parseResults picks the parser by runner and rejects unknown runners', () => {
  assert.equal(rt.parseResults('pytest', PYTEST_OUT).size, 6);
  assert.throws(() => rt.parseResults('mocha', ''), /unknown runner/);
});

test('buildCommand fills {reporter}', () => {
  const cmd = rt.buildCommand('node --test --test-reporter={reporter} tests/', '/x/rep.js');
  assert.equal(cmd, "node --test --test-reporter='/x/rep.js' tests/");
});

test('node reporter: emits one line per finished test with the describe path, skips suite records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  try {
    fs.writeFileSync(path.join(dir, 'x.test.js'), [
      "const { test, describe } = require('node:test');",
      "const assert = require('node:assert');",
      "describe('outer', () => {",
      "  describe('inner', () => { test('good', () => {}); });",
      "  test('bad', () => { assert.equal(1, 2); });",
      '});',
      "test('top', () => {});",
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--test', `--test-reporter=${rt.REPORTER_PATH}`, 'x.test.js'], { cwd: dir, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    const got = rt.parseNodeTest(r.stdout);
    assert.equal(got.get('x.test.js::outer > inner > good'), 'pass');
    assert.equal(got.get('x.test.js::outer > bad'), 'fail');
    assert.equal(got.get('x.test.js::top'), 'pass');
    assert.equal(got.size, 3, r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
