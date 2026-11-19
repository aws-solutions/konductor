const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../src/scheduler');

test('runs a scheduled callback', async () => {
  let runs = 0;
  const scheduler = new Scheduler(() => { runs += 1; });
  scheduler.start(8);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(runs, 1);
  assert.equal(scheduler.isRunning(), false);
});

test('does not start twice and can stop', () => {
  const scheduler = new Scheduler(() => {});
  assert.equal(scheduler.start(100), true);
  assert.equal(scheduler.start(100), false);
  scheduler.stop();
  assert.equal(scheduler.isRunning(), false);
});
