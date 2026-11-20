'use strict';

// The 2025-03-18 retry storm: the client waited backoff/1000 ms, so retries fired almost at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpClient } = require('../src/shared-http-client');

function recordingClock() {
  const waits = [];
  return { waits, now: () => 0, setTimeout: (fn, ms) => { waits.push(ms); fn(); return 1; }, clearTimeout() {} };
}

test('a 503 waits the full base delay in milliseconds before retrying', async () => {
  const clock = recordingClock();
  const statuses = [503, 503, 200];
  const client = createHttpClient({ clock, jitterRatio: 0, baseDelayMs: 400, transport: async () => ({ status: statuses.shift(), headers: {} }) });
  const response = await client.request({ method: 'POST', url: '/orders' });
  assert.equal(response.status, 200);
  assert.deepEqual(clock.waits, [400, 800]);
});
