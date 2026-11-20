'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommandLine, resolveOption, showConfiguration } = require('../src/cli');
const { DEFAULTS } = require('../src/config');

test('command line parser accepts repeated tags', () => {
  const result = parseCommandLine(['sync', '--tag', 'a', '--tag', 'b']);
  assert.deepEqual(result.values.tag, ['a', 'b']);
  assert.equal(result.positionals[0], 'sync');
});

test('command line parser accepts --show-config', () => {
  const result = parseCommandLine(['sync', '--show-config']);
  assert.equal(result.values['show-config'], true);
});

test('command line parser accepts --no-dry-run', () => {
  const result = parseCommandLine(['sync', '--no-dry-run']);
  assert.equal(result.values['no-dry-run'], true);
});

test('resolveOption prefers CLI over environment', () => {
  const cliValues = { bucket: 'cli-bucket' };
  const envResolved = { values: { bucket: 'env-bucket' } };
  const configValues = { bucket: 'config-bucket' };
  
  const result = resolveOption('bucket', cliValues, envResolved, configValues, DEFAULTS);
  assert.equal(result.value, 'cli-bucket');
  assert.equal(result.source, 'command line');
});

test('resolveOption prefers environment over config', () => {
  const cliValues = {};
  const envResolved = { values: { bucket: 'env-bucket' } };
  const configValues = { bucket: 'config-bucket' };
  
  const result = resolveOption('bucket', cliValues, envResolved, configValues, DEFAULTS);
  assert.equal(result.value, 'env-bucket');
  assert.equal(result.source, 'environment');
});

test('resolveOption prefers config over defaults', () => {
  const cliValues = {};
  const envResolved = { values: {} };
  const configValues = { bucket: 'config-bucket' };
  
  const result = resolveOption('bucket', cliValues, envResolved, configValues, DEFAULTS);
  assert.equal(result.value, 'config-bucket');
  assert.equal(result.source, 'config');
});

test('resolveOption uses defaults when nothing else provides value', () => {
  const cliValues = {};
  const envResolved = { values: {} };
  const configValues = {};
  
  const result = resolveOption('bucket', cliValues, envResolved, configValues, DEFAULTS);
  assert.equal(result.value, 'local');
  assert.equal(result.source, 'default');
});

test('resolveOption handles --no-dry-run', () => {
  const cliValues = { 'no-dry-run': true };
  const result = resolveOption('dryRun', cliValues, { values: {} }, {}, DEFAULTS);
  assert.equal(result.value, false);
  assert.equal(result.source, 'command line');
});
