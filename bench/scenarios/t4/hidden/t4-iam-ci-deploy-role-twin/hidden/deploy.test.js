'use strict';

// Hidden tests for t4-iam-ci-deploy-role-twin. Each test uses its own temp manifest, so files run in parallel safely.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const deployModule = () => require(path.join(ROOT, 'scripts', 'deploy.js'));
const { createFakeClient } = require(path.join(ROOT, 'scripts', 'lib', 'cloud-client.js'));
const PUBLIC_FILES = ['index.html', '404.html', 'robots.txt', 'assets/app.js', 'assets/app.css'];
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'public', rel))).digest('hex');

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

function cli(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'deploy.js'), ...args], { cwd: ROOT, encoding: 'utf8', env }));
}

// A client whose putObject fails `failures[key]` times for that key before it succeeds (Infinity = always).
function flakyClient(failures, calls = []) {
  const base = createFakeClient(calls);
  const tries = {};
  return {
    tries,
    client: {
      ...base,
      putObject: (resource, params) => {
        const key = Object.keys(failures).find((k) => resource.endsWith(`/${k}`));
        if (key) {
          tries[key] = (tries[key] || 0) + 1;
          if (tries[key] <= failures[key]) throw new Error('socket hang up');
        }
        return base.putObject(resource, params);
      },
    },
  };
}

const sleeper = () => {
  const waits = [];
  return { waits, sleep: (ms) => { waits.push(ms); return Promise.resolve(); } };
};

test('dry run prints the plan as JSON and calls no cloud client', () => withTemp((dir) => {
  const out = cli(['staging', '--dry-run', '--manifest-path', path.join(dir, 'm.json')]);
  assert.equal(out.stage, 'staging');
  for (const k of ['plannedUploads', 'skippedFiles']) assert.ok(Array.isArray(out[k]), k);
  assert.ok(out.functionUpdate && out.functionUpdate.functionArn);
  assert.equal(fs.existsSync(path.join(dir, 'm.json')), false, 'a dry run writes no manifest');
}));

test('dry run with no previous manifest plans every public file', () => withTemp((dir) => {
  const out = cli(['staging', '--dry-run', '--manifest-path', path.join(dir, 'none.json')]);
  for (const f of PUBLIC_FILES) assert.ok(out.plannedUploads.some((p) => p.endsWith(f)), f);
  assert.equal(out.skippedFiles.length, 0);
}));

test('production dry run plans the CDN invalidation; staging plans none', () => withTemp((dir) => {
  const prod = cli(['production', '--dry-run', '--manifest-path', path.join(dir, 'p.json')]);
  assert.ok(prod.invalidation && prod.invalidation.distributionId);
  assert.deepEqual(prod.invalidation.paths, ['/*']);
  const stg = cli(['staging', '--dry-run', '--manifest-path', path.join(dir, 's.json')]);
  assert.ok(!stg.invalidation);
}));

test('dry run lists files whose hash matches the manifest as skipped', () => withTemp((dir) => {
  const m = path.join(dir, 'm.json');
  fs.writeFileSync(m, JSON.stringify({ version: '1.0', stage: 'staging', files: { 'index.html': sha('index.html'), 'robots.txt': 'stale' } }));
  const out = cli(['staging', '--dry-run', '--manifest-path', m]);
  assert.ok(out.skippedFiles.some((p) => p.endsWith('index.html')));
  assert.ok(!out.plannedUploads.some((p) => p.endsWith('index.html')));
  assert.ok(out.plannedUploads.some((p) => p.endsWith('robots.txt')), 'a changed hash is uploaded');
}));

test('a real deploy writes the manifest in the stated format', () => withTemp(async (dir) => {
  const m = path.join(dir, 'm.json');
  const { sleep } = sleeper();
  await deployModule().deploy({ stage: 'staging', client: createFakeClient([]), releaseId: 'r1', sleep, manifestPath: m });
  const doc = JSON.parse(fs.readFileSync(m, 'utf8'));
  assert.equal(doc.version, '1.0');
  assert.equal(doc.stage, 'staging');
  for (const f of PUBLIC_FILES) assert.equal(doc.files[f], sha(f), f);
}));

test('a second deploy with an unchanged tree uploads nothing', () => withTemp(async (dir) => {
  const m = path.join(dir, 'm.json');
  const { sleep } = sleeper();
  await deployModule().deploy({ stage: 'staging', client: createFakeClient([]), releaseId: 'r1', sleep, manifestPath: m });
  const calls = [];
  await deployModule().deploy({ stage: 'staging', client: createFakeClient(calls), releaseId: 'r2', sleep, manifestPath: m });
  assert.equal(calls.filter((c) => c.action === 's3:PutObject').length, 0);
  assert.ok(calls.some((c) => c.action === 'lambda:PublishVersion'), 'the function is still published');
}));

