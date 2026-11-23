// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/dates.js and the lint's stale-date warning: a date in a task prompt that lay ahead when the task was
// written and lies behind now (the pilot's convention control went non-neutral this way on 2026-11-23).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { datesIn, staleDates } = require('../../scenarios/dates.js');
const { lintDir } = require('../../scenarios/lint.js');

const day = (s) => new Date(`${s}T00:00:00Z`);

test('datesIn: ISO, day-month-year and month-day-year, in order; impossible dates are left out', () => {
  const got = datesIn('Renew by 2026-11-20, the review is on 30 Nov 2026, launch on December 3, 2026 and Feb 30 2026 is not a day.');
  assert.deepEqual(got.map((d) => d.iso), ['2026-11-20', '2026-11-30', '2026-12-03']);
  assert.deepEqual(got.map((d) => d.text), ['2026-11-20', '30 Nov 2026', 'December 3, 2026']);
});

test('staleDates: after the authoring date and before now; history before authoring and "as given" prompts are fine', () => {
  const task = { id: 'x', authorship: { date: '2026-11-12' }, prompt: 'The incident was on 2026-03-01. The certificate expires 20 November 2026; the board meets 2027-01-05.' };
  assert.deepEqual(staleDates(task, { now: day('2026-11-23') }).map((d) => d.iso), ['2026-11-20']);
  assert.deepEqual(staleDates(task, { now: day('2026-11-19') }), [], 'not stale yet');
  assert.deepEqual(staleDates({ ...task, prompt: `${task.prompt} Take the dates as given.` }, { now: day('2026-11-23') }), []);
  assert.deepEqual(staleDates({ ...task, authorship: {} }, { now: day('2026-11-23') }), [], 'no authoring date, no judgement');
});

test('lintDir: a stale date is a warning, never a finding, so the lint does not fail with the calendar', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-dates-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.mkdirSync(path.join(d, 't9'));
  fs.writeFileSync(path.join(d, 't9', 't9-a.json'), JSON.stringify({ id: 't9-a', prompt: 'Ship before 2026-11-20.', fixture: 't9-a', hidden: 't9-a', authorship: { family: 'claude', model: 'm', date: '2026-11-12' } }));
  const res = lintDir(d, { names: [] }, { now: day('2026-11-23') });
  assert.equal(res.findings.filter((f) => f.rule === 'stale-date').length, 0);
  assert.deepEqual(res.warnings.map((w) => [w.taskId, w.rule]), [['t9-a', 'stale-date']]);
  assert.match(res.warnings[0].detail, /2026-11-20 was ahead when the task was written \(2026-11-12\) and is behind 2026-11-23/);
  assert.deepEqual(lintDir(d, { names: [] }, { now: day('2026-11-15') }).warnings, []);
});
