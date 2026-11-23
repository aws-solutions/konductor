// SPDX-License-Identifier: Apache-2.0
'use strict';

// The convention control must stay neutral on reading A. Its tasks give event dates as "upcoming"; once a date is in
// the past on the run date, a model without the control skill hedges about it (and writes placeholders), the skill's
// rigid note shape does not, and A moves (pilot kp-pilot-1, 2026-11-23). So no control task date may be in the past,
// and every task tells both arms to take its dates and facts as given.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConvention, pastControlDates, CONTROL_AS_GIVEN } = require('../../cap/frozen.js');

test('no convention control task names a date in the past on the run date', () => {
  const past = pastControlDates(loadConvention(), new Date());
  assert.deepEqual(past, [], `control task dates already in the past: ${past.map((p) => `${p.task} ${p.date}`).join(', ')}`);
});

test('the date check finds a past date, and ignores dates of the past that the task means as past', () => {
  const convention = { batches: [{ tasks: [{ id: 't', prompt: 'Ship on 3 November 2026. With us since March 2024.' }] }] };
  assert.deepEqual(pastControlDates(convention, new Date('2026-11-23T00:00:00Z')).map((p) => p.date), ['3 November 2026']);
  assert.deepEqual(pastControlDates(convention, new Date('2026-11-01T00:00:00Z')), []);
});

test('every convention control task tells both arms to take its dates and facts as given', () => {
  for (const b of loadConvention().batches) for (const t of b.tasks) assert.ok(t.prompt.includes(CONTROL_AS_GIVEN), t.id);
});
