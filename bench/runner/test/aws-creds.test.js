// SPDX-License-Identifier: Apache-2.0
'use strict';

// Claude Code keys read from a profile and read again before they expire. A fake `aws` stands in; no AWS call is made.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { profileCredentials, exportCredentials, parseProcessCredentials } = require('../lib/aws-creds.js');
const cc = require('../../plugins/claude-code/harness.js');

const PROFILE = 'bench';
const json = (id, secret, token, expiresAt) => JSON.stringify({ Version: 1, AccessKeyId: id, SecretAccessKey: secret, SessionToken: token, ...(expiresAt ? { Expiration: new Date(expiresAt).toISOString() } : {}) });

test('the process-format JSON gives the three variables and the expiry, and a bad answer names no value', () => {
  const t = Date.parse('2030-01-01T00:00:00Z');
  assert.deepEqual(parseProcessCredentials(json('AKIDFAKE0001', 'fakeSecret0001xxxx', 'fakeToken0001xxxx', t), PROFILE), {
    vars: { AWS_ACCESS_KEY_ID: 'AKIDFAKE0001', AWS_SECRET_ACCESS_KEY: 'fakeSecret0001xxxx', AWS_SESSION_TOKEN: 'fakeToken0001xxxx' }, expiresAt: t,
  });
  assert.equal(parseProcessCredentials(JSON.stringify({ AccessKeyId: 'AKIDFAKE0002', SecretAccessKey: 'fakeSecret0002xxxx' }), PROFILE).expiresAt, null);
  assert.throws(() => parseProcessCredentials('not json', PROFILE), /did not print JSON/);
  assert.throws(() => parseProcessCredentials(JSON.stringify({ AccessKeyId: 'AKIDFAKE0003' }), PROFILE), (e) => !e.message.includes('AKIDFAKE0003') && /no access key pair/.test(e.message));
});

test('the profile is read once, kept while it is valid, and read again inside 15 minutes of expiry', () => {
  let now = Date.parse('2030-01-01T00:00:00Z');
  const reads = [];
  const answers = [json('AKIDFAKE0001', 'fakeSecret0001xxxx', 'fakeToken0001xxxx', now + 90 * 60000), json('AKIDFAKE0002', 'fakeSecret0002xxxx', 'fakeToken0002xxxx', now + 180 * 60000)];
  const creds = profileCredentials(PROFILE, { read: (p) => { reads.push(p); return answers[reads.length - 1]; }, now: () => now });
  assert.equal(creds.current().AWS_SECRET_ACCESS_KEY, 'fakeSecret0001xxxx');
  now += 60 * 60000; // 30 minutes left
  assert.equal(creds.current().AWS_SECRET_ACCESS_KEY, 'fakeSecret0001xxxx');
  assert.equal(reads.length, 1);
  now += 20 * 60000; // 10 minutes left
  assert.equal(creds.current().AWS_SECRET_ACCESS_KEY, 'fakeSecret0002xxxx');
  assert.deepEqual(reads, [PROFILE, PROFILE]);
  assert.equal(creds.refreshes(), 2);
  assert.deepEqual(creds.values().sort(), ['AKIDFAKE0001', 'AKIDFAKE0002', 'fakeSecret0001xxxx', 'fakeSecret0002xxxx', 'fakeToken0001xxxx', 'fakeToken0002xxxx'].sort());
});

test('keys with no expiry are read before every run, and keys that expire too soon stop the run', () => {
  let n = 0;
  const creds = profileCredentials(PROFILE, { read: () => JSON.stringify({ AccessKeyId: `AKIDFAKE000${++n}`, SecretAccessKey: 'fakeSecretNoExpiry' }) });
  creds.current();
  creds.current();
  assert.equal(n, 2);
  const now = Date.now();
  const soon = profileCredentials(PROFILE, { read: () => json('AKIDFAKE0009', 'fakeSecret0009xxxx', 'fakeToken0009xxxx', now + 5 * 60000), now: () => now });
  assert.throws(() => soon.current(), (e) => /expire in 5 minute/.test(e.message) && !e.message.includes('fakeSecret0009'));
  assert.throws(() => profileCredentials(''), /--aws-profile needs a profile name/);
  assert.throws(() => profileCredentials('a b'), /--aws-profile needs a profile name/);
});

