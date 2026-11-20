'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../src/cli');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('main uses environment variable for bucket when no CLI option', async () => {
  const original = process.env.SYNCER_BUCKET;
  process.env.SYNCER_BUCKET = 'env-bucket';
  
  try {
    const code = await main(['list']);
    assert.equal(code, 0);
  } finally {
    if (original === undefined) delete process.env.SYNCER_BUCKET;
    else process.env.SYNCER_BUCKET = original;
  }
});

test('main uses SYNCER_CONFIG for config path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-config-'));
  const configFile = path.join(dir, 'custom.json');
  fs.writeFileSync(configFile, JSON.stringify({ bucket: 'from-custom-config' }));
  
  const original = process.env.SYNCER_CONFIG;
  process.env.SYNCER_CONFIG = configFile;
  
  try {
    const code = await main(['list']);
    assert.equal(code, 0);
  } finally {
    if (original === undefined) delete process.env.SYNCER_CONFIG;
    else process.env.SYNCER_CONFIG = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--show-config prints resolved values', async () => {
  const originalBucket = process.env.SYNCER_BUCKET;
  process.env.SYNCER_BUCKET = 'env-bucket';
  
  const outputs = [];
  const originalLog = console.log;
  console.log = (...args) => { outputs.push(args.join(' ')); };
  
  try {
    await main(['sync', '--show-config']);
    const output = outputs.join('\n');
    assert.match(output, /bucket=env-bucket \[environment\]/);
  } finally {
    console.log = originalLog;
    if (originalBucket === undefined) delete process.env.SYNCER_BUCKET;
    else process.env.SYNCER_BUCKET = originalBucket;
  }
});

test('empty environment variable is treated as unset', async () => {
  const originalBucket = process.env.SYNCER_BUCKET;
  process.env.SYNCER_BUCKET = '';
  
  const outputs = [];
  const originalLog = console.log;
  console.log = (...args) => { outputs.push(args.join(' ')); };
  
  try {
    await main(['sync', '--show-config']);
    // Empty env var is treated as unset, so bucket comes from config file or default
    // Since config/default.json exists with bucket=examples, it won't show [default]
    const output = outputs.join('\n');
    assert.match(output, /bucket=/);
    // Verify it's NOT coming from environment (since we set it to empty)
    assert.doesNotMatch(output, /bucket= \[environment\]/);
  } finally {
    console.log = originalLog;
    if (originalBucket === undefined) delete process.env.SYNCER_BUCKET;
    else process.env.SYNCER_BUCKET = originalBucket;
  }
});

test('invalid boolean environment variable fails with clear error', async () => {
  const original = process.env.SYNCER_DRY_RUN;
  process.env.SYNCER_DRY_RUN = 'invalid';
  
  try {
    await assert.rejects(
      async () => await main(['sync']),
      /Invalid value for SYNCER_DRY_RUN: must be true, false, 1, 0, yes, or no/
    );
  } finally {
    if (original === undefined) delete process.env.SYNCER_DRY_RUN;
    else process.env.SYNCER_DRY_RUN = original;
  }
});

test('invalid concurrency environment variable fails with clear error', async () => {
  const original = process.env.SYNCER_CONCURRENCY;
  process.env.SYNCER_CONCURRENCY = 'not-a-number';
  
  try {
    await assert.rejects(
      async () => await main(['sync']),
      /Invalid value for SYNCER_CONCURRENCY: must be a positive integer/
    );
  } finally {
    if (original === undefined) delete process.env.SYNCER_CONCURRENCY;
    else process.env.SYNCER_CONCURRENCY = original;
  }
});

test('comma-separated tag environment variable', async () => {
  const original = process.env.SYNCER_TAG;
  process.env.SYNCER_TAG = 'team=ops,env=prod';
  
  const outputs = [];
  const originalLog = console.log;
  console.log = (...args) => { outputs.push(args.join(' ')); };
  
  try {
    await main(['sync', '--show-config']);
    const output = outputs.join('\n');
    assert.match(output, /tag=team=ops,env=prod \[environment\]/);
  } finally {
    console.log = originalLog;
    if (original === undefined) delete process.env.SYNCER_TAG;
    else process.env.SYNCER_TAG = original;
  }
});

test('custom envPrefix from config is used', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-prefix-'));
  const configFile = path.join(dir, 'custom.json');
  fs.writeFileSync(configFile, JSON.stringify({ envPrefix: 'MYAPP_', bucket: 'config-bucket' }));
  
  const original = process.env.MYAPP_BUCKET;
  process.env.MYAPP_BUCKET = 'prefix-bucket';
  
  const outputs = [];
  const originalLog = console.log;
  console.log = (...args) => { outputs.push(args.join(' ')); };
  
  try {
    await main(['sync', '--config', configFile, '--show-config']);
    const output = outputs.join('\n');
    assert.match(output, /bucket=prefix-bucket \[environment\]/);
  } finally {
    console.log = originalLog;
    if (original === undefined) delete process.env.MYAPP_BUCKET;
    else process.env.MYAPP_BUCKET = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
