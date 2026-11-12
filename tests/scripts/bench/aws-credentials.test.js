// SPDX-License-Identifier: Apache-2.0
// Tests for the per-launch credential export (scripts/bench/lib/aws-credentials.js). No AWS call: the process
// runner is a stub that records what it was given and prints made-up values.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const creds = require('../../../scripts/bench/lib/aws-credentials');
const { classifyError } = require('../../../scripts/bench/lib/retry');

const EXPORTED = Object.freeze({
  Version: 1,
  AccessKeyId: 'ASIA' + 'EXAMPLEFIXTURE02',
  SecretAccessKey: 'fixture-secret-' + 'exported',
  SessionToken: 'fixture-session-' + 'exported',
  Expiration: '2030-01-01T12:00:00+00:00',
});

/** A stub for proc.run that records each call and answers with `respond()`. */
function stubRun(respond = () => ({ stdout: JSON.stringify(EXPORTED) })) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    return {
      code: 0,
      stdout: '',
      stderr: '',
      ms: 3,
      timedOut: false,
      overflow: false,
      ...respond(),
    };
  };
  return { run, calls };
}

test('exportCredentials runs aws configure export-credentials for the profile and returns the three values', async () => {
  const { run, calls } = stubRun();
  const result = await creds.exportCredentials({
    profile: 'bench-role',
    region: 'us-west-2',
    run,
    baseEnv: {
      PATH: '/usr/bin',
      HOME: '/nonexistent-home',
      AWS_ACCESS_KEY_ID: 'stray-parent-key',
      AWS_PROFILE: 'other-profile',
    },
  });
  assert.deepEqual(result, {
    accessKeyId: EXPORTED.AccessKeyId,
    secretAccessKey: EXPORTED.SecretAccessKey,
    sessionToken: EXPORTED.SessionToken,
    expiration: EXPORTED.Expiration,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'aws');
  assert.deepEqual(calls[0].args, [
    'configure',
    'export-credentials',
    '--profile',
    'bench-role',
    '--format',
    'process',
  ]);
  // The aws command reads the named profile, never a stray key from the parent shell.
  const env = calls[0].options.env;
  assert.equal(env.AWS_PROFILE, 'bench-role');
  assert.ok(!('AWS_ACCESS_KEY_ID' in env));
  assert.equal(env.AWS_REGION, 'us-west-2');
});

test('exportCredentials: no Expiration gives null', async () => {
  const { Expiration: _dropped, ...withoutExpiry } = EXPORTED;
  const { run } = stubRun(() => ({ stdout: JSON.stringify(withoutExpiry) }));
  const result = await creds.exportCredentials({ profile: 'p', run });
  assert.equal(result.expiration, null);
});

test('exportCredentials refuses long-term keys, a failed command and output that is not the expected JSON', async () => {
  const refused = async (respond, pattern) => {
    const { run } = stubRun(respond);
    await assert.rejects(
      creds.exportCredentials({ profile: 'p', run }),
      (error) => {
        assert.ok(error instanceof creds.CredentialError);
        assert.equal(error.fatal, true);
        assert.match(error.message, pattern);
        // The exported values are never quoted in an error.
        for (const value of [EXPORTED.SecretAccessKey, EXPORTED.SessionToken])
          assert.ok(!error.message.includes(value));
        return true;
      },
    );
  };
  const { SessionToken: _token, ...longTerm } = EXPORTED;
  await refused(
    () => ({ stdout: JSON.stringify(longTerm) }),
    /long-term keys \(no session token\)/,
  );
  await refused(
    () => ({ stdout: JSON.stringify({ ...EXPORTED, SessionToken: '' }) }),
    /long-term keys/,
  );
  await refused(
    () => ({
      code: 255,
      stdout: JSON.stringify(EXPORTED),
      stderr: 'The SSO session associated with this profile has expired',
    }),
    /could not load credentials for profile p: exit 255: The SSO session/,
  );
  await refused(
    () => ({ code: -1, timedOut: true }),
    /export-credentials timed out/,
  );
  await refused(
    () => ({ stdout: `not json ${EXPORTED.SecretAccessKey}` }),
    /did not print the expected JSON/,
  );
  await refused(
    () => ({ stdout: JSON.stringify({ ...EXPORTED, AccessKeyId: 7 }) }),
    /did not print the expected JSON/,
  );
  await refused(
    () => ({ stdout: JSON.stringify({ ...EXPORTED, SecretAccessKey: '' }) }),
    /did not print the expected JSON/,
  );
  await refused(() => ({ stdout: 'null' }), /did not print the expected JSON/);
  await refused(() => ({ stdout: '42' }), /did not print the expected JSON/);
  await refused(
    () => ({ stdout: '"a string"' }),
    /did not print the expected JSON/,
  );
});

test('exportCredentials redacts the stderr of a failed command before it goes into the error', async () => {
  const keyId = 'ASIA' + 'EXAMPLEFIXTURE04';
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCY' + 'FIXTUREKEY0123456789';
  const { run } = stubRun(() => ({
    code: 255,
    stderr: `denied for ${keyId}: aws_secret_access_key=${secret}`,
  }));
  await assert.rejects(
    creds.exportCredentials({ profile: 'p', run }),
    (error) => {
      assert.ok(error instanceof creds.CredentialError);
      assert.match(error.message, /exit 255: denied for /);
      assert.ok(!error.message.includes(keyId));
      assert.ok(!error.message.includes(secret));
      assert.match(error.message, /\[REDACTED_AWS_KEY_ID\]/);
      return true;
    },
  );
});

test('exportCredentials gives the command a time limit of 60 s, or the one it is passed', async () => {
  const { run, calls } = stubRun();
  await creds.exportCredentials({ profile: 'p', run });
  await creds.exportCredentials({ profile: 'p', run, timeoutMs: 1234 });
  assert.deepEqual(
    calls.map((call) => call.options.timeoutMs),
    [60000, 1234],
  );
});

test('exportCredentials refuses a profile name that could be read as a flag', async () => {
  const { run, calls } = stubRun();
  for (const profile of ['', '-x', '--profile', 'a b', 'a\nb', undefined])
    await assert.rejects(
      creds.exportCredentials({ profile, run }),
      creds.CredentialError,
    );
  assert.equal(calls.length, 0, 'no command runs for a bad profile name');
});

test('resolveProfile: aws_profile first, then AWS_PROFILE, else a credential error', () => {
  assert.equal(
    creds.resolveProfile(
      { aws_profile: 'from-config' },
      { AWS_PROFILE: 'env' },
    ),
    'from-config',
  );
  assert.equal(
    creds.resolveProfile({ aws_profile: null }, { AWS_PROFILE: 'env' }),
    'env',
  );
  assert.throws(
    () => creds.resolveProfile({ aws_profile: null }, {}),
    /no AWS profile is named/,
  );
  assert.throws(
    () => creds.resolveProfile({ aws_profile: '-bad' }, {}),
    /not a plain profile name/,
  );
});

test('assertFresh refuses a launch within 3 minutes of expiry, and an expiry it cannot read', () => {
  const now = () => Date.parse('2030-01-01T12:00:00Z');
  const at = (minutes) => new Date(now() + minutes * 60000).toISOString();
  assert.equal(creds.EXPIRY_MARGIN_MS, 180000);
  assert.doesNotThrow(() => creds.assertFresh({ expiration: at(3) }, { now }));
  assert.doesNotThrow(() => creds.assertFresh({ expiration: at(60) }, { now }));
  assert.throws(
    () =>
      creds.assertFresh({ expiration: at(2.99) }, { now, label: 't1/with' }),
    (error) =>
      error instanceof creds.CredentialError &&
      /less than 3 minutes away, so t1\/with was not started/.test(
        error.message,
      ),
  );
  assert.throws(
    () => creds.assertFresh({ expiration: at(-1) }, { now }),
    creds.CredentialError,
  );
  assert.throws(
    () => creds.assertFresh({ expiration: 'soon' }, { now }),
    /cannot be read/,
  );
  assert.doesNotThrow(() => creds.assertFresh({ expiration: null }, { now }));
});

test('assertFresh takes the margin it is passed, so a launch can require the credentials to outlast its call', () => {
  const now = () => Date.parse('2030-01-01T12:00:00Z');
  const at = (minutes) => new Date(now() + minutes * 60000).toISOString();
  const margin = { now, marginMs: 5 * 60000 };
  assert.doesNotThrow(() => creds.assertFresh({ expiration: at(5) }, margin));
  assert.throws(
    () => creds.assertFresh({ expiration: at(4) }, margin),
    /less than 5 minutes away/,
  );
});

test('a CredentialError is fatal for the retry helper: it is never retried', () => {
  assert.equal(classifyError(new creds.CredentialError('x')), 'fatal');
});