test('exportCredentials runs aws with the profile and without the caller\'s own AWS keys or profile variables', () => {
  const root = tmp();
  try {
    const seen = path.join(root, 'seen.json');
    const aws = path.join(root, 'aws');
    write(aws, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), keys: Object.keys(process.env) }));\nprocess.stdout.write(${JSON.stringify(json('AKIDFAKE0004', 'fakeSecret0004xxxx', 'fakeToken0004xxxx'))});\n`);
    fs.chmodSync(aws, 0o755);
    const out = exportCredentials(PROFILE, { awsBin: aws, baseEnv: { PATH: process.env.PATH, AWS_ACCESS_KEY_ID: 'AKIDOLD', AWS_SECRET_ACCESS_KEY: 'old', AWS_PROFILE: 'other', HOME: root } });
    assert.equal(JSON.parse(out).AccessKeyId, 'AKIDFAKE0004');
    const s = JSON.parse(fs.readFileSync(seen, 'utf8'));
    assert.deepEqual(s.args, ['configure', 'export-credentials', '--profile', PROFILE, '--format', 'process']);
    for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE']) assert.equal(s.keys.includes(k), false, k);
    write(aws, '#!/bin/sh\necho "The config profile (bench) could not be found" >&2\nexit 255\n');
    assert.throws(() => exportCredentials(PROFILE, { awsBin: aws }), /export-credentials --profile bench failed: The config profile \(bench\) could not be found/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a Claude Code run gets the profile keys in its environment, replacing the caller\'s, and they count as secrets', () => {
  const awsCreds = profileCredentials(PROFILE, { read: () => JSON.stringify({ AccessKeyId: 'AKIDFAKE0005', SecretAccessKey: 'fakeSecret0005xxxx', SessionToken: 'fakeToken0005xxxx' }) });
  const env = cc.env({ arm: { vanilla: true }, ctx: { awsCreds }, home: '/h', tmpdir: '/h/tmp', baseEnv: { PATH: '/bin', AWS_ACCESS_KEY_ID: 'AKIDCALLER', AWS_SECRET_ACCESS_KEY: 'callerSecret' } });
  assert.equal(env.AWS_ACCESS_KEY_ID, 'AKIDFAKE0005');
  assert.equal(env.AWS_SECRET_ACCESS_KEY, 'fakeSecret0005xxxx');
  assert.equal(env.AWS_SESSION_TOKEN, 'fakeToken0005xxxx');
  assert.ok(cc.secrets({ awsCreds }).includes('fakeSecret0005xxxx'));
  assert.equal(cc.env({ arm: { vanilla: true }, ctx: {}, home: '/h', tmpdir: '/h/tmp', baseEnv: { AWS_ACCESS_KEY_ID: 'AKIDCALLER', AWS_SECRET_ACCESS_KEY: 'callerSecret' } }).AWS_ACCESS_KEY_ID, 'AKIDCALLER', 'without a profile the environment is used, as before');
  const rec = cc.runConfigRecord({ ctx: { claude: { bin: '/x/claude', version: '1', sha256: 'a', supportsHookEvents: false }, awsCreds }, config: { model: 'm' }, region: 'us-east-1' });
  assert.equal(rec.credentials.profile, PROFILE);
  assert.equal(JSON.stringify(rec).includes('fakeSecret0005'), false, 'run-config never holds a value');
});

test('run --aws-profile and judge --aws-export-profile share one export and one parser', async () => {
  const { awsExport, makeExportedCredentials, parseExport, isProfileName } = require('../lib/aws-creds.js');
  const root = tmp();
  try {
    const seen = path.join(root, 'seen.json');
    const aws = path.join(root, 'aws');
    write(aws, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), keys: Object.keys(process.env) }));\nprocess.stdout.write(${JSON.stringify(json('AKIDFAKE0006', 'fakeSecret0006xxxx', 'fakeToken0006xxxx'))});\n`);
    fs.chmodSync(aws, 0o755);
    const base = { PATH: process.env.PATH, AWS_SECRET_ACCESS_KEY: 'old', AWS_DEFAULT_PROFILE: 'other', HOME: root };
    const syncOut = exportCredentials(PROFILE, { awsBin: aws, baseEnv: base });
    const syncSeen = JSON.parse(fs.readFileSync(seen, 'utf8'));
    const asyncOut = await awsExport(PROFILE, { awsBin: aws, baseEnv: base });
    const asyncSeen = JSON.parse(fs.readFileSync(seen, 'utf8'));
    assert.equal(syncOut, asyncOut);
    assert.deepEqual(asyncSeen, syncSeen, 'both paths run aws with the same arguments and the same stripped environment');
    for (const k of ['AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_PROFILE']) assert.equal(asyncSeen.keys.includes(k), false, k);
    const judge = makeExportedCredentials({ profile: PROFILE, exporter: (p) => awsExport(p, { awsBin: aws, baseEnv: base }) });
    const run = profileCredentials(PROFILE, { read: (p) => exportCredentials(p, { awsBin: aws, baseEnv: base }) });
    const j = await judge.current();
    assert.deepEqual(run.current(), { AWS_ACCESS_KEY_ID: j.accessKeyId, AWS_SECRET_ACCESS_KEY: j.secretAccessKey, AWS_SESSION_TOKEN: j.sessionToken });
    assert.deepEqual(run.values().sort(), judge.secrets().sort());
    assert.throws(() => parseExport(JSON.stringify({ AccessKeyId: 'A', SecretAccessKey: 'B', Expiration: 'soon' })), /expiry that is not a date/);
    assert.equal(isProfileName('bench'), true);
    assert.equal(isProfileName('a b'), false);
    assert.equal(require('../lib/aws-creds.js').REFRESH_BEFORE_MS, undefined, 'no alias of REFRESH_WITHIN_MS (D-26)');
    assert.equal(exportCredentials.toString().includes('EXPORT_TIMEOUT_MS') && awsExport.toString().includes('EXPORT_TIMEOUT_MS'), true, 'both exports use one timeout (D-26)');
    write(aws, '#!/bin/sh\necho "The config profile (bench) could not be found" >&2\nexit 255\n');
    await assert.rejects(awsExport(PROFILE, { awsBin: aws }), /export-credentials --profile bench failed: The config profile \(bench\) could not be found/);
    write(aws, '#!/bin/sh\necho AKIDLEAKED0001\nexit 3\n');
    await assert.rejects(awsExport(PROFILE, { awsBin: aws }), (e) => /failed: exit 3/.test(e.message) && !e.message.includes('AKIDLEAKED'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
