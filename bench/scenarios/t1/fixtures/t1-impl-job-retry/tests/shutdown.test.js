const test = require('node:test');
const assert = require('node:assert/strict');
const { installShutdown } = require('../src/shutdown');

test('shutdown installer returns a cleanup function', () => {
  const runner = { stop() { this.stopped = true; } };
  const cleanup = installShutdown(runner, []);
  assert.equal(typeof cleanup, 'function');
  cleanup();
});
