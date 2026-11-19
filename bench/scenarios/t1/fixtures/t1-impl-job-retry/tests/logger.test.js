const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/logger');

test('logger writes structured JSON at the selected level', () => {
  const lines = [];
  const logger = createLogger('info', { log: line => lines.push(line), error: line => lines.push(line) });
  logger.info('started', { jobId: 'x' });
  logger.debug('hidden');
  assert.equal(lines.length, 1);
  const item = JSON.parse(lines[0]);
  assert.equal(item.message, 'started');
  assert.equal(item.jobId, 'x');
});
