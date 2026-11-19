const test = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../src/logger');
const { createSmsProvider } = require('../src/providers/sms');
const { loadConfig } = require('../src/config');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const token = ['sms', 'live', 'runtime', 'token', '1234567890123456'].join('_');

test('SMS logging never includes the provider token', () => {
  const original = logger.debug;
  const calls = [];
  logger.debug = (...args) => calls.push(args);
  try { createSmsProvider({ token, transport: () => 'ok' }).send('+1', 'hello'); }
  finally { logger.debug = original; }
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(token));
});
test('configuration reads all three named environment variables', () => {
  const config = loadConfig({ NODE_ENV: 'production', PORT: '4040', SMS_API_TOKEN: 'env-token', DATABASE_URL: 'env-database', WEBHOOK_SIGNING_SECRET: 'env-webhook' });
  assert.equal(config.smsApiToken, 'env-token');
  assert.equal(config.databaseUrl, 'env-database');
  assert.equal(config.webhookSigningSecret, 'env-webhook');
});
function missing(name) {
  const env = { ...process.env, NODE_ENV: 'production', SMS_API_TOKEN: 'env-token', DATABASE_URL: 'env-database', WEBHOOK_SIGNING_SECRET: 'env-webhook' };
  delete env[name];
  return spawnSync(process.execPath, ['src/index.js'], { cwd: root, env, encoding: 'utf8', timeout: 1000 });
}
test('production refuses a missing SMS_API_TOKEN', () => {
  const result = missing('SMS_API_TOKEN');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SMS_API_TOKEN/);
  assert.doesNotMatch(result.stderr, /env-token/);
});
test('production refuses a missing DATABASE_URL', () => {
  const result = missing('DATABASE_URL');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL/);
  assert.doesNotMatch(result.stderr, /env-database/);
});
test('production refuses a missing WEBHOOK_SIGNING_SECRET', () => {
  const result = missing('WEBHOOK_SIGNING_SECRET');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WEBHOOK_SIGNING_SECRET/);
  assert.doesNotMatch(result.stderr, /env-webhook/);
});
