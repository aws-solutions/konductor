// SPDX-License-Identifier: Apache-2.0
'use strict';

// The read view's coverage audit (bench/judge/view/read-audit.js) on hand-made traces. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditReads, linesOfRead, relInside, MAX_READ_BYTES } = require('../../judge/view/read-audit.js');

const DIR = '/scratch/jdg-oc-x/cwd';
const FILES = [{ rel: 'a.txt', text: 'one\ntwo\nthree\n' }, { rel: 'empty.txt', text: '' }];
const read = (filePath, more = {}, status = 'completed') => ({ tool: 'read', input: { filePath, ...more }, status });
const trace = (tools) => ({ dirs: [DIR, '/real/cwd'], steps: tools.length + 1, tools });

test('full reads pass and give the read order; relative, absolute and real-path forms all count', () => {
  const r = auditReads(trace([read('a.txt', { offset: 1, limit: 2 }), read(`${DIR}/a.txt`, { offset: 3 }), read('/real/cwd/empty.txt')]), FILES);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.record, { order: ['a.txt', 'empty.txt'], steps: 4, toolCalls: 3 });
});

test('a missing line, a failed read and a never-read file are each not scored', () => {
  assert.match(auditReads(trace([read('a.txt', { limit: 2 }), read('empty.txt')]), FILES).error, /a\.txt \(lines 3-3\)/);
  assert.match(auditReads(trace([read('a.txt', {}, 'error'), read('empty.txt')]), FILES).error, /a\.txt \(never read\)/);
  assert.match(auditReads(trace([read('a.txt')]), FILES).error, /empty\.txt \(never read\)/);
  assert.match(auditReads(null, FILES).error, /no record/);
});

test('any other tool, or a path outside the copy for read, glob or grep, fails the audit', () => {
  assert.match(auditReads(trace([{ tool: 'bash', input: { command: 'ls' }, status: 'completed' }]), FILES).error, /used bash/);
  assert.match(auditReads(trace([read('../x')]), FILES).error, /outside its copy \(\.\.\/x\)/);
  assert.match(auditReads(trace([{ tool: 'grep', input: { pattern: 'x', path: '/etc' }, status: 'completed' }]), FILES).error, /outside its copy \(\/etc\)/);
  assert.match(auditReads(trace([{ tool: 'glob', input: { pattern: '*', path: `${DIR}-evil` }, status: 'completed' }]), FILES).error, /outside its copy/);
  assert.equal(relInside('sub/../a.txt', [DIR]), 'a.txt');
  assert.equal(relInside('.', [DIR]), '');
});

test('a read returns at most limit lines and stops before 50 KB; offset counts from 1 and a bad one is taken as 1', () => {
  const lines = Array.from({ length: 10 }, () => 'z'.repeat(9));
  assert.deepEqual(linesOfRead(lines, { offset: 4, limit: 3 }), [4, 5, 6]);
  assert.deepEqual(linesOfRead(lines, { offset: 0, limit: 2 }), [1, 2]);
  assert.deepEqual(linesOfRead(lines, {}), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const wide = Array.from({ length: 3 }, () => 'w'.repeat(MAX_READ_BYTES / 2));
  assert.deepEqual(linesOfRead(wide, {}), [1]);
});
