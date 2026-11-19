const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loads environment values into configuration', () => {
  const config = loadConfig({ NODE_ENV: 'test', PORT: '4040', SMS_API_TOKEN: 'abc', DATABASE_URL: 'local', WEBHOOK_SIGNING_SECRET: 'xyz' });
  assert.equal(config.port, 4040);
  assert.equal(config.smsApiToken, 'abc');
  assert.equal(config.databaseUrl, 'local');
});

test('development has usable defaults', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development' }).host, '127.0.0.1');
});
