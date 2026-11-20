// Changes for this request; see the commit message for the reasoning.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../src/scheduler');

test('runs a scheduled callback', async () => {
  let runs = 0;
  const completed = new Promise(resolve => {
    const scheduler = new Scheduler(() => {
      runs += 1;
      resolve(scheduler);
    });
    scheduler.start(0);
  });
  const scheduler = await completed;
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
