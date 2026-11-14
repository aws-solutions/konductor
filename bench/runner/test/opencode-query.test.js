// SPDX-License-Identifier: Apache-2.0
'use strict';

// The post-run `opencode db` query runs on the host, so it must not trust the scratch HOME the agent could write.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeOpencode } = require('./fake-opencode.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { opencode: oc } = require('../lib/harness/index.js');
const { copyData, prepareQueryDir } = require('../lib/harness/opencode-query.js');

const FX = path.join(__dirname, 'fixtures');
const MODEL = 'global.anthropic.claude-sonnet-5-5';
const FAKE_KEY = 'AK' + 'IATESTTESTTEST1234';
const CREDS = `[bench]\naws_access_key_id = ${FAKE_KEY}\naws_secret_access_key = fakeSecretValueNotReal0123456789abcdefgh\n`;
const OC_VANILLA = { id: 'oc-vanilla', label: 'oc-vanilla', ref: null, commitSha: null, harness: 'none', runtime: 'opencode', agent: null, vanilla: true };
const HOSTILE = { $schema: 'https://opencode.ai/config.json', plugin: ['file:///evil.js'], mcp: { x: { type: 'local', command: ['/bin/evil'] } } };

function setup(cfg = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const bin = makeFakeOpencode(path.join(root, 'bin'), {
    dir: probe, streamFile: path.join(FX, 'opencode-vanilla.stream.jsonl'), rowsFile: path.join(FX, 'opencode-vanilla.rows.json'),
    sessionID: 'ses_e7b047669ffea6BvJf34zDKxOm', ...cfg,
  });
  write(path.join(root, 'creds'), CREDS);
  write(path.join(root, 'rg'), '#!/bin/sh\n');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: MODEL, effort: 'low' }, scratchDir, awsCredsFile: path.join(root, 'creds'), awsProfile: 'bench',
    opencode: { bin, version: '1.19.5', sha256: 'x' }, rgBin: path.join(root, 'rg'), envKeep: [],
    envInfo: { kiroCliVersion: null, harnessVersion: '1.19.5', modelListSnapshotPath: null, region: 'us-east-1' },
    isolation: { mode: 'none' },
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  return { root, bench, ctx, task: loadTasks(bench).get('t1'), probe, scratchDir, outDir: path.join(root, 'out', 't1'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const dbStarted = (s) => JSON.parse(fs.readFileSync(path.join(s.probe, 'db-started.json'), 'utf8'));
const noPostDir = (outDir) => assert.deepEqual(fs.readdirSync(outDir).filter((n) => n.startsWith('post-')), [], 'the query directory is removed');

// A scratch HOME as the agent could have left it, with a stream to parse in the output directory.
function plantRun(s, { home = path.join(s.root, 'home') } = {}) {
  fs.mkdirSync(s.outDir, { recursive: true });
  fs.copyFileSync(path.join(FX, 'opencode-vanilla.stream.jsonl'), path.join(s.outDir, 'stream.jsonl'));
  write(path.join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify(HOSTILE));
  write(path.join(home, '.config', 'opencode', 'plugins', 'evil.js'), 'throw new Error("loaded");\n');
  write(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), 'DB-BYTES');
  write(path.join(home, '.local', 'share', 'opencode', 'opencode.db-wal'), 'WAL-BYTES');
  write(path.join(home, '.local', 'share', 'opencode', 'auth.json'), 'AUTH-JSON');
  return home;
}

const parse = (s, home) => {
  const acc = { agg: null, session: null, checks: [], transcript: null, meta: { flags: [] } };
  oc.parseResult(s.outDir, { home, tmpdir: path.join(home, 'tmp'), acc, arm: OC_VANILLA, ctx: s.ctx, config: s.ctx.config });
  return acc;
};

test('a normal run: the db query gets HOME and XDG_* inside its own directory, no AWS variables, an empty cwd and the harness config', async () => {
  const s = setup();
  try {
    const r = await executeRun({ arm: OC_VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(r.flags, []);
    assert.deepEqual(r.tokens, { input: 6, output: 127, reasoning: 0, cacheRead: 10568, cacheWrite: 10685, total: 6 + 127 + 10568 + 10685 });
    assert.ok(Math.abs(r.costUsd - 0.0290513) < 1e-9);

    const q = dbStarted(s);
    const home = q.env.HOME;
    assert.equal(path.dirname(home), s.outDir);
    assert.match(path.basename(home), /^post-/);
    assert.equal(q.env.XDG_CONFIG_HOME, path.join(home, 'xdg-config'));
    assert.equal(q.env.XDG_DATA_HOME, path.join(home, 'xdg-data'));
    assert.equal(q.env.XDG_CACHE_HOME, path.join(home, 'xdg-cache'));
    assert.equal(q.env.XDG_STATE_HOME, path.join(home, 'xdg-state'));
    assert.equal(q.env.TMPDIR, path.join(home, 'tmp'));
    assert.equal(path.basename(q.cwd), 'cwd');
    assert.equal(path.basename(path.dirname(q.cwd)), path.basename(home), 'cwd is the empty directory inside the query directory');
    assert.deepEqual(q.cwdEntries, []);
    assert.deepEqual(Object.keys(q.env).filter((k) => /^AWS_|^OPENCODE_CONFIG|CREDENTIAL|TOKEN|SECRET/.test(k)), []);
    for (const [k, v] of Object.entries(q.env)) assert.equal(String(v).includes(s.scratchDir), false, `${k} points into the run home`);
    assert.deepEqual(JSON.parse(q.config), oc.configJson({ konductor: false }));
    assert.deepEqual(JSON.parse(q.config), JSON.parse(fs.readFileSync(path.join(s.outDir, 'installed-config.json'), 'utf8')));
    noPostDir(s.outDir);
  } finally {
    s.cleanup();
  }
});

test('a config the agent planted in the scratch HOME is ignored and only database files are copied', () => {
  const s = setup();
  try {
    const home = plantRun(s);
    const acc = parse(s, home);
    const q = dbStarted(s);
    assert.deepEqual(JSON.parse(q.config), oc.configJson({ konductor: false }));
    assert.equal(q.config.includes('evil'), false);
    assert.equal(fs.existsSync(path.join(path.dirname(q.env.XDG_CONFIG_HOME), 'xdg-config', 'opencode', 'plugins')), false);
    assert.deepEqual(q.data, { 'opencode.db': 'DB-BYTES', 'opencode.db-wal': 'WAL-BYTES' }, 'auth.json and everything else stay behind');
    assert.deepEqual(acc.meta.flags, []);
    assert.equal(acc.usage.tokens.total, 6 + 127 + 10568 + 10685);
    assert.equal(fs.readFileSync(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), 'utf8'), 'DB-BYTES', 'the original is untouched');
    noPostDir(s.outDir);
  } finally {
    s.cleanup();
  }
});

test('a symlinked database file is refused: no query runs, the run is flagged and nothing is copied', () => {
  const s = setup();
  try {
    const home = plantRun(s);
    const target = path.join(s.root, 'host-secret');
    write(target, 'HOST-SECRET');
    const db = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
    fs.rmSync(db);
    fs.symlinkSync(target, db);
    const acc = parse(s, home);
    assert.ok(acc.meta.flags.includes('usageUnavailable'));
    assert.equal(fs.existsSync(path.join(s.probe, 'db-started.json')), false, 'opencode was never started');
    assert.equal(acc.usage.tokens.cacheWrite, 10685, 'falls back to the parent stream');
    noPostDir(s.outDir);
  } finally {
    s.cleanup();
  }
});

test('a planted link or non-regular database file sets usageDbTampered and a reason that names no host path', () => {
  const s = setup();
  try {
    const home = plantRun(s);
    const target = path.join(s.root, 'host-secret');
    write(target, 'HOST-SECRET');
    const db = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
    fs.rmSync(db);
    fs.symlinkSync(target, db);
    const linked = parse(s, home);
    assert.ok(linked.meta.flags.includes('usageUnavailable') && linked.meta.flags.includes('usageDbTampered'));
    assert.match(linked.meta.usageUnavailableReason, /link or non-regular file/);
    assert.equal(linked.meta.usageUnavailableReason.includes(s.root), false);

    fs.rmSync(db);
    write(db, 'DB-BYTES');
    fs.mkdirSync(path.join(home, '.local', 'share', 'opencode', 'opencode.db-shm'));
    const special = parse(s, home);
    assert.ok(special.meta.flags.includes('usageDbTampered'), 'a directory where a database file belongs is refused the same way');
    noPostDir(s.outDir);
  } finally {
    s.cleanup();
  }
});

test('a failing query is usageUnavailable with a fixed reason but is not flagged as tampering', () => {
  const s = setup({ dbFails: true });
  try {
    const acc = parse(s, plantRun(s));
    assert.ok(acc.meta.flags.includes('usageUnavailable'));
    assert.equal(acc.meta.flags.includes('usageDbTampered'), false);
    assert.equal(acc.meta.usageUnavailableReason, 'opencode db exited with status 1');
    noPostDir(s.outDir);
  } finally {
    s.cleanup();
  }
});

test('a symlinked data directory or parent is refused', () => {
  const s = setup();
  try {
    const home = plantRun(s);
    const real = path.join(s.root, 'elsewhere');
    write(path.join(real, 'opencode.db'), 'OTHER');
    const dataDir = path.join(home, '.local', 'share', 'opencode');
    fs.rmSync(dataDir, { recursive: true });
    fs.symlinkSync(real, dataDir);
    assert.ok(parse(s, home).meta.flags.includes('usageUnavailable'));
    fs.rmSync(path.join(home, '.local'), { recursive: true });
    fs.symlinkSync(s.root, path.join(home, '.local'));
    assert.ok(parse(s, home).meta.flags.includes('usageUnavailable'));
    assert.equal(fs.existsSync(path.join(s.probe, 'db-started.json')), false);
    noPostDir(s.outDir);
  } finally {
    s.cleanup();
  }
});

test('copyData: a missing data directory copies nothing, a non-regular entry or too many bytes is refused', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const dataHome = path.join(home, '.local', 'share');
    fs.mkdirSync(home, { recursive: true });
    assert.equal(copyData({ home, dataHome, destDataHome: path.join(root, 'd0') }), 0);

    write(path.join(dataHome, 'opencode', 'opencode.db'), '0123456789');
    write(path.join(dataHome, 'opencode', 'opencode.db-shm'), 'abc');
    assert.equal(copyData({ home, dataHome, destDataHome: path.join(root, 'd1') }), 13);
    assert.equal(fs.readFileSync(path.join(root, 'd1', 'opencode', 'opencode.db'), 'utf8'), '0123456789');
    assert.throws(() => copyData({ home, dataHome, destDataHome: path.join(root, 'd2'), maxBytes: 12 }), /exceed/);

    fs.mkdirSync(path.join(dataHome, 'opencode', 'opencode.db-wal'));
    assert.throws(() => copyData({ home, dataHome, destDataHome: path.join(root, 'd3') }), /plain file|regular file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepareQueryDir removes its directory when the copy fails', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const out = path.join(root, 'out');
    fs.mkdirSync(out);
    write(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), '0123456789');
    assert.throws(() => prepareQueryDir({ outDir: out, home, dataHome: path.join(home, '.local', 'share'), config: {}, maxBytes: 3 }), /exceed/);
    assert.deepEqual(fs.readdirSync(out), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectArtifacts copies the installed config but refuses a symlink the agent put in its place', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const out = path.join(root, 'out');
    fs.mkdirSync(out);
    write(path.join(home, '.config', 'opencode', 'opencode.json'), '{"ok":true}');
    oc.collectArtifacts(home, out);
    assert.equal(fs.readFileSync(path.join(out, 'installed-config.json'), 'utf8'), '{"ok":true}');

    const secret = path.join(root, 'host-secret');
    write(secret, 'HOST-SECRET');
    fs.rmSync(path.join(home, '.config', 'opencode', 'opencode.json'));
    fs.symlinkSync(secret, path.join(home, '.config', 'opencode', 'opencode.json'));
    fs.rmSync(path.join(out, 'installed-config.json'));
    assert.throws(() => oc.collectArtifacts(home, out), /symlink/);
    assert.equal(fs.existsSync(path.join(out, 'installed-config.json')), false);

    fs.rmSync(path.join(home, '.config'), { recursive: true });
    fs.symlinkSync(root, path.join(home, '.config'));
    assert.throws(() => oc.collectArtifacts(home, out), /symlink/, 'a linked parent directory is refused too');

    fs.rmSync(path.join(home, '.config'));
    oc.collectArtifacts(home, out);
    assert.equal(fs.existsSync(path.join(out, 'installed-config.json')), false, 'a missing config is not an error');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
