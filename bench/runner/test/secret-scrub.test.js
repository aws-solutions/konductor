// SPDX-License-Identifier: Apache-2.0
'use strict';

// Credentials the agent prints, or that land in an error, must not reach result.json or the other run outputs on the
// kiro-cli path. Every secret below is a made-up value assembled from parts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const scrub = require('../lib/scrub.js');

const KEY_ID = ['AKIA', 'ZZZZ9999AAAA1111'].join('');
const SECRET_ASSIGN = `aws_secret_access_key = ${'q'.repeat(8)}${'W'.repeat(8)}${'7'.repeat(8)}${'e'.repeat(8)}${'R'.repeat(8)}`;
const JWT = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJ0ZXN0In0abcdef', '.', 'c2lnbmF0dXJlLXZhbHVlLTEyMzQ1'].join('');
const GH = ['ghp', '_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
const ENV_NAME = 'BENCH_PLANTED_API_TOKEN';
const ENV_VALUE = ['planted', 'value', 'not-a-real-token', '4242'].join('-');
const ALL = [KEY_ID, 'qqqqqqqqWWWWWWWW', JWT, GH, ENV_VALUE];

test('scrubString removes keys, assigned secrets, bearer tokens, JWTs, forge tokens, private keys and env values, and keeps ordinary text', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34Gk\n-----END RSA PRIVATE KEY-----';
  const text = [`id ${KEY_ID}`, SECRET_ASSIGN, `Authorization: Bearer ${'t'.repeat(30)}`, `jwt ${JWT}`, `gh ${GH}`, pem, `env ${ENV_VALUE}`,
    'sha 3f786850e387550fdab836ed7e6dc881de23001b and a plain sentence about tokens in general'].join('\n');
  const out = scrub.scrubString(text, [ENV_VALUE]);
  for (const s of [KEY_ID, 'qqqqqqqqWWWWWWWW', 't'.repeat(30), JWT, GH, 'MIIBOgIBAAJBAKj34Gk', ENV_VALUE]) assert.ok(!out.includes(s), `still present: ${s.slice(0, 12)}`);
  assert.match(out, /aws_secret_access_key = <redacted>/, 'the key name stays, the value goes');
  assert.match(out, /Bearer <redacted>/);
  assert.match(out, /3f786850e387550fdab836ed7e6dc881de23001b and a plain sentence about tokens in general/);
});

test('secretLiterals takes the values of credential-named variables, at least 8 characters long, and nothing else', () => {
  const lits = scrub.secretLiterals({ [ENV_NAME]: ENV_VALUE, MY_PASSWORD: 'hunter2hunter2', SHORT_TOKEN: 'abc', PATH: '/usr/bin:/bin', HOME: '/users/u', AWS_REGION: 'us-east-1', GITHUB_TOKEN: undefined });
  assert.deepEqual([...lits].sort(), ['hunter2hunter2', ENV_VALUE].sort());
});

test('scrubDeep rewrites every string in a result, including error and final text, and reports how many it changed', () => {
  const r = { error: `boom ${KEY_ID}`, finalText: `token ${GH}`, nested: { list: [`x ${JWT}`, 5, null] }, n: 3, sha: 'a'.repeat(40) };
  const { value, count } = scrub.scrubDeep(r, []);
  assert.equal(count, 3);
  assert.ok(!JSON.stringify(value).match(new RegExp(ALL.slice(0, 4).join('|'))));
  assert.equal(value.n, 3);
  assert.equal(value.sha, 'a'.repeat(40));
  assert.equal(value.nested.list[1], 5);
});

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };

function setup(kiroCfg) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, ...kiroCfg });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const outDir = path.join(root, 'out');
  const ctx = {
    config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
  };
  const task = loadTasks(bench).get('t1');
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  process.env[ENV_NAME] = ENV_VALUE;
  const cleanup = () => { process.env.PATH = prevPath; delete process.env[ENV_NAME]; fs.rmSync(root, { recursive: true, force: true }); };
  return { root, ctx, task, outDir, cleanup };
}

const readAll = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => fs.readFileSync(path.join(e.parentPath ?? e.path, e.name), 'latin1')).join('\n');

test('a final text that prints credentials never reaches result.json or the run directory', async () => {
  const finalText = `Here is what I found: ${KEY_ID}, ${SECRET_ASSIGN}, Bearer ${'t'.repeat(30)}, ${JWT}, ${GH} and ${ENV_VALUE}`;
  const s = setup({ finalText });
  try {
    const outDir = path.join(s.outDir, 't1');
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success');
    const resultText = fs.readFileSync(path.join(outDir, 'result.json'), 'latin1');
    for (const secret of [KEY_ID, 'qqqqqqqqWWWWWWWW', 't'.repeat(30), JWT, GH, ENV_VALUE]) {
      assert.ok(!resultText.includes(secret), `result.json still has ${secret.slice(0, 10)}`);
      assert.ok(!JSON.stringify(r).includes(secret), 'the returned result is clean too');
      assert.ok(!readAll(outDir).includes(secret), `a file in the run directory still has ${secret.slice(0, 10)}`);
    }
    assert.ok(r.flags.includes('credsRedacted'));
  } finally { s.cleanup(); }
});

test('an error message carrying a credential is scrubbed from the result', async () => {
  const s = setup({ exitCode: 3 });
  try {
    const task = { ...s.task, checks: [{ type: 'file_exists', path: 'a.txt' }] };
    const outDir = path.join(s.outDir, 't1');
    const r = await executeRun({ arm: ARM, task, replicate: 1, ctx: { ...s.ctx, authDb: path.join(s.root, 'missing', `${KEY_ID}.sqlite3`) }, prepared: null, outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'error');
    assert.ok(!JSON.stringify(r).includes(KEY_ID), `the error text carried the key id: ${r.error}`);
    assert.ok(!fs.readFileSync(path.join(outDir, 'result.json'), 'utf8').includes(KEY_ID));
  } finally { s.cleanup(); }
});
