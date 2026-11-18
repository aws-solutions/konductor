// SPDX-License-Identifier: Apache-2.0
// Tests for the file set-aside helpers (scripts/bench/lib/supersede.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const helpers = require('./helpers');
const {
  SUPERSEDED_MARK,
  fileTime,
  setAside,
  supersede,
} = require('../../../scripts/bench/lib/supersede');

const NOW = Date.parse('2030-01-02T03:04:05.678Z');
const now = () => NOW;
const STAMP = '2030-01-02T03-04-05-678Z';

test('fileTime turns ":" and "." of an ISO time into "-"', () => {
  assert.equal(fileTime(now), STAMP);
});

test('setAside renames a file to <file><mark><time> and keeps its content', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'raw.jsonl');
    fs.writeFileSync(file, 'evidence');
    const target = setAside(file, '.rejected-', now);
    assert.equal(target, `${file}.rejected-${STAMP}`);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'evidence');
  });
});

test('setAside never overwrites a file kept under the same name, in the same millisecond', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'raw.jsonl');
    const kept = [];
    for (const text of ['one', 'two', 'three']) {
      fs.writeFileSync(file, text);
      kept.push(setAside(file, SUPERSEDED_MARK, now));
    }
    assert.deepEqual(kept, [
      `${file}.superseded-${STAMP}`,
      `${file}.superseded-${STAMP}-2`,
      `${file}.superseded-${STAMP}-3`,
    ]);
    assert.deepEqual(
      kept.map((target) => fs.readFileSync(target, 'utf8')),
      ['one', 'two', 'three'],
    );
  });
});

test('supersede sets a file aside as superseded and answers null when there is no file', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'answer.json');
    assert.equal(supersede(file, now), null);
    fs.writeFileSync(file, 'old');
    const target = supersede(file, now);
    assert.equal(target, `${file}.superseded-${STAMP}`);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    assert.equal(fs.existsSync(file), false);
  });
});
