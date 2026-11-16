// SPDX-License-Identifier: Apache-2.0
// Tests for the child process environment (scripts/bench/lib/child-env.js). Pure: no process is started.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  childEnv,
  ALWAYS_DROP,
  CREDENTIAL_VARS,
} = require('../../../scripts/bench/lib/child-env');

test('with a profile: static keys, bearer tokens and ANTHROPIC/OPENCODE variables are dropped; the profile is explicit', () => {
  const base = {
    PATH: '/bin',
    HOME: '/h',
    AWS_CONFIG_FILE: '/c',
    AWS_SHARED_CREDENTIALS_FILE: '/s',
    AWS_ACCESS_KEY_ID: 'a',
    AWS_SECRET_ACCESS_KEY: 'b',
    AWS_SESSION_TOKEN: 'c',
    AWS_BEARER_TOKEN_BEDROCK: 'd',
    AWS_PROFILE: 'default',
    ANTHROPIC_API_KEY: 'e',
    ANTHROPIC_BASE_URL: 'http://x',
    OPENCODE_CONFIG: '/evil',
    CLAUDE_CODE_USE_VERTEX: '1',
    NODE_OPTIONS: '--require /x',
  };
  const env = childEnv({
    profile: 'bench',
    region: 'us-west-2',
    base,
    extra: { BENCH_EXTRA: '/r' },
  });
  assert.deepEqual(Object.keys(env).sort(), [
    'AWS_CONFIG_FILE',
    'AWS_DEFAULT_PROFILE',
    'AWS_DEFAULT_REGION',
    'AWS_EC2_METADATA_DISABLED',
    'AWS_PROFILE',
    'AWS_REGION',
    'AWS_SHARED_CREDENTIALS_FILE',
    'BENCH_EXTRA',
    'HOME',
    'PATH',
  ]);
  assert.equal(env.AWS_PROFILE, 'bench');
  assert.equal(env.AWS_DEFAULT_PROFILE, 'bench');
  assert.equal(env.AWS_EC2_METADATA_DISABLED, 'true');
  assert.equal(env.AWS_REGION, 'us-west-2');
  assert.equal(env.AWS_DEFAULT_REGION, 'us-west-2');
});

test('without a profile (the judge path): ambient credentials are kept, but ANTHROPIC/OPENCODE overrides are not', () => {
  const env = childEnv({
    base: {
      PATH: '/bin',
      AWS_ACCESS_KEY_ID: 'a',
      AWS_SESSION_TOKEN: 'c',
      AWS_BEARER_TOKEN_BEDROCK: 'd',
      ANTHROPIC_API_KEY: 'e',
      OPENCODE_CONFIG: '/x',
      OPENAI_API_KEY: 'f',
    },
  });
  assert.equal(env.AWS_ACCESS_KEY_ID, 'a');
  assert.equal(env.AWS_SESSION_TOKEN, 'c');
  assert.equal(env.AWS_BEARER_TOKEN_BEDROCK, 'd');
  for (const name of ['ANTHROPIC_API_KEY', 'OPENCODE_CONFIG', 'OPENAI_API_KEY'])
    assert.ok(!(name in env), name);
  assert.ok(!('AWS_PROFILE' in env), 'no profile is invented');
  assert.ok(!('AWS_REGION' in env), 'no region is invented');
});

test('extra is set last and wins; an undefined value in the base is skipped', () => {
  const env = childEnv({
    base: { PATH: '/bin', EMPTY: undefined, OPENCODE_CONFIG: '/evil' },
    region: 'eu-west-1',
    extra: { OPENCODE_CONFIG: '/sandbox/opencode.json', AWS_REGION: 'x' },
  });
  assert.equal(env.OPENCODE_CONFIG, '/sandbox/opencode.json');
  assert.equal(env.AWS_REGION, 'x');
  assert.equal(env.AWS_DEFAULT_REGION, 'eu-west-1');
  assert.ok(!('EMPTY' in env));
});

test('the drop patterns are whole-name matches', () => {
  for (const name of [
    'NODE_OPTIONS',
    'BASH_ENV',
    'ENV',
    'CLAUDECODE',
    'OPENCODE_X',
  ])
    assert.ok(ALWAYS_DROP.test(name), name);
  for (const name of ['MY_NODE_OPTIONS', 'ENVIRONMENT', 'PATH'])
    assert.ok(!ALWAYS_DROP.test(name), name);
  for (const name of [
    'AWS_ACCESS_KEY_ID',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_PROFILE',
  ])
    assert.ok(CREDENTIAL_VARS.test(name), name);
  for (const name of ['AWS_REGION', 'AWS_CONFIG_FILE', 'MY_AWS_PROFILE'])
    assert.ok(!CREDENTIAL_VARS.test(name), name);
});

test('the default base is process.env', () => {
  const env = childEnv();
  assert.equal(env.PATH, process.env.PATH);
});

// The names are listed here, not read from CREDENTIAL_VARS, so removing one from the pattern fails this test.
const CREDENTIAL_NAMES = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_CREDENTIAL_EXPIRATION',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_ROLE_ARN',
  'AWS_ROLE_SESSION_NAME',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
];

test('every credential variable name is matched, and with a profile none of them reaches the child but the profile', () => {
  for (const name of CREDENTIAL_NAMES)
    assert.ok(CREDENTIAL_VARS.test(name), name);
  const base = Object.fromEntries(
    CREDENTIAL_NAMES.map((name) => [name, 'ambient']),
  );
  const env = childEnv({ profile: 'bench', base: { PATH: '/bin', ...base } });
  assert.deepEqual(
    Object.keys(env).sort(),
    ['AWS_DEFAULT_PROFILE', 'AWS_EC2_METADATA_DISABLED', 'AWS_PROFILE', 'PATH'],
    'every other credential source is removed',
  );
  assert.equal(env.AWS_PROFILE, 'bench');
  assert.equal(env.AWS_DEFAULT_PROFILE, 'bench');
});
