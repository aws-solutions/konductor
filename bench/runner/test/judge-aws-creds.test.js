// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { makeFakeOpencodeJudge } = require('./fake-opencode-judge.js');
const { sandbox, readJ } = require('./judge-backend-sandbox.js');
const { makeExportedCredentials, parseExport, credentialsText } = require('../lib/aws-creds.js');
const { makeOpencodeCaller } = require('../../plugins/opencode/judge.js');
const { checkArgs } = require('../lib/cli-flags.js');

const MIN = 60 * 1000;
const exported = (n, expiresAt) => JSON.stringify({ Version: 1, AccessKeyId: `ASIAEXPORTED000${n}`, SecretAccessKey: `exported-secret-${n}`, SessionToken: `exported-token-${n}`, Expiration: new Date(expiresAt).toISOString() });

// A clock and an exporter the test drives: each ask returns the next queued answer (a string, or an Error to throw).
function rig(answers) {
  let t = Date.parse('2026-11-17T12:00:00Z');
  const asked = [];
  const exporter = async (profile) => {
    asked.push({ profile, at: t });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(t) : a;
  };
  const logs = [];
  const creds = makeExportedCredentials({ profile: 'dev', exporter, now: () => t, log: (m) => logs.push(m) });
  return { creds, asked, logs, now: () => t, advance: (ms) => { t += ms; } };
}

test('credentials are read once and not asked for again while more than 15 minutes remain', async () => {
  const start = Date.parse('2026-11-17T12:00:00Z');
  const r = rig([exported(1, start + 60 * MIN)]);
  assert.equal((await r.creds.current()).accessKeyId, 'ASIAEXPORTED0001');
  r.advance(40 * MIN);
  await r.creds.current();
  assert.equal(r.asked.length, 1);
  assert.deepEqual(r.asked.map((a) => a.profile), ['dev']);
});

test('near expiry they are asked for again, and a later expiry replaces them', async () => {
  const start = Date.parse('2026-11-17T12:00:00Z');
  const r = rig([exported(1, start + 60 * MIN), exported(2, start + 120 * MIN)]);
  await r.creds.current();
  r.advance(50 * MIN);
  const c = await r.creds.current();
  assert.equal(c.accessKeyId, 'ASIAEXPORTED0002');
  assert.equal(r.asked.length, 2);
  assert.match(r.logs.join('\n'), /refreshed, expire in 70 min/);
});

test('a refresh that brings the same expiry keeps the current values and asks again a minute later, until a newer one comes', async () => {
  const start = Date.parse('2026-11-17T12:00:00Z');
  const same = exported(1, start + 60 * MIN);
  const r = rig([same, same, same, exported(2, start + 120 * MIN)]);
  await r.creds.current();
  r.advance(50 * MIN);
  assert.equal((await r.creds.current()).accessKeyId, 'ASIAEXPORTED0001');
  r.advance(20 * 1000);
  await r.creds.current();
  assert.equal(r.asked.length, 2, 'not asked again within the minute');
  r.advance(45 * 1000);
  assert.equal((await r.creds.current()).accessKeyId, 'ASIAEXPORTED0001');
  assert.equal(r.asked.length, 3);
  r.advance(61 * 1000);
  assert.equal((await r.creds.current()).accessKeyId, 'ASIAEXPORTED0002');
  assert.match(r.logs.join('\n'), /gave the same expiry/);
});

test('a failed refresh keeps valid credentials; only expired ones with nothing newer stop the pass', async () => {
  const start = Date.parse('2026-11-17T12:00:00Z');
  const r = rig([exported(1, start + 60 * MIN), new Error('aws configure export-credentials --profile dev failed (exit 255)')]);
  await r.creds.current();
  r.advance(50 * MIN);
  assert.equal((await r.creds.current()).accessKeyId, 'ASIAEXPORTED0001');
  assert.match(r.logs.join('\n'), /refresh failed: .*exit 255.*keeping the current ones/);
  r.advance(11 * MIN);
  await assert.rejects(r.creds.current(), /have expired and aws configure export-credentials gave no newer ones/);
});

test('no log line and no error carries a credential value; every value seen is offered for scrubbing', async () => {
  const start = Date.parse('2026-11-17T12:00:00Z');
  const r = rig([exported(1, start + 60 * MIN), exported(2, start + 120 * MIN)]);
  await r.creds.current();
  r.advance(50 * MIN);
  await r.creds.current();
  for (const v of ['exported-secret-1', 'exported-token-1', 'exported-secret-2', 'ASIAEXPORTED0002']) {
    assert.ok(r.creds.secrets().includes(v), v);
    assert.doesNotMatch(r.logs.join('\n'), new RegExp(v));
  }
  assert.throws(() => parseExport('{"AccessKeyId":"A"}'), (e) => /no access key pair/.test(e.message) && !/"A"/.test(e.message));
  assert.match(credentialsText('bench', { accessKeyId: 'K', secretAccessKey: 'S', sessionToken: null }), /^\[bench\]\naws_access_key_id = K\naws_secret_access_key = S\n$/);
});

// ---- the opencode caller ----