test('only the file that changed since the manifest is uploaded', () => withTemp(async (dir) => {
  const m = path.join(dir, 'm.json');
  const files = Object.fromEntries(PUBLIC_FILES.map((f) => [f, sha(f)]));
  files['assets/app.js'] = 'old';
  fs.writeFileSync(m, JSON.stringify({ version: '1.0', stage: 'staging', files }));
  const calls = [];
  const { sleep } = sleeper();
  await deployModule().deploy({ stage: 'staging', client: createFakeClient(calls), releaseId: 'r', sleep, manifestPath: m });
  const puts = calls.filter((c) => c.action === 's3:PutObject').map((c) => c.resource);
  assert.equal(puts.length, 1);
  assert.ok(puts[0].endsWith('assets/app.js'));
}));

test('the command line accepts --manifest-path for a real deploy target too', () => withTemp((dir) => {
  const m = path.join(dir, 'custom.json');
  fs.writeFileSync(m, JSON.stringify({ version: '1.0', stage: 'staging', files: { '404.html': sha('404.html') } }));
  const out = cli(['staging', '--dry-run', '--manifest-path', m]);
  assert.ok(out.skippedFiles.some((p) => p.endsWith('404.html')));
}));

test('a failing upload is retried with 100, 200 and 400 ms waits and then succeeds', () => withTemp(async (dir) => {
  const { client, tries } = flakyClient({ 'index.html': 3 });
  const { waits, sleep } = sleeper();
  await deployModule().deploy({ stage: 'staging', client, releaseId: 'r', sleep, manifestPath: path.join(dir, 'm.json') });
  assert.equal(tries['index.html'], 4);
  assert.deepEqual(waits, [100, 200, 400]);
}));

test('an upload that fails twice waits 100 then 200 ms', () => withTemp(async (dir) => {
  const { client, tries } = flakyClient({ 'robots.txt': 2 });
  const { waits, sleep } = sleeper();
  await deployModule().deploy({ stage: 'staging', client, releaseId: 'r', sleep, manifestPath: path.join(dir, 'm.json') });
  assert.equal(tries['robots.txt'], 3);
  assert.deepEqual(waits, [100, 200]);
}));

test('after four failed tries the deploy stops with an error naming the file, and no wait after the last try', () => withTemp(async (dir) => {
  const { client, tries } = flakyClient({ 'assets/app.css': Infinity });
  const { waits, sleep } = sleeper();
  await assert.rejects(
    deployModule().deploy({ stage: 'staging', client, releaseId: 'r', sleep, manifestPath: path.join(dir, 'm.json') }),
    (err) => /failed to upload/i.test(err.message) && /app\.css/.test(err.message),
  );
  assert.equal(tries['assets/app.css'], 4);
  assert.deepEqual(waits, [100, 200, 400]);
}));

test('retry counts are kept per file', () => withTemp(async (dir) => {
  const { client, tries } = flakyClient({ 'index.html': 1, 'assets/app.js': 2 });
  const { waits, sleep } = sleeper();
  await deployModule().deploy({ stage: 'staging', client, releaseId: 'r', sleep, manifestPath: path.join(dir, 'm.json') });
  assert.equal(tries['index.html'], 2);
  assert.equal(tries['assets/app.js'], 3);
  assert.deepEqual([...waits].sort((a, b) => a - b), [100, 100, 200]);
}));

test('a failed deploy does not write the manifest, so the next run uploads again', () => withTemp(async (dir) => {
  const m = path.join(dir, 'm.json');
  const { client } = flakyClient({ 'index.html': Infinity });
  const { sleep } = sleeper();
  await assert.rejects(deployModule().deploy({ stage: 'staging', client, releaseId: 'r', sleep, manifestPath: m }));
  assert.equal(fs.existsSync(m), false);
  // The next, successful run writes it (so the test does not pass on a deploy that never writes a manifest).
  await deployModule().deploy({ stage: 'staging', client: createFakeClient([]), releaseId: 'r2', sleep, manifestPath: m });
  assert.equal(fs.existsSync(m), true);
}));

test('production deploy still invalidates the CDN and staging does not', () => withTemp(async (dir) => {
  const { sleep } = sleeper();
  const prod = [];
  await deployModule().deploy({ stage: 'production', client: createFakeClient(prod), releaseId: 'r', sleep, manifestPath: path.join(dir, 'p.json') });
  assert.ok(prod.some((c) => c.action === 'cloudfront:CreateInvalidation'));
  const stg = [];
  await deployModule().deploy({ stage: 'staging', client: createFakeClient(stg), releaseId: 'r', sleep, manifestPath: path.join(dir, 's.json') });
  assert.ok(!stg.some((c) => c.action === 'cloudfront:CreateInvalidation'));
  assert.ok(fs.existsSync(path.join(dir, 'p.json')) && fs.existsSync(path.join(dir, 's.json')), 'each successful deploy writes its manifest');
}));
