// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/DEBT.md stays a table a script can read: 10 cells per row, a known status, a due date, and an owner and a
// next action on every row that is not closed (bench/scripts/debt-check.js). Past-due rows are a review finding, not
// a test failure, so this file never fails because a date passed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseRows, checkRows, pastDue, weekCounts, countBy, DEBT_FILE, BACKLOG } = require('../../scripts/debt-check.js');

const HEAD = '| ID | area | symptom | evidence | owner | next | proof | due | status | reviewed |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
const row = (id, o = {}) => `| ${id} | a | s \\| still one cell | e | ${o.owner ?? 'bench owner'} | ${o.next ?? 'fix it'} | p | ${o.due ?? '2026-12-01'} | ${o.status ?? 'open'} | abc |`;

test('the parser keeps an escaped bar inside a cell and reads every column', () => {
  const [r] = parseRows(HEAD + row('D-1'));
  assert.equal(r.raw.length, 10);
  assert.equal(r.cells.symptom, 's \\| still one cell');
  assert.equal(r.cells.status, 'open');
});

test('checkRows names a bad status, a shifted row, a missing owner and a duplicate id', () => {
  const text = HEAD + [
    row('D-1'),
    row('D-2', { status: 'closed 2026-11-19: done' }),
    row('D-3', { owner: '' }),
    row('D-1', { status: 'closed' }),
    '| D-4 | a | s | e | o | n | p | 2026-12-01 | extra | open | abc |',
  ].join('\n');
  const p = checkRows(parseRows(text));
  assert.equal(p.length, 5, p.join('\n'));
  assert.match(p.join('\n'), /D-2: status "closed 2026-11-19: done"/);
  assert.match(p.join('\n'), /D-3: a row that is not closed needs an owner/);
  assert.match(p.join('\n'), /D-1: id also on line/);
  assert.match(p.join('\n'), /D-4: 11 cells/);
});

test('pastDue and weekCounts', () => {
  const before = parseRows(HEAD + [row('D-1'), row('D-2')].join('\n'));
  const now = parseRows(HEAD + [row('D-1', { status: 'closed' }), row('D-2', { due: '2026-11-01' }), row('D-3')].join('\n'));
  assert.deepEqual(pastDue(now, '2026-11-20').map((r) => r.cells.id), ['D-2']);
  assert.deepEqual(weekCounts(before, now), { opened: 1, closed: 1, net: 0 });
  assert.deepEqual(countBy(now), { open: 2, 'in progress': 0, blocked: 0, closed: 1 });
});

test('bench/DEBT.md itself passes the format check', () => {
  const rows = parseRows(fs.readFileSync(DEBT_FILE, 'utf8'));
  assert.ok(rows.length > 100);
  assert.deepEqual(checkRows(rows), []);
});

test('the backlog check names a closing note left in the due cell and a status with extra words', () => {
  const head = '| ID | title | owner | next | due | status | debt |\n| --- | --- | --- | --- | --- | --- | --- |\n';
  const text = head + [
    '| B-001 | t | mate | n | 2026-12-01 | todo | none |',
    '| B-002 | t | mate | n | Done (abc): built | todo | done |',
    '| B-003 | t | mate | n | 2026-12-01 | doing (step 1 done) | none |',
    '| B-004a | t | | n | 2026-12-01 | done | none |',
  ].join('\n');
  const p = checkRows(parseRows(text, BACKLOG), BACKLOG);
  assert.equal(p.length, 2, p.join('\n'));
  assert.match(p.join('\n'), /B-002: due date "Done \(abc\): built"/);
  assert.match(p.join('\n'), /B-003: status "doing \(step 1 done\)" is not one of todo, doing, done/);
});

test('bench/BACKLOG.md itself passes the format check', () => {
  const rows = parseRows(fs.readFileSync(BACKLOG.file, 'utf8'), BACKLOG);
  assert.ok(rows.length > 15);
  assert.deepEqual(checkRows(rows, BACKLOG), []);
});
