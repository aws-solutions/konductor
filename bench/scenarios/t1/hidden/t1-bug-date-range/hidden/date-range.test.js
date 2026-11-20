const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { overlaps, monthRange, daysBetween, formatDate } = require('../src/date-range');
const { hasConflict, addBooking } = require('../src/bookings');
const fs = require('node:fs');
const os = require('node:os');

const repo = path.resolve(__dirname, '..');
const sample = (id, start, end, room = 'cedar-1') => ({ id, room, start, end, name: id });

// Runs daysBetween in a child process pinned to one time zone, so the result does not depend on the host zone.
function nightsIn(tz, start, end) {
  const code = `const { daysBetween } = require('./src/date-range'); process.stdout.write(String(daysBetween(${JSON.stringify(start)}, ${JSON.stringify(end)})))`;
  return execFileSync(process.execPath, ['-e', code], { cwd: repo, env: { ...process.env, TZ: tz }, encoding: 'utf8' });
}

test('daysBetween counts calendar nights across the spring clock change', () => {
  assert.equal(nightsIn('America/New_York', '2025-03-08', '2025-03-10'), '2');
});

test('daysBetween counts calendar nights across a European spring clock change', () => {
  assert.equal(nightsIn('Europe/London', '2025-03-29', '2025-03-31'), '2');
});

test('a two-week stay that spans the clock change keeps every night', () => {
  assert.equal(nightsIn('America/New_York', '2025-03-01', '2025-03-15'), '14');
});

test('daysBetween counts calendar nights for check-in and check-out times', () => {
  assert.equal(daysBetween('2025-06-10T15:00:00', '2025-06-12T11:00:00'), 2);
});

test('overlap treats a shared endpoint as available', () => {
  assert.equal(overlaps('2025-05-01T09:00:00', '2025-05-01T10:00:00', '2025-05-01T10:00:00', '2025-05-01T11:00:00'), false);
});

test('same-room bookings that touch can be checked and added', () => {
  const existing = [sample('a', '2025-05-01T09:00:00', '2025-05-01T10:00:00')];
  assert.equal(hasConflict(sample('b', '2025-05-01T10:00:00', '2025-05-01T11:00:00'), existing), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'range-bookings-'));
  try {
    const file = path.join(dir, 'bookings.json');
    fs.writeFileSync(file, JSON.stringify(existing));
    addBooking(file, sample('b', '2025-05-01T10:00:00', '2025-05-01T11:00:00'));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('monthRange ends at the first day after the month, including December', () => {
  assert.equal(formatDate(monthRange(2025, 1).end), '2025-02-01');
  assert.equal(formatDate(monthRange(2025, 12).end), '2026-01-01');
});
