const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { monthlySummary } = require('../src/report');

const booking = (id, start, end) => ({ id, room: 'cedar-1', start, end, name: id });

test('January reports contain all 31 calendar days, including a booking on the last day', () => {
  const report = monthlySummary([booking('last', '2025-01-31T09:00:00', '2025-02-01T00:00:00')], 2025, 1);
  assert.equal(report.days.length, 31);
  assert.equal(report.days.at(-1).date, '2025-01-31');
  assert.deepEqual(report.days.at(-1).bookingIds, ['last']);
});

test('leap-day reports contain February 29', () => {
  const report = monthlySummary([], 2024, 2);
  assert.equal(report.days.length, 29);
  assert.equal(report.days.at(-1).date, '2024-02-29');
});

test('report nights stop at the booking end', () => {
  const june = monthlySummary([booking('one', '2025-06-10T18:00:00', '2025-06-11T00:00:00')], 2025, 6);
  assert.deepEqual(june.days.find(day => day.date === '2025-06-11').bookingIds, []);
  const march = monthlySummary([booking('dst', '2025-03-08', '2025-03-10')], 2025, 3);
  assert.equal(march.totalNights, 2);
});

test('the report command prints the last day of the selected month', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'range-report-'));
  try {
    const file = path.join(dir, 'bookings.json');
    fs.writeFileSync(file, '[]');
    const result = spawnSync(process.execPath, ['src/cli.js', 'report', '--month', '2025-01', '--file', file], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.days.at(-1).date, '2025-01-31');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
