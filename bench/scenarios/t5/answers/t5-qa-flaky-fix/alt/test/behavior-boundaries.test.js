// Changes for this request; see the commit message for the reasoning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const calendar = require('../src/calendar');
const { Outbox } = require('../src/outbox');
const { RateLimiter } = require('../src/rate-limiter');
const { newId } = require('../src/ids');
const { Scheduler } = require('../src/scheduler');

test('accepts the last valid minute of a day', () => {
  assert.deepEqual(calendar.ruleFromText('Monday 23:59'), { weekday: 'Monday', hour: 23, minute: 59 });
});

test('uses the requested time zone at a day boundary', () => {
  const instant = new Date('2026-04-05T00:30:00.000Z');
  assert.equal(calendar.weekdayFor(instant, 'America/Los_Angeles'), 'Saturday');
  assert.equal(calendar.weekdayFor(instant, 'UTC'), 'Sunday');
});

test('does not hide malformed outbox records', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daymark-mutant-'));
  try {
    fs.writeFileSync(path.join(directory, 'notifications.jsonl'), '{bad json}\n');
    await assert.rejects(() => new Outbox(directory).list(), SyntaxError);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('opens a new rate window at its boundary', () => {
  const limiter = new RateLimiter(1, 1000);
  assert.equal(limiter.allow('job', 5000), true);
  assert.equal(limiter.allow('job', 6000), true);
});

test('uses the full random range for identifiers', () => {
  const suffix = newId('job', () => 0.5).split('_').pop();
  assert.equal(suffix, Math.floor(0.5 * 0x100000000).toString(36).padStart(7, '0'));
});

test('stopping a scheduler prevents a queued callback', async () => {
  let runs = 0;
  const scheduler = new Scheduler(() => { runs += 1; });
  scheduler.start(1);
  scheduler.stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runs, 0);
});