function callerSetup(config) {
  const root = tmp();
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch);
  const fake = makeFakeOpencodeJudge(path.join(root, 'bin'), { dir: path.join(root, 'calls'), ...config });
  const calls = () => (fs.existsSync(path.join(root, 'calls')) ? fake.calls() : []);
  return { root, scratch, fake, calls, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const PROMPT = 'Grade.\n- id: c1\nReply with JSON.';

test('the caller writes the exported credentials into the call\'s own HOME under the judge profile', async () => {
  const s = callerSetup({ mode: 'good' });
  try {
    const credentials = makeExportedCredentials({ profile: 'dev', exporter: async () => exported(1, Date.now() + 60 * MIN) });
    const caller = makeOpencodeCaller({ bin: s.fake.file, credentials, awsProfile: 'bench', region: 'us-east-1', timeoutMs: 20000, scratchRoot: s.scratch });
    const r = await caller({ model: 'glm-5', prompt: PROMPT });
    assert.equal(r.error, undefined);
    assert.deepEqual(s.calls()[0].credHeaders, ['[bench]']);
    assert.equal(caller.stopReason(), null);
  } finally { s.cleanup(); }
});

test('three calls in a row whose credentials are rejected stop the caller; a good call in between resets the count', async () => {
  const s = callerSetup({ modes: ['auth', 'good', 'auth', 'auth', 'auth', 'good'] });
  try {
    const creds = path.join(s.root, 'creds');
    fs.writeFileSync(creds, '[bench]\naws_access_key_id = AKIATESTSECRET0001\naws_secret_access_key = SECRETVALUE-xyz\n');
    const caller = makeOpencodeCaller({ bin: s.fake.file, credsFile: creds, awsProfile: 'bench', region: 'us-east-1', timeoutMs: 20000, scratchRoot: s.scratch });
    const out = [];
    for (let i = 0; i < 6; i++) out.push(await caller({ model: 'glm-5', prompt: PROMPT }));
    assert.match(out[0].error, /credentials were rejected/);
    assert.equal(out[1].error, undefined);
    assert.equal(caller.stopReason() !== null, true);
    assert.match(caller.stopReason(), /judging stopped: 3 calls in a row failed on their AWS credentials/);
    assert.equal(out[5].error, caller.stopReason(), 'the sixth call is refused without starting opencode');
    assert.equal(s.calls().length, 5);
  } finally { s.cleanup(); }
});

// ---- the CLI ----

function fakeAws(dir, expiresAt) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'aws');
  fs.writeFileSync(file, `#!/usr/bin/env node\nconst a = process.argv.slice(2);\nif (a.join(' ') !== 'configure export-credentials --profile dev --format process') { console.error('unexpected ' + a.join(' ')); process.exit(2); }\nconsole.log(${JSON.stringify(exported(7, expiresAt))});\n`, { mode: 0o755 });
  return file;
}

test('judge --aws-export-profile takes its credentials from aws configure export-credentials, with no credentials file', () => {
  const s = sandbox();
  try {
    const run = s.mkRun('r');
    const aws = fakeAws(path.join(s.root, 'awsbin'), Date.now() + 60 * 60 * 1000);
    const r = s.cli(['judge', '--run', run, '--bench-dir', s.bench, '--judge-backend', 'opencode', '--opencode-bin', s.fake.file, '--aws-export-profile', 'dev', '--aws-region', 'us-east-1', '--mode', 'rubric'], { BENCH_AWS_BIN: aws });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readJ(run).rubric.filter((x) => !x.judgeError).length, 6);
    assert.match(r.stderr, /aws credentials for profile dev read, expire in \d+ min/);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /exported-secret-7|exported-token-7|ASIAEXPORTED0007/);
    assert.deepEqual(s.calls()[0].credHeaders, ['[bench]']);
  } finally { s.cleanup(); }
});

test('judge refuses --aws-export-profile together with --aws-creds-file, and the flag is in the judge flag table', () => {
  const s = sandbox();
  try {
    const run = s.mkRun('r');
    const r = s.oc(run, '--mode', 'rubric', '--aws-export-profile', 'dev');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--aws-creds-file and --aws-export-profile cannot be used together/);
    assert.equal(s.calls().length, 0);
    assert.equal(checkArgs('judge', { _: [], run: 'x', 'aws-export-profile': 'dev' }), null);
  } finally { s.cleanup(); }
});

test('repeated credential rejections stop the judge pass: the rest are skipped and the command exits 3', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(path.join(path.dirname(s.fake.file), 'fake-opencode-judge.config.json'), JSON.stringify({ dir: path.join(s.root, 'calls'), mode: 'auth' }));
    const run = s.mkRun('r');
    const r = s.oc(run, '--mode', 'rubric', '--concurrency', '1');
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /judging stopped: 3 calls in a row failed on their AWS credentials.*the remaining calls were not made/s);
    assert.equal(s.calls().length, 3, 'no opencode call after the stop');
    const errors = readJ(run).rubric.map((x) => x.judgeError);
    assert.equal(errors.length, 6);
    assert.equal(errors.filter((e) => /^judging stopped/.test(e)).length, 3);
  } finally { s.cleanup(); }
});
