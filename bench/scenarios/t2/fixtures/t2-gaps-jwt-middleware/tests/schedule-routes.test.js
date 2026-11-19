const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduleRoutes } = require('../src/routes/schedule-routes');

test('schedule lists all shifts for a session user', () => {
  const shifts = { all: () => [{ id: 'sh-test' }], forDate: () => [] };
  const result = createScheduleRoutes({ shifts }).list({ sessionUser: { id: 'u-100' } });
  assert.deepEqual(result.body.shifts, [{ id: 'sh-test' }]);
});

test('schedule filters by date when requested', () => {
  const shifts = { all: () => [], forDate: (date) => [{ date }] };
  const result = createScheduleRoutes({ shifts }).list({ sessionUser: { id: 'u-100' }, query: { date: '2025-03-03' } });
  assert.equal(result.body.shifts[0].date, '2025-03-03');
});
