'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function readBlock() {
  const text = fs.readFileSync('triage/2026-04-week-16.md', 'utf8');
  let found;
  for (const match of text.matchAll(/^```json\s*\n([\s\S]*?)^```\s*$/gim)) {
    try { found = JSON.parse(match[1]); } catch (_) { /* keep looking */ }
  }
  assert.ok(found, 'the triage document has a JSON block');
  return found;
}

function data() {
  const block = readBlock();
  assert.ok(Array.isArray(block.issues), 'issues is a list');
  return block;
}

function issue(block, id) {
  const found = block.issues.find((item) => item.id === id);
  assert.ok(found, `issue ${id} is present`);
  return found;
}

test('the block contains each queue id exactly once', () => {
  const block = data();
  const ids = block.issues.map((item) => item.id);
  assert.deepEqual(ids.slice().sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 401));
  assert.equal(new Set(ids).size, 24);
});

test('the export duplicate group points at its oldest report', () => {
  const block = data();
  assert.equal(issue(block, 401).duplicateOf, null);
  assert.equal(issue(block, 409).duplicateOf, 401);
  assert.equal(issue(block, 417).duplicateOf, 401);
  assert.equal(issue(block, 409).action, 'close');
  assert.equal(issue(block, 417).action, 'close');
});

test('the Safari duplicate group points at its oldest report', () => {
  const block = data();
  assert.equal(issue(block, 404).duplicateOf, null);
  assert.equal(issue(block, 420).duplicateOf, 404);
  assert.equal(issue(block, 420).action, 'close');
});

test('the invoice footer duplicate group points at its oldest report', () => {
  const block = data();
  assert.equal(issue(block, 411).duplicateOf, null);
  assert.equal(issue(block, 423).duplicateOf, 411);
  assert.equal(issue(block, 423).action, 'close');
});

test('the two upload reports remain separate areas', () => {
  const block = data();
  assert.equal(issue(block, 406).duplicateOf, null);
  assert.equal(issue(block, 415).duplicateOf, null);
  assert.notEqual(issue(block, 406).owner, issue(block, 415).owner);
});

test('the fixed report and security report get distinct handling', () => {
  const block = data();
  assert.equal(issue(block, 408).action, 'close');
  assert.match(issue(block, 408).reason, /1\.8\.2/i);
  assert.equal(issue(block, 413).severity, 'S1');
  assert.equal(issue(block, 413).action, 'escalate');
  assert.equal(issue(block, 413).owner, 'billing');
});

test('the loud unsupported-browser report is not high severity', () => {
  const block = data();
  assert.ok(!['S1', 'S2'].includes(issue(block, 419).severity));
  assert.match(issue(block, 419).reason, /browser|unsupported/i);
});

test('the planted needs-info reports are the queue majority of that action', () => {
  const block = data();
  const expected = new Set([402, 405, 414, 424]);
  const actual = block.issues.filter((item) => item.action === 'needs-info').map((item) => item.id);
  assert.ok(actual.length >= 4 && actual.length <= 6);
  for (const id of expected) assert.ok(actual.includes(id), `needs-info includes ${id}`);
});

test('the feature request is labelled as a request rather than a bug', () => {
  const block = data();
  const item = issue(block, 421);
  assert.ok(item.labels.some((label) => /enhancement|feature|request/i.test(label)));
  assert.ok(!item.labels.some((label) => /^bug$/i.test(label)));
});

test('web work is not marked fix-now below S1', () => {
  const block = data();
  for (const item of block.issues) {
    if (item.owner === 'web' && item.severity !== 'S1') assert.notEqual(item.action, 'fix-now', `issue ${item.id}`);
  }
});

test('owners mostly follow the path ownership map', () => {
  const block = data();
  const expected = new Map([
    [401, 'platform-api'], [402, 'docs'], [403, 'web'], [404, 'web'], [405, 'docs'], [406, 'web'],
    [407, 'web'], [408, 'platform-api'], [409, 'platform-api'], [410, 'web'], [411, 'billing'], [412, 'platform-api'],
    [413, 'billing'], [414, 'platform-api'], [415, 'platform-api'], [416, 'web'], [417, 'platform-api'], [418, 'platform-api'],
    [419, 'web'], [420, 'web'], [421, 'billing'], [422, 'web'], [423, 'billing'], [424, 'web']
  ]);
  const aligned = block.issues.filter((item) => item.owner === expected.get(item.id)).length;
  assert.ok(aligned >= 20, `only ${aligned} owners align`);
});
