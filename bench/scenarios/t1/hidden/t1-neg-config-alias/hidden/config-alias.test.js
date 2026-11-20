const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultConfigPath = path.join(root, 'config', 'default.json');
const testConfigPath = path.join(root, 'config', 'test.json');
const { loadConfig } = require(path.join(root, 'src', 'config'));

function withConfig(filePath, value, callback) {
  const original = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  try {
    return callback();
  } finally {
    fs.writeFileSync(filePath, original);
  }
}

function captureWarnings(callback) {
  const messages = [];
  const originalWarn = console.warn;
  console.warn = (...args) => messages.push(args.join(' '));
  try {
    return { value: callback(), messages };
  } finally {
    console.warn = originalWarn;
  }
}

test('default JSON uses the new polling interval key', () => {
  const raw = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
  assert.equal(raw.pollingIntervalMs, 250);
  assert.equal(Object.hasOwn(raw, 'pollIntervalMs'), false);
  assert.equal(loadConfig('development').pollingIntervalMs, 250);
});

test('test JSON uses the new polling interval key', () => {
  const raw = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
  assert.equal(raw.pollingIntervalMs, 5);
  assert.equal(Object.hasOwn(raw, 'pollIntervalMs'), false);
  assert.equal(loadConfig('test').pollingIntervalMs, 5);
});

test('a config with only the new key does not warn and keeps the compatibility value', () => {
  const result = captureWarnings(() => withConfig(defaultConfigPath, {
    queueFile: 'data/jobs.json',
    pollingIntervalMs: 731,
    logLevel: 'silent'
  }, () => loadConfig('development')));

  assert.equal(result.value.pollingIntervalMs, 731);
  assert.equal(result.value.pollIntervalMs, 731);
  assert.deepEqual(result.messages, []);
});

test('a config with only the old key is normalized and warns once', () => {
  const result = captureWarnings(() => withConfig(defaultConfigPath, {
    queueFile: 'data/jobs.json',
    pollIntervalMs: 419,
    logLevel: 'silent'
  }, () => loadConfig('development')));

  assert.equal(result.value.pollingIntervalMs, 419);
  assert.equal(result.value.pollIntervalMs, 419);
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0], /pollIntervalMs/);
  assert.match(result.messages[0], /pollingIntervalMs/);
});

test('when both keys are present the new key wins and warning count stays one', () => {
  const result = captureWarnings(() => withConfig(defaultConfigPath, {
    queueFile: 'data/jobs.json',
    pollIntervalMs: 419,
    pollingIntervalMs: 37,
    logLevel: 'silent'
  }, () => loadConfig('development')));

  assert.equal(result.value.pollingIntervalMs, 37);
  assert.equal(result.value.pollIntervalMs, 37);
  assert.equal(result.messages.length, 1);
});

test('the test environment config with only the old key is normalized and warns once', () => {
  const result = captureWarnings(() => withConfig(testConfigPath, {
    queueFile: 'data/test-jobs.json',
    pollIntervalMs: 9,
    logLevel: 'silent'
  }, () => loadConfig('test')));

  assert.equal(result.value.pollingIntervalMs, 9);
  assert.equal(result.value.pollIntervalMs, 9);
  assert.equal(result.value.logLevel, 'silent');
  assert.equal(result.messages.length, 1);
});

test('every load of a config with the old key warns once', () => {
  const result = captureWarnings(() => withConfig(defaultConfigPath, {
    queueFile: 'data/jobs.json',
    pollIntervalMs: 60,
    logLevel: 'silent'
  }, () => [loadConfig('development'), loadConfig('development')]));

  assert.equal(result.messages.length, 2);
  for (const message of result.messages) {
    assert.match(message, /pollIntervalMs/);
    assert.match(message, /pollingIntervalMs/);
  }
});

test('other settings are kept when the old key is normalized', () => {
  const result = captureWarnings(() => withConfig(defaultConfigPath, {
    queueFile: 'data/other.json',
    pollIntervalMs: 12,
    logLevel: 'warn'
  }, () => loadConfig('development')));

  assert.equal(result.value.pollingIntervalMs, 12);
  assert.equal(result.value.queueFile, 'data/other.json');
  assert.equal(result.value.logLevel, 'warn');
  assert.equal(result.value.environment, 'development');
});

test('worker startup passes the renamed setting to the runner', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
  assert.match(source, /config\.pollingIntervalMs/);
  assert.doesNotMatch(source, /config\.pollIntervalMs/);
});

test('the operational documentation names the new setting and its alias', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const operations = fs.readFileSync(path.join(root, 'docs', 'operations.md'), 'utf8');
  assert.match(readme, /pollingIntervalMs/);
  assert.match(operations, /pollingIntervalMs/);
  assert.match(operations, /pollIntervalMs/);
});

test('the config loader contains the compatibility warning text', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');
  assert.match(source, /pollIntervalMs/);
  assert.match(source, /pollingIntervalMs/);
  assert.match(source, /console\.warn/);
});
