// Changes for this request; see the commit message for the reasoning.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPicker, transition } = require('../src/date-range-picker');
const { validateBooking } = require('../src/validation');
const { formatPrice, currencyDigits } = require('../src/price');
const { debounce, retry } = require('../src/timing');
const { createStore } = require('../src/store');

function clockForDebounce() {
  let id = 0;
  const jobs = new Map();
  return {
    setTimeout(callback) { const key = ++id; jobs.set(key, callback); return key; },
    clearTimeout(key) { jobs.delete(key); },
    flush() { for (const [key, callback] of [...jobs]) { jobs.delete(key); callback(); } },
  };
}

test('next month from December crosses into January', () => {
  const result = transition(createPicker({ year: 2025, month: 12 }), { type: 'NEXT_MONTH' });
  assert.deepEqual({ year: result.visibleYear, month: result.visibleMonth }, { year: 2026, month: 1 });
});

test('previous month from January crosses into December', () => {
  const result = transition(createPicker({ year: 2025, month: 1 }), { type: 'PREVIOUS_MONTH' });
  assert.deepEqual({ year: result.visibleYear, month: result.visibleMonth }, { year: 2024, month: 12 });
});

test('year controls preserve the visible month', () => {
  let result = createPicker({ year: 2025, month: 2 });
  result = transition(result, { type: 'NEXT_YEAR' });
  result = transition(result, { type: 'PREVIOUS_YEAR' });
  assert.deepEqual({ year: result.visibleYear, month: result.visibleMonth }, { year: 2025, month: 2 });
});

test('a range cannot cross a disabled date in its interior', () => {
  let picker = createPicker({ year: 2025, month: 5, disabledRanges: [{ start: '2025-05-12', end: '2025-05-13' }] });
  picker = transition(picker, { type: 'SELECT_DATE', date: '2025-05-10' });
  const attempted = transition(picker, { type: 'SELECT_DATE', date: '2025-05-15' });
  assert.equal(attempted.startDate, '2025-05-10');
  assert.equal(attempted.endDate, null);
});

test('a note at the configured maximum length is valid', () => {
  const result = validateBooking({ name: 'Sam', email: 'sam@example.com', checkIn: '2025-05-01', checkOut: '2025-05-02', note: 'x'.repeat(12) }, { maxNoteLength: 12 });
  assert.equal(result.valid, true);
  assert.equal(result.errors.note, undefined);
});

test('date validation rejects non-padded month and day values', () => {
  const result = validateBooking({ name: 'Sam', email: 'sam@example.com', checkIn: '2025-5-01', checkOut: '2025-05-02' });
  assert.equal(result.errors.checkIn, 'Use YYYY-MM-DD for check-in');
  assert.equal(result.valid, false);
});

test('prices round fractional cents upward', () => {
  assert.equal(formatPrice(12.346, 'en-US', 'USD'), '$12.35');
});

test('zero-decimal currencies use their Intl currency precision', () => {
  assert.equal(currencyDigits('en-US', 'JPY'), 0);
  assert.equal(formatPrice(1234.56, 'en-US', 'JPY'), '¥1,235');
});

test('debounce keeps only the latest scheduled call', () => {
  const clock = clockForDebounce();
  const values = [];
  const update = debounce((value) => values.push(value), 50, clock);
  update('old');
  update('new');
  clock.flush();
  assert.deepEqual(values, ['new']);
});

test('debounce cancel prevents a pending call', () => {
  const clock = clockForDebounce();
  let calls = 0;
  const update = debounce(() => { calls += 1; }, 50, clock);
  update();
  update.cancel();
  clock.flush();
  assert.equal(calls, 0);
});

test('retry makes all allowed attempts before throwing', async () => {
  let attempts = 0;
  const immediateClock = { setTimeout(callback) { callback(); return 1; }, clearTimeout() {} };
  await assert.rejects(
    retry(async () => { attempts += 1; throw new Error('down'); }, { retries: 2 }, immediateClock),
    /down/,
  );
  assert.equal(attempts, 3);
});

test('unsubscribing during notification does not skip the current snapshot', () => {
  const store = createStore({ version: 1 });
  const events = [];
  let unsubscribeB;
  store.subscribe(() => { events.push('a'); unsubscribeB(); });
  unsubscribeB = store.subscribe(() => events.push('b'));
  store.setState({ version: 2 });
  assert.deepEqual(events, ['a', 'b']);
  events.length = 0;
  store.setState({ version: 3 });
  assert.deepEqual(events, ['a']);
});
