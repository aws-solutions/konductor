// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gradeFindings, gradeFindingsFile, readFindingsBlock } = require('../lib/findings-key.js');
const { tmp, write } = require('./helpers.js');

const KEY = [
  { id: 'k1', location: ['§3', 'rate limit'], severity: 'high', fix: ['token bucket', 'limit'] },
  { id: 'k2', location: '§5', severity: 'critical', fix: ['idempotency', 'dedupe'] },
  { id: 'k3', location: '§7', severity: 'low', fix: ['alert'] },
  { id: 'k4', location: '§9', severity: 'medium', fix: ['rollback', 'canary'], fixMin: 2 },
];
const REFERENCE = [
  { location: '§3 rate limiting', severity: 'high', fix: 'add a token bucket per client' },
  { location: '§5.1 payments', severity: 'critical', fix: 'use an idempotency key' },
  { location: '§7', severity: 'low', text: 'no alert on queue depth' },
  { location: '§9 rollout', severity: 'medium', fix: 'canary first, with a rollback plan' },
];
const FENCE = '```';
const block = (items) => `Review\n\n${FENCE}json\n${JSON.stringify(items)}\n${FENCE}\n`;

test('a reference list scores 1 with full recall, severity, fix and precision', () => {
  const g = gradeFindings(REFERENCE, KEY);
  assert.deepEqual([g.recall, g.severityAccuracy, g.fixAccuracy, g.precision, g.lengthTerm, g.score], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(g.missed, []);
});

test('a stub (empty list, no block, prose only) scores 0', () => {
  assert.equal(gradeFindings([], KEY).score, 0);
  assert.equal(gradeFindings(readFindingsBlock('The design looks fine.'), KEY).error, 'no findings block');
  assert.deepEqual(gradeFindings([], KEY).missed, ['k1', 'k2', 'k3', 'k4']);
});

test('an over-long list does not win: the same hits among 30 items score lower than among 6', () => {
  const noise = Array.from({ length: 26 }, (_, i) => ({ location: `§${20 + i}`, severity: 'low', fix: 'tidy' }));
  const long = gradeFindings([...REFERENCE, ...noise], KEY);
  const tight = gradeFindings([...REFERENCE, noise[0], noise[1]], KEY);
  assert.equal(long.recall, 1);
  assert.equal(tight.score, 1, 'up to 1.5 x the key size is free');
  assert.ok(long.score < 0.25, `long list score ${long.score}`);
  assert.ok(long.precision < 0.15);
});

test('severity one level off earns half, two levels off nothing; a wrong fix loses its quarter', () => {
  const r = gradeFindings([{ location: '§5', severity: 'high', fix: 'idempotency' }], [KEY[1]]);
  assert.equal(r.severityAccuracy, 0.5);
  assert.equal(r.score, 0.5 + 0.125 + 0.25);
  const far = gradeFindings([{ location: '§5', severity: 'nit', fix: 'idempotency' }], [KEY[1]]);
  assert.equal(far.severityAccuracy, 0);
  const noFix = gradeFindings([{ location: '§5', severity: 'critical', fix: 'be careful' }], [KEY[1]]);
  assert.equal(noFix.fixAccuracy, 0);
  assert.equal(noFix.score, 0.75);
});

test('fixMin needs several keywords, and a location must sit on a token edge', () => {
  assert.equal(gradeFindings([{ location: '§9', severity: 'medium', fix: 'canary only' }], [KEY[3]]).fixAccuracy, 0);
  assert.equal(gradeFindings([{ location: '§50', severity: 'critical', fix: 'idempotency' }], [KEY[1]]).recall, 0);
});

test('one reported item matches one key item, and a repeat of a finding counts as spurious', () => {
  const g = gradeFindings([REFERENCE[0], REFERENCE[0]], [KEY[0]]);
  assert.equal(g.recall, 1);
  assert.equal(g.precision, 0.5);
});

test('two findings at nearby lines match their own key items whatever order they are listed in', () => {
  const key = [
    { id: 'a', location: ['x.js:10', 'x.js:11', 'x.js:12'], severity: 'critical', fix: ['lock'] },
    { id: 'b', location: ['x.js:11', 'x.js:12', 'x.js:13'], severity: 'low', fix: ['rename'] },
  ];
  const a = { location: 'x.js:11', severity: 'critical', fix: 'add a lock' };
  const b = { location: 'x.js:12', severity: 'low', fix: 'rename it' };
  assert.equal(gradeFindings([a, b], key).score, 1);
  assert.equal(gradeFindings([b, a], key).score, 1);
});

test('fixRequired: a generic remark at the right place does not find the item', () => {
  const key = [{ id: 'a', location: ['3.2'], severity: 'high', fix: ['dead letter'], fixRequired: true }];
  assert.equal(gradeFindings([{ location: '3.2', severity: 'high', issue: 'needs more tests', fix: 'add tests' }], key).recall, 0);
  assert.equal(gradeFindings([{ location: '3.2', severity: 'high', issue: 'no dead letter path', fix: 'cap retries' }], key).recall, 1);
});

test('readFindingsBlock takes a plain array or {findings}, skips bad blocks, and ignores other fences', () => {
  assert.equal(readFindingsBlock(`${FENCE}json\n{bad\n${FENCE}`), null);
  assert.equal(readFindingsBlock(`${FENCE}sh\nls\n${FENCE}\n${block(REFERENCE)}`).length, 4);
  assert.deepEqual(readFindingsBlock(`${FENCE}json\n{"findings":[{"location":"§1"}]}\n${FENCE}`), [{ location: '§1' }]);
  assert.equal(readFindingsBlock(`${FENCE}json\n[1,2]\n${FENCE}`), null);
});

test('gradeFindingsFile reads the output file and never throws', () => {
  const root = tmp();
  try {
    write(path.join(root, 'review.md'), block(REFERENCE));
    assert.equal(gradeFindingsFile(path.join(root, 'review.md'), KEY).score, 1);
    assert.equal(gradeFindingsFile(path.join(root, 'none.md'), KEY).error, 'output file missing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fix keywords match the same words written as code or out of order, not a generic remark', () => {
  const key = [{ id: 'k1', location: 'svc.js:11', severity: 'critical', fix: ['tenant id', 'remove token'], fixRequired: true }];
  const hit = (fix) => gradeFindings([{ location: 'svc.js:11', severity: 'critical', issue: 'cache key', fix }], key).matched;
  assert.deepEqual(hit('Build the key from tenantId and listId'), ['k1']);
  assert.deepEqual(hit('Remove the token field from the 401 body'), ['k1']);
  assert.deepEqual(hit('add tests and handle errors'), []);
});

test('pairing finds the most pairs: an earlier item does not take the only finding a later item can use', () => {
  const key = [
    { id: 'a', location: ['f.js:20', 'f.js:21'], severity: 'high', fix: ['offset'], fixRequired: true },
    { id: 'b', location: ['f.js:21'], severity: 'medium', fix: ['offset'], fixRequired: true },
  ];
  const reported = [
    // The f.js:21 finding fits item a best (same severity), but it is the only one item b can use.
    { location: 'f.js:21', severity: 'high', issue: 'drops the offset parameter', fix: 'keep offset' },
    { location: 'f.js:20', severity: 'medium', issue: 'repeats the last row', fix: 'advance the offset' },
  ];
  assert.deepEqual(gradeFindings(reported, key).matched.sort(), ['a', 'b']);
});
