'use strict';

// Hidden test of the second step of t12-handoff-export-dates: the fix must be finished from the hand-off alone. It reads
// only deliverables (the hand-off's JSON block, the result's JSON block in docs/handoff/BILL-1187-result.md and the
// repository), never a session label or a tool log.
//   .bench-base/   the untouched fixture, copied in by the tests check (.bench-lib.json "@pristine")
// Every test needs the hand-off block and the result file (no second step, no credit) and counts twice: the finished
// work is the larger part of the task.
// The process helpers (files, node, withTemp) are bench/scenarios/lib/hidden/work-kit.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock } = require('./block-kit/block-key.js');
const { files, node, withTemp: tempDir } = require('./work-kit.js');

const root = __dirname;
const BASE = path.join(root, '.bench-base');
const HANDOFF = 'docs/handoff/BILL-1187.md';
const RESULT = 'docs/handoff/BILL-1187-result.md';
// Node 22 and later take globs, not a directory, so `node --test test/` fails there.
const SUITE = 'test/**/*.test.js';
const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; } };
const handoff = readBlock(read(root, HANDOFF) || '');
const result = readBlock(read(root, RESULT) || '');
const norm = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
const words = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
const list = (v) => (Array.isArray(v) ? v : []);
const listed = list(handoff?.context?.files).map(norm);

const withTemp = (fn) => tempDir('t12-handoff', fn);

const work = (name, fn) => {
  for (const n of [1, 2]) {
    test(`${name} #${n}`, () => {
      assert.ok(handoff, `no JSON block in ${HANDOFF}`);
      assert.ok(result, `no JSON block in ${RESULT}: the work was not finished from the hand-off`);
      fn();
    });
  }
};

// Invoices whose local and UTC dates differ in at least one of the zones below.
const INVOICES = [
  { id: 'INV-3001', customer: 'A', issuedAt: '2026-10-31T13:30:00Z', dueAt: '2026-11-30T13:30:00Z', amountCents: 1, currency: 'NZD' },
  { id: 'INV-3003', customer: 'B', issuedAt: '2026-11-01T03:00:00Z', dueAt: '2026-12-01T03:00:00Z', amountCents: 2, currency: 'USD' },
];
const WANT = ['2026-10-31,2026-11-30', '2026-11-01,2026-12-01'];

work('the export gives the invoice UTC date for issued and due dates in any server time zone', () => {
  const js = `const { toCsv } = require('./src/export'); process.stdout.write(toCsv(${JSON.stringify(INVOICES)}));`;
  for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles']) {
    const r = node(['-e', js], root, { TZ: tz });
    assert.equal(r.status, 0, `the export fails under TZ=${tz}: ${(r.stderr || '').slice(0, 300)}`);
    const dates = r.stdout.trim().split('\n').slice(1).map((l) => l.split(',').slice(2, 4).join(','));
    assert.deepEqual(dates, WANT, `issued_on,due_on under TZ=${tz}`);
  }
});

work('the suite passes under TZ=UTC and under TZ=Pacific/Auckland', () => {
  for (const tz of ['UTC', 'Pacific/Auckland']) assert.equal(node(['--test', SUITE], root, { TZ: tz }).status, 0, `the suite fails under TZ=${tz}`);
});

work('a test added in this change fails on the original code even under TZ=UTC', () => withTemp((dir) => {
  for (const p of ['src', 'test', 'package.json']) if (fs.existsSync(path.join(root, p))) fs.cpSync(path.join(root, p), path.join(dir, p), { recursive: true });
  fs.copyFileSync(path.join(BASE, 'src/format-date.js'), path.join(dir, 'src/format-date.js'));
  assert.notEqual(node(['--test', SUITE], dir, { TZ: 'UTC' }).status, 0, 'with the original src/format-date.js the suite still passes under TZ=UTC');
}));

work('the column order and the frozen legacy exporter are unchanged', () => {
  assert.equal(read(root, 'src/legacy/old-export.js'), read(BASE, 'src/legacy/old-export.js'), 'src/legacy/old-export.js changed');
  const cols = node(['-e', "process.stdout.write(JSON.stringify(require('./src/export').COLUMNS))"], root);
  assert.equal(cols.status, 0, 'src/export.js no longer loads');
  assert.deepEqual(JSON.parse(cols.stdout), ['invoice_id', 'customer', 'issued_on', 'due_on', 'amount_cents', 'currency']);
});

work('the second step started from the hand-off and read only it and the files it lists', () => {
  const readFiles = list(result.readFiles).map(norm);
  assert.ok(readFiles.includes(HANDOFF), `readFiles does not include ${HANDOFF}`);
  const outside = readFiles.filter((f) => f !== HANDOFF && !listed.includes(f) && !listed.some((d) => d.endsWith('/') && f.startsWith(d)));
  assert.deepEqual(outside, [], 'files read that the hand-off does not list');
});

// A change is in scope when the hand-off lists the file (or its folder), or it is a new file next to a listed one.
const inScope = (f) => f === RESULT || listed.includes(f) || listed.some((d) => (d.endsWith('/') && f.startsWith(d)) || (!fs.existsSync(path.join(BASE, f)) && path.posix.dirname(d) === path.posix.dirname(f)));

work('the second step changed only files the hand-off scopes, and its result names every one', () => {
  const changed = files(root).filter((f) => /^(src|test)\//.test(f) || f === 'package.json').filter((f) => read(root, f) !== read(BASE, f));
  assert.ok(changed.includes('src/format-date.js'), 'src/format-date.js was not changed');
  const named = list(result.changedFiles).map(norm);
  assert.deepEqual(changed.filter((f) => !named.includes(f)), [], 'changed files the result does not name');
  assert.deepEqual(named.filter((f) => !inScope(f)), [], 'changed files outside the hand-off scope');
});

work('the result answers every done criterion of the hand-off with evidence', () => {
  const criteria = list(handoff.doneWhen).map(String);
  assert.ok(criteria.length, 'the hand-off has no doneWhen');
  const answers = list(result.doneWhen);
  for (const c of criteria) {
    const a = answers.find((x) => x && words(x.criterion) === words(c));
    assert.ok(a, `no answer for done criterion "${c}"`);
    assert.ok(typeof a.evidence === 'string' && a.evidence.trim().length >= 10, `no evidence for "${c}"`);
    // A pull request, review or merge is left to the owner in this run; every other criterion must be met.
    if (!/pull request|\bPR\b|review|merge|push|branch/i.test(c)) assert.equal(a.met, true, `"${c}" is not met`);
  }
});

work('the second step ran the commands the hand-off gives', () => {
  const ran = list(result.ranCommands).map(words);
  const given = list(handoff.context?.commands).map(words);
  assert.ok(given.length, 'the hand-off gives no commands');
  assert.ok(given.some((c) => ran.includes(c)), 'none of the hand-off commands is in ranCommands');
});
