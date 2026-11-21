'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const logPath = path.join(root, 'logs', 'checkout-api.log');
const hourlyPath = path.join(root, 'reports', 'checkout-hourly.csv');
const totalsPath = path.join(root, 'reports', 'checkout-totals.json');

// The log records request chk-1083-001 twice (a WARN and an INFO line). Counting every /checkout record, as the request
// says, and counting each request id once are both accepted; the report must use one reading throughout.
function expectedFromFixture(distinct = false) {
  const hours = new Map();
  const seen = new Set();
  const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
  for (const line of lines) {
    const timestamp = line.match(/^(\S+)/)?.[1];
    const route = line.match(/\broute=\S+\s+(\S+)/)?.[1];
    if (!timestamp || route !== '/checkout') continue;
    const id = line.match(/\brequest_id=(\S+)/)?.[1];
    if (distinct && id) { if (seen.has(id)) continue; seen.add(id); }
    const status = Number(line.match(/\bstatus=(\d+)/)?.[1]);
    const date = new Date(timestamp);
    date.setUTCMinutes(0, 0, 0);
    const hour = date.toISOString().replace('.000Z', 'Z');
    const bucket = hours.get(hour) || { hour, requests: 0, succeeded: 0 };
    bucket.requests += 1;
    if (status < 400) bucket.succeeded += 1;
    hours.set(hour, bucket);
  }
  return [...hours.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

function readHourly() {
  const text = fs.readFileSync(hourlyPath, 'utf8').trim();
  const lines = text.split(/\r?\n/);
  return {
    header: lines[0]?.split(','),
    rows: lines.slice(1).map((line) => {
      const [hour, requests, succeeded] = line.split(',');
      return { hour, requests, succeeded };
    }),
  };
}

function readTotals() {
  const text = fs.readFileSync(totalsPath, 'utf8');
  assert.strictEqual(text.trim().split(/\r?\n/).length, 1, 'totals JSON must occupy one line');
  return JSON.parse(text);
}

function expectedTotals(distinct = reading()) {
  return expectedFromFixture(distinct).reduce(
    (totals, row) => ({
      requests: totals.requests + row.requests,
      succeeded: totals.succeeded + row.succeeded,
    }),
    { requests: 0, succeeded: 0 },
  );
}

// The shape tests count only when the request counts are right: a well-shaped report of wrong numbers is not half an
// answer. The two count tests stand on their own.
// true when the report counts each request id once, false when it counts every record (the default when unreadable).
function reading() {
  try {
    const t = readTotals();
    const once = expectedFromFixture(true).reduce((n, r) => n + r.requests, 0);
    return t.requests === once && once !== expectedFromFixture(false).reduce((n, r) => n + r.requests, 0);
  } catch { return false; }
}

function rightCounts() {
  assert.deepStrictEqual(readTotals(), expectedTotals(), 'the totals must match the /checkout records of the log');
}

test('hourly CSV exists', () => {
  rightCounts();
  assert.ok(fs.statSync(hourlyPath).isFile());
});

test('totals JSON exists', () => {
  rightCounts();
  assert.ok(fs.statSync(totalsPath).isFile());
});

test('hourly CSV has the requested columns', () => {
  rightCounts();
  assert.deepStrictEqual(readHourly().header, ['hour', 'requests', 'succeeded']);
});

test('hourly CSV covers exactly every fixture hour', () => {
  rightCounts();
  const expected = expectedFromFixture(reading());
  const actual = readHourly().rows;
  assert.strictEqual(actual.length, expected.length);
});

test('hour values are sorted ISO UTC hour starts', () => {
  rightCounts();
  const { rows } = readHourly();
  const hours = rows.map((row) => row.hour);
  assert.ok(hours.every((hour) => /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(hour)));
  assert.deepStrictEqual(hours, [...hours].sort());
});

test('hourly rows contain the fixture-derived counts', () => {
  const actual = readHourly().rows.map((row) => ({
    hour: row.hour,
    requests: Number(row.requests),
    succeeded: Number(row.succeeded),
  }));
  assert.deepStrictEqual(actual, expectedFromFixture(reading()));
});

test('hourly count fields use nonnegative decimal integers', () => {
  rightCounts();
  const { rows } = readHourly();
  for (const row of rows) {
    assert.match(row.requests, /^\d+$/);
    assert.match(row.succeeded, /^\d+$/);
    assert.ok(Number(row.succeeded) <= Number(row.requests));
  }
});

test('totals JSON has exactly the requested keys', () => {
  rightCounts();
  assert.deepStrictEqual(Object.keys(readTotals()).sort(), ['requests', 'succeeded']);
});

test('totals JSON contains the fixture-derived counts', () => {
  assert.deepStrictEqual(readTotals(), expectedTotals());
});

test('totals equal the sums of the hourly CSV', () => {
  rightCounts();
  const sums = readHourly().rows.reduce(
    (totals, row) => ({
      requests: totals.requests + Number(row.requests),
      succeeded: totals.succeeded + Number(row.succeeded),
    }),
    { requests: 0, succeeded: 0 },
  );
  assert.deepStrictEqual(sums, readTotals());
});
