#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Checks bench/DEBT.md and counts its rows. Free: reads the file and, for --week, git history.
//   node bench/scripts/debt-check.js                 every row has 10 cells, a known status, a due date and, when not
//                                                     closed, an owner and a next action; ids are unique. Exit 1 if not
//   node bench/scripts/debt-check.js --past-due [--today YYYY-MM-DD]
//                                                     also list the rows that are not closed and past their due date (exit 1)
//   node bench/scripts/debt-check.js --week [--since YYYY-MM-DD]
//                                                     opened, closed and net this week: rows now against the file at the
//                                                     last commit before --since (default 7 days ago)
// The counts are printed, not checked into a doc: they move whenever a row lands (see gen-docs.js).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEBT_FILE = path.join(__dirname, '..', 'DEBT.md');
const STATUSES = ['open', 'in progress', 'blocked', 'closed'];
const COLUMNS = ['id', 'area', 'symptom', 'evidence', 'owner', 'next', 'proof', 'due', 'status', 'reviewed'];

/** The table rows of DEBT.md text: [{ line, cells: { id, area, ... } , raw: [cells] }]. A `\|` stays inside a cell. */
function parseRows(text) {
  const rows = [];
  String(text).split('\n').forEach((l, i) => {
    if (!/^\| (?:[DK]-|#)\d/.test(l)) return;
    const raw = l.slice(1, l.endsWith('|') ? -1 : undefined).split(/(?<!\\)\|/).map((c) => c.trim());
    rows.push({ line: i + 1, raw, cells: Object.fromEntries(COLUMNS.map((k, j) => [k, raw[j] ?? ''])) });
  });
  return rows;
}

/** Format problems: [string]. */
function checkRows(rows) {
  const problems = [];
  const seen = new Map();
  for (const r of rows) {
    const c = r.cells;
    const at = `line ${r.line} ${c.id || '(no id)'}`;
    if (r.raw.length !== COLUMNS.length) problems.push(`${at}: ${r.raw.length} cells, expected ${COLUMNS.length}`);
    if (seen.has(c.id)) problems.push(`${at}: id also on line ${seen.get(c.id)}`);
    seen.set(c.id, r.line);
    if (!STATUSES.includes(c.status)) problems.push(`${at}: status "${c.status.slice(0, 40)}" is not one of ${STATUSES.join(', ')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.due)) problems.push(`${at}: due date "${c.due.slice(0, 40)}" is not YYYY-MM-DD`);
    if (c.status !== 'closed' && (!c.owner || !c.next)) problems.push(`${at}: a row that is not closed needs an owner and a next action`);
  }
  return problems;
}

const countBy = (rows) => Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.cells.status === s).length]));

/** Rows not closed whose due date is before `today` (YYYY-MM-DD). */
const pastDue = (rows, today) => rows.filter((r) => r.cells.status !== 'closed' && /^\d{4}-\d{2}-\d{2}$/.test(r.cells.due) && r.cells.due < today);

/** { opened, closed, net } between two parsed versions of the table. */
function weekCounts(before, now) {
  const was = new Map(before.map((r) => [r.cells.id, r.cells.status]));
  const opened = now.filter((r) => !was.has(r.cells.id)).length;
  const closed = now.filter((r) => r.cells.status === 'closed' && was.get(r.cells.id) !== 'closed').length;
  return { opened, closed, net: opened - closed };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function textAt(since) {
  const root = path.join(__dirname, '..', '..');
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  const rev = git('rev-list', '-1', '--first-parent', `--before=${since}T00:00:00`, 'HEAD');
  if (!rev) return '';
  try { return execFileSync('git', ['-C', root, 'show', `${rev}:bench/DEBT.md`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}

function main() {
  const rows = parseRows(fs.readFileSync(DEBT_FILE, 'utf8'));
  const problems = checkRows(rows);
  const c = countBy(rows);
  console.log(`${rows.length} rows: ${STATUSES.map((s) => `${c[s]} ${s}`).join(', ')}`);
  for (const p of problems) console.log(`format: ${p}`);
  let bad = problems.length > 0;
  if (process.argv.includes('--past-due')) {
    const today = arg('--today') ?? new Date().toISOString().slice(0, 10);
    const late = pastDue(rows, today);
    for (const r of late) console.log(`past due: ${r.cells.id} (due ${r.cells.due}, ${r.cells.status}, ${r.cells.owner})`);
    console.log(`${late.length} row(s) past due on ${today}`);
    bad = bad || late.length > 0;
  }
  if (process.argv.includes('--week')) {
    const since = arg('--since') ?? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const w = weekCounts(parseRows(textAt(since)), rows);
    console.log(`since ${since}: opened ${w.opened}, closed ${w.closed}, net ${w.net >= 0 ? '+' : ''}${w.net}`);
  }
  if (bad) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { parseRows, checkRows, countBy, pastDue, weekCounts, STATUSES, COLUMNS, DEBT_FILE };
