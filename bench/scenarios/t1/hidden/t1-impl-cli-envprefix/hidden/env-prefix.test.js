'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'syncer.js');

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
}

function tempConfig(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-hidden-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(data));
  return { dir, file };
}

function show(args = [], env = {}) {
  const result = run(['sync', '--show-config', ...args], env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('show-config prints every setting with default sources', () => {
  const output = show();
  const lines = output.trim().split('\n');
  assert.equal(lines.length, 8);
  assert.match(output, /^source=\. \[default\]$/m);
  assert.match(output, /^bucket=local \[default\]$/m);
  assert.match(output, /^prefix= \[default\]$/m);
  assert.match(output, /^region=us-east-1 \[default\]$/m);
  assert.match(output, /^dry-run=false \[default\]$/m);
  assert.match(output, /^verbose=false \[default\]$/m);
  assert.match(output, /^tag= \[default\]$/m);
  assert.match(output, /^concurrency=4 \[default\]$/m);
});

test('environment strings override JSON values', () => {
  const { dir, file } = tempConfig({ source: 'file-source', bucket: 'file-bucket', region: 'file-region' });
  try {
    const output = show(['--config', file], {
      SYNCER_SOURCE: 'env-source', SYNCER_BUCKET: 'env-bucket', SYNCER_REGION: 'env-region'
    });
    assert.match(output, /^source=env-source \[environment\]$/m);
    assert.match(output, /^bucket=env-bucket \[environment\]$/m);
    assert.match(output, /^region=env-region \[environment\]$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('command line values beat both environment and JSON', () => {
  const { dir, file } = tempConfig({ bucket: 'file-bucket', prefix: 'file/' });
  try {
    const output = show(['--config', file, '--bucket', 'cli-bucket', '--prefix', 'cli/'], {
      SYNCER_BUCKET: 'env-bucket', SYNCER_PREFIX: 'env/'
    });
    assert.match(output, /^bucket=cli-bucket \[command line\]$/m);
    assert.match(output, /^prefix=cli\/ \[command line\]$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('envPrefix in JSON selects a custom environment prefix', () => {
  const { dir, file } = tempConfig({ envPrefix: 'ALT_', bucket: 'file-bucket', dryRun: false });
  try {
    const output = show(['--config', file], {
      ALT_BUCKET: 'alt-bucket', ALT_DRY_RUN: 'yes', SYNCER_BUCKET: 'wrong-bucket'
    });
    assert.match(output, /^bucket=alt-bucket \[environment\]$/m);
    assert.match(output, /^dry-run=true \[environment\]$/m);
    assert.doesNotMatch(output, /wrong-bucket/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an empty environment value falls through to JSON', () => {
  const { dir, file } = tempConfig({ bucket: 'file-bucket', source: 'file-source' });
  try {
    const output = show(['--config', file], { SYNCER_BUCKET: '', SYNCER_SOURCE: '' });
    assert.match(output, /^bucket=file-bucket \[config\]$/m);
    assert.match(output, /^source=file-source \[config\]$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('boolean environment values accept false and yes', () => {
  const output = show([], { SYNCER_DRY_RUN: '0', SYNCER_VERBOSE: 'yes' });
  assert.match(output, /^dry-run=false \[environment\]$/m);
  assert.match(output, /^verbose=true \[environment\]$/m);
});

test('a repeatable tag can be supplied as comma-separated environment text', () => {
  const output = show([], { SYNCER_TAG: 'team=ops,retention=short' });
  assert.match(output, /^tag=team=ops,retention=short \[environment\]$/m);
});

test('command line repeated tags beat the environment', () => {
  const output = show(['--tag', 'cli-one', '--tag', 'cli-two'], { SYNCER_TAG: 'env-one,env-two' });
  assert.match(output, /^tag=cli-one,cli-two \[command line\]$/m);
});

test('an invalid boolean names its environment variable', () => {
  const result = run(['sync', '--show-config'], { SYNCER_DRY_RUN: 'sometimes' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SYNCER_DRY_RUN/);
  assert.match(result.stderr, /Invalid value/i);
});

test('an invalid concurrency names its environment variable', () => {
  const result = run(['sync', '--show-config'], { SYNCER_CONCURRENCY: 'many' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SYNCER_CONCURRENCY/);
  assert.match(result.stderr, /positive integer/i);
});

test('the no form of a boolean flag still wins over the environment', () => {
  const output = show(['--no-dry-run'], { SYNCER_DRY_RUN: 'true' });
  assert.match(output, /^dry-run=false \[command line\]$/m);
});

test('show-config itself can be enabled through the environment', () => {
  const result = run(['list'], { SYNCER_SHOW_CONFIG: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^bucket=local \[default\]$/m);
  assert.doesNotMatch(result.stdout, /welcome\.txt/);
});

test('the default-prefixed config variable selects a JSON file', () => {
  const { dir, file } = tempConfig({ bucket: 'from-config-variable' });
  try {
    const output = show([], { SYNCER_CONFIG: file });
    assert.match(output, /^bucket=from-config-variable \[config\]$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an empty tag variable falls through to configured tags', () => {
  const { dir, file } = tempConfig({ tags: ['configured-one', 'configured-two'] });
  try {
    const output = show(['--config', file], { SYNCER_TAG: '' });
    assert.match(output, /^tag=configured-one,configured-two \[config\]$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('environment settings affect a real dry-run sync', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-source-'));
  try {
    fs.writeFileSync(path.join(dir, 'payload.txt'), 'payload');
    const result = run(['sync'], {
      SYNCER_SOURCE: dir, SYNCER_BUCKET: 'env-bucket', SYNCER_PREFIX: 'archive/', SYNCER_DRY_RUN: 'true'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would upload 1 file\(s\) to env-bucket\/archive\//);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the command-line config path beats the config environment variable', () => {
  const first = tempConfig({ bucket: 'from-env-file' });
  const second = tempConfig({ bucket: 'from-cli-file' });
  try {
    const output = show(['--config', second.file], { SYNCER_CONFIG: first.file });
    assert.match(output, /^bucket=from-cli-file \[config\]$/m);
  } finally {
    fs.rmSync(first.dir, { recursive: true, force: true });
    fs.rmSync(second.dir, { recursive: true, force: true });
  }
});
