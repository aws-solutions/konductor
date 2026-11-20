const test = require('node:test');
const assert = require('node:assert/strict');
const { exportTimesheet } = require('../src/export');

test('CSV has the public field order', () => {
  const output = exportTimesheet([], { format: 'csv' });
  assert.equal(output, 'id,startedAt,endedAt,minutes,project,description,billable,tags\n');
});

test('CSV renders UTC times and ordinary fields', () => {
  const row = {
    id: 'ref-1',
    startedAt: '2025-05-01T08:00:00-04:00',
    endedAt: '2025-05-01T09:00:00-04:00',
    minutes: 60,
    project: 'Garden',
    description: 'morning pass',
    billable: true,
    tags: ['client']
  };
  assert.equal(exportTimesheet([row], 'csv'), 'id,startedAt,endedAt,minutes,project,description,billable,tags\nref-1,2025-05-01T12:00:00.000Z,2025-05-01T13:00:00.000Z,60,Garden,morning pass,true,client\n');
});

test('CSV protects spreadsheet cells and quotes multiline text', () => {
  const row = {
    id: 'ref-2', startedAt: '2025-05-02T00:00:00Z', endedAt: '2025-05-02T00:01:00Z', minutes: 1,
    project: '=1+1', description: 'one, "two"\nthree', billable: false, tags: ['safe']
  };
  assert.equal(exportTimesheet([row], { format: 'csv' }), 'id,startedAt,endedAt,minutes,project,description,billable,tags\nref-2,2025-05-02T00:00:00.000Z,2025-05-02T00:01:00.000Z,1,\'=1+1,"one, ""two""\nthree",false,safe\n');
});
