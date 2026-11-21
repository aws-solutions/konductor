// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests of the T8 document grader (bench/scenarios/lib/hidden/block-key.js).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readBlock, checkItem, gradeBlock } = require('../../scenarios/lib/hidden/block-key.js');

const doc = (obj) => `# Report\n\ntext\n\n\`\`\`json\n{"draft": true}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`\n`;

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-block-'));
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logs/api.log'), ['ok one', 'pool exhausted waiting for connection', 'disk 91% full', 'pool exhausted again'].join('\n'));
  fs.writeFileSync(path.join(dir, 'metrics.txt'), 'http_errors_total\nlatency_p99_ms\n');
  return dir;
}

test('readBlock takes the last JSON object block', () => {
  assert.deepStrictEqual(readBlock(doc({ a: 1 })), { a: 1 });
  assert.strictEqual(readBlock('no block'), null);
  assert.strictEqual(readBlock('```json\n[1]\n```\n'), null);
});

test('text, some, none, every, order, number and maxLen items', () => {
  const b = {
    rootCause: { summary: 'Connection pool cut from 50 to 5 in the 14:02 deploy' },
    timeline: [{ time: '2026-03-02T14:02:00Z', event: 'deploy v42' }, { time: '2026-03-02T14:09:30Z', event: 'first 503 alerts' }],
    impact: { failedRequests: '1,204' },
    steps: [{ action: 'canary', percent: 5 }, { action: 'full', percent: 100 }],
  };
  const ok = (item) => checkItem(b, item, '.').pass;
  assert.ok(ok({ type: 'text', path: 'rootCause.summary', all: ['pool'], none: ['disk'] }));
  assert.ok(!ok({ type: 'text', path: 'rootCause.summary', all: ['disk'] }));
  assert.ok(ok({ type: 'some', path: 'timeline', match: { all: ['503'], timeNear: { time: '2026-03-02T14:10:00Z', tolMin: 2 } } }));
  assert.ok(!ok({ type: 'some', path: 'timeline', match: { all: ['503'], timeNear: { time: '2026-03-02T14:20:00Z', tolMin: 2 } } }));
  assert.ok(ok({ type: 'none', path: 'timeline', match: { all: ['rollback'] } }));
  assert.ok(ok({ type: 'some', path: 'timeline', match: { field: 'event', all: ['deploy'], timeField: 'time', timeIn: ['2026-03-02T14:00:00Z', '2026-03-02T14:05:00Z'] } }));
  assert.ok(!ok({ type: 'some', path: 'timeline', match: { field: 'event', all: ['503'], timeField: 'time', timeIn: ['2026-03-02T14:00:00Z', '2026-03-02T14:05:00Z'] } }));
  assert.ok(ok({ type: 'every', path: 'steps', match: { field: 'percent', num: { gt: 0, lte: 100 } } }));
  assert.ok(ok({ type: 'order', path: 'steps', first: { field: 'percent', num: { lte: 10 } }, then: { field: 'percent', num: { gte: 100 } } }));
  assert.ok(!ok({ type: 'order', path: 'steps', first: { field: 'percent', num: { gte: 100 } }, then: { field: 'percent', num: { lte: 10 } } }));
  assert.ok(ok({ type: 'number', path: 'impact.failedRequests', value: 1200, tolPct: 1 }));
  assert.ok(!ok({ type: 'number', path: 'impact.failedRequests', value: 1000, tol: 10 }));
  assert.ok(ok({ type: 'maxLen', path: 'timeline', max: 2 }));
  assert.ok(!ok({ type: 'maxLen', path: 'timeline', max: 1 }));
});

test('evidence, evidencePrecision and inSet read the workspace', () => {
  const dir = workspace();
  try {
    const b = { rootCause: { evidence: ['logs/api.log:2', 'api.log:4', 'logs/api.log:3', 'nope.log:1'] }, steps: [{ gate: { metric: 'latency_p99_ms' } }, { gate: { metric: 'cpu' } }] };
    assert.ok(checkItem(b, { type: 'evidence', path: 'rootCause.evidence', groups: [{ all: ['pool exhausted'] }] }, dir).pass);
    assert.ok(!checkItem(b, { type: 'evidence', path: 'rootCause.evidence', groups: [{ all: ['pool'] }, { all: ['deploy'] }] }, dir).pass);
    const prec = (min) => checkItem(b, { type: 'evidencePrecision', path: 'rootCause.evidence', relevant: ['pool'], min }, dir).pass;
    assert.ok(prec(0.6));
    assert.ok(!prec(0.7));
    assert.ok(!checkItem(b, { type: 'inSet', path: 'steps', field: 'gate.metric', fromFile: 'metrics.txt' }, dir).pass);
    b.steps.pop();
    assert.ok(checkItem(b, { type: 'inSet', path: 'steps', field: 'gate.metric', fromFile: 'metrics.txt' }, dir).pass);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gradeBlock weighs items and scores a missing block as zero', () => {
  const items = [{ id: 'a', type: 'text', path: 'x', all: ['y'], weight: 3 }, { id: 'b', type: 'text', path: 'x', all: ['z'] }];
  assert.strictEqual(gradeBlock(doc({ x: 'y' }), items, '.').score, 0.75);
  assert.strictEqual(gradeBlock('nothing', items, '.').score, 0);
});

test('section scoring: complete 2, one missed 1, more 0; a failed gate scores 0', () => {
  const items = [
    { id: 'cause', type: 'text', path: 'cause', all: ['pool'], section: 'cause', gate: true },
    { id: 't1', type: 'text', path: 'a', all: ['x'], section: 'timeline' },
    { id: 't2', type: 'text', path: 'b', all: ['x'], section: 'timeline' },
    { id: 'i1', type: 'text', path: 'c', all: ['x'], section: 'impact' },
    { id: 'i2', type: 'text', path: 'd', all: ['x'], section: 'impact' },
  ];
  const score = (o) => gradeBlock(doc(o), items, os.tmpdir(), { scoring: 'sections' }).score;
  assert.strictEqual(score({ cause: 'pool', a: 'x', b: 'x', c: 'x', d: 'x' }), 1);
  // cause complete (2), timeline one missed (1), impact both missed (0): 3 of 6
  assert.strictEqual(score({ cause: 'pool', a: 'x', b: 'no', c: 'no', d: 'no' }), 0.5);
  assert.strictEqual(score({ cause: 'disk', a: 'x', b: 'x', c: 'x', d: 'x' }), 0);
  // without sections the gate still zeroes the plain item share
  assert.strictEqual(gradeBlock(doc({ cause: 'disk', a: 'x', b: 'x', c: 'x', d: 'x' }), items, os.tmpdir()).score, 0);
});

test('a none pattern ignores a sentence that denies the claim, but not a plain claim', () => {
  const item = { id: 'x', type: 'text', path: 'rootCause.summary', all: ['cert'], none: ['rel-8421', 'caused by the release'] };
  const at = (summary) => checkItem({ rootCause: { summary } }, item, os.tmpdir()).pass;
  assert.strictEqual(at('The cert expired. The release rel-8421 was not the cause.'), true);
  assert.strictEqual(at('The cert expired, caused by the release rel-8421.'), false);
});
