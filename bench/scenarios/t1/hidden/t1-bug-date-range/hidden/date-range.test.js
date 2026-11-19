const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { overlaps, monthRange } = require('../src/date-range');
const { hasConflict, addBooking } = require('../src/bookings');
const fs = require('node:fs');
const os = require('node:os');

const repo = path.resolve(__dirname, '..');
const sample = (id, start, end, room = 'cedar-1') => ({ id, room, start, end, name: id });

test('daysBetween counts calendar nights across the spring clock change', () => {
  const code = `const { daysBetween } = require('./src/date-range'); process.stdout.write(String(daysBetween('2025-03-08','2025-03-10')))`;
  const result = execFileSync(process.execPath, ['-e', code], { cwd: repo, env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(result, '2');
});

test('overlap treats a shared endpoint as available', () => {
  assert.equal(overlaps('2025-05-01T09:00:00', '2025-05-01T10:00:00', '2025-05-01T10:00:00', '2025-05-01T11:00:00'), false);
});

test('same-room bookings that touch can be added', () => {
  const existing = [sample('a', '2025-05-01T09:00:00', '2025-05-01T10:00:00')];
  assert.equal(hasConflict(sample('b', '2025-05-01T10:00:00', '2025-05-01T11:00:00'), existing), false);
});

test('addBooking accepts a booking beginning at the prior booking end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'range-bookings-'));
  try {
    const file = path.join(dir, 'bookings.json');
    fs.writeFileSync(file, JSON.stringify([sample('a', '2025-05-01T09:00:00', '2025-05-01T10:00:00')]));
    addBooking(file, sample('b', '2025-05-01T10:00:00', '2025-05-01T11:00:00'));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('monthRange ends at the first instant of the following month', () => {
  const { formatDate } = require('../src/date-range');
  assert.equal(formatDate(monthRange(2025, 1).end), '2025-02-01');
});
