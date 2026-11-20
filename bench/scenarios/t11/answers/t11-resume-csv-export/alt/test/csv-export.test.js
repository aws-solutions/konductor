const test = require('node:test');
const assert = require('node:assert/strict');
const { exportTimesheet } = require('../src/export');

const base = {
  id: 'alt-7', startedAt: '2025-07-09T14:00:00+02:00', endedAt: '2025-07-09T15:30:00+02:00',
  minutes: 90, project: 'Birch', description: 'outline', billable: true, tags: ['draft', 'client']
};

test('the CSV header is stable even for an empty ledger', () => {
  assert.equal(exportTimesheet([], 'csv'), 'id,startedAt,endedAt,minutes,project,description,billable,tags\n');
});

test('an entry is written in UTC with its tags', () => {
  assert.equal(exportTimesheet([base], { format: 'csv' }), 'id,startedAt,endedAt,minutes,project,description,billable,tags\nalt-7,2025-07-09T12:00:00.000Z,2025-07-09T13:30:00.000Z,90,Birch,outline,true,draft;client\n');
});

test('cells are safe for a spreadsheet', () => {
  const row = { ...base, project: '@finance', description: 'a,b "c"\nnext', billable: false };
  assert.equal(exportTimesheet([row], { format: 'csv' }), 'id,startedAt,endedAt,minutes,project,description,billable,tags\nalt-7,2025-07-09T12:00:00.000Z,2025-07-09T13:30:00.000Z,90,\'@finance,"a,b ""c""\nnext",false,draft;client\n');
});
