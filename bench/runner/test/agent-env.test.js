// SPDX-License-Identifier: Apache-2.0
'use strict';

// Core applies the env rules after any harness env() (FW-5, DEBT D-199): a harness, built in or a plugin, cannot put a
// credential the bench did not ask for into the agent's environment by returning it from env().

const test = require('node:test');
const assert = require('node:assert/strict');
const { agentEnv } = require('../lib/env.js');
const { HARNESSES } = require('../lib/harness/index.js');

const ARGS = { arm: { vanilla: false }, config: { model: 'm', agentEngine: 'v2' }, ctx: { envKeep: [] }, home: '/h', tmpdir: '/h/tmp' };

test('a fake harness whose env() returns AWS_SECRET_ACCESS_KEY runs without it', () => {
  const fake = { id: 'fake', env: () => ({ PATH: '/usr/bin', HOME: '/h', AWS_SECRET_ACCESS_KEY: 'leak', AWS_ACCESS_KEY_ID: 'AKIA', GITHUB_TOKEN: 'g', AWS_REGION: 'us-east-1' }) };
  const { env, dropped } = agentEnv(fake, ARGS);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.AWS_REGION, 'us-east-1');
  assert.equal(env.PATH, '/usr/bin');
  assert.deepEqual(dropped, ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN']);
});

test('a credential name passes only when the harness declares it in credentialEnv', () => {
  const fake = { id: 'fake', credentialEnv: ['AWS_SECRET_ACCESS_KEY'], env: () => ({ AWS_SECRET_ACCESS_KEY: 's', AWS_SESSION_TOKEN: 't' }) };
  const { env, dropped } = agentEnv(fake, ARGS);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, 's');
  assert.deepEqual(dropped, ['AWS_SESSION_TOKEN']);
});

test('NEVER_PASS names are dropped even when declared or kept', () => {
  const fake = { id: 'fake', credentialEnv: ['KIRO_SESSION_ID'], env: () => ({ KIRO_SESSION_ID: 'x', X_KIRO_MANDATORY_MCPS: 'y' }) };
  const { env, dropped } = agentEnv(fake, { ...ARGS, ctx: { envKeep: ['X_KIRO_MANDATORY_MCPS'] } });
  assert.deepEqual(env, {});
  assert.deepEqual(dropped, ['KIRO_SESSION_ID', 'X_KIRO_MANDATORY_MCPS']);
});

test('an --env-keep name passes even when it looks like a credential', () => {
  const fake = { id: 'fake', env: () => ({ KIRO_API_KEY: 'k' }) };
  assert.equal(agentEnv(fake, { ...ARGS, ctx: { envKeep: ['KIRO_API_KEY'] } }).env.KIRO_API_KEY, 'k');
});

test('every built-in harness keeps its whole env() under the core rules', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 's', AWS_SESSION_TOKEN: 't' });
  try {
    const ctx = { envKeep: [], awsProfile: 'bench', awsCreds: { current: () => ({ AWS_ACCESS_KEY_ID: 'A', AWS_SECRET_ACCESS_KEY: 'S', AWS_SESSION_TOKEN: 'T' }) } };
    for (const [id, h] of Object.entries(HARNESSES)) {
      const args = { ...ARGS, ctx };
      const { env, dropped } = agentEnv(h, args);
      assert.deepEqual(dropped, [], `${id} lost ${dropped.join(', ')}`);
      assert.deepEqual(env, h.env(args), id);
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
