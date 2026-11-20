'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  optionToEnvName,
  parseEnvBoolean,
  parseEnvInteger,
  parseEnvTags,
  resolveEnvValues
} = require('../src/env');

test('optionToEnvName converts hyphens to underscores and uppercases', () => {
  assert.equal(optionToEnvName('dry-run'), 'DRY_RUN');
  assert.equal(optionToEnvName('show-config'), 'SHOW_CONFIG');
  assert.equal(optionToEnvName('bucket'), 'BUCKET');
});

test('parseEnvBoolean accepts valid values', () => {
  assert.equal(parseEnvBoolean('true', 'TEST'), true);
  assert.equal(parseEnvBoolean('false', 'TEST'), false);
  assert.equal(parseEnvBoolean('1', 'TEST'), true);
  assert.equal(parseEnvBoolean('0', 'TEST'), false);
  assert.equal(parseEnvBoolean('yes', 'TEST'), true);
  assert.equal(parseEnvBoolean('no', 'TEST'), false);
  assert.equal(parseEnvBoolean('TRUE', 'TEST'), true);
  assert.equal(parseEnvBoolean('Yes', 'TEST'), true);
});

test('parseEnvBoolean rejects invalid values', () => {
  assert.throws(
    () => parseEnvBoolean('invalid', 'TEST_VAR'),
    /Invalid value for TEST_VAR: must be true, false, 1, 0, yes, or no/
  );
});

test('parseEnvInteger accepts positive integers', () => {
  assert.equal(parseEnvInteger('1', 'TEST'), 1);
  assert.equal(parseEnvInteger('10', 'TEST'), 10);
  assert.equal(parseEnvInteger('100', 'TEST'), 100);
});

test('parseEnvInteger rejects invalid values', () => {
  assert.throws(
    () => parseEnvInteger('0', 'TEST_VAR'),
    /Invalid value for TEST_VAR: must be a positive integer/
  );
  assert.throws(
    () => parseEnvInteger('-1', 'TEST_VAR'),
    /Invalid value for TEST_VAR: must be a positive integer/
  );
  assert.throws(
    () => parseEnvInteger('abc', 'TEST_VAR'),
    /Invalid value for TEST_VAR: must be a positive integer/
  );
});

test('parseEnvTags splits comma-separated values', () => {
  assert.deepEqual(parseEnvTags('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseEnvTags('team=ops,env=prod'), ['team=ops', 'env=prod']);
  assert.deepEqual(parseEnvTags('single'), ['single']);
  assert.deepEqual(parseEnvTags('a, b, c'), ['a', 'b', 'c']);
});

test('resolveEnvValues uses custom prefix', () => {
  const original = process.env.MYAPP_BUCKET;
  process.env.MYAPP_BUCKET = 'custom-bucket';
  
  try {
    const result = resolveEnvValues({ envPrefix: 'MYAPP_' });
    assert.equal(result.values['bucket'], 'custom-bucket');
    assert.equal(result.sources['bucket'], 'environment');
  } finally {
    if (original === undefined) delete process.env.MYAPP_BUCKET;
    else process.env.MYAPP_BUCKET = original;
  }
});

test('resolveEnvValues treats empty string as unset', () => {
  const original = process.env.SYNCER_BUCKET;
  process.env.SYNCER_BUCKET = '';
  
  try {
    const result = resolveEnvValues({});
    assert.equal(result.values['bucket'], undefined);
  } finally {
    if (original === undefined) delete process.env.SYNCER_BUCKET;
    else process.env.SYNCER_BUCKET = original;
  }
});
