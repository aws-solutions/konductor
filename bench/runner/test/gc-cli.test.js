// SPDX-License-Identifier: Apache-2.0
'use strict';

// gc and archive through bench.js itself: flag handling, exit codes, the dry-run default. These tests start bench.js, so they run
// with the rest of the suite and not while another study is running. The behavior behind the flags is covered in-process by
// gc.test.js and archive.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const { FLAGS } = require('../lib/cli-flags.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const DAY = 86400000;

function env() {
  const home = fs.realpathSync(mkScratch('gccli-home-'));
  const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { env: { PATH: process.env.PATH, HOME: home, TMPDIR: home }, encoding: 'utf8' });
  return { home, cli };
}

function marked(root, name, ageDays = 10, kind = 'cache') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'f.bin'), 'x'.repeat(4096));
  const t = new Date(Date.now() - ageDays * DAY);
  fs.writeFileSync(path.join(dir, '.bench-owner.json'), JSON.stringify({ schemaVersion: 1, kind, createdAt: t.toISOString(), lastUsedAt: t.toISOString(), pid: null, protect: false }));
  for (const f of ['f.bin', '.bench-owner.json', '.']) fs.utimesSync(path.join(dir, f), t, t);
  return dir;
}

test('gc is a dry run by default, and --apply deletes the marked old directory', () => {
  const { cli } = env();
  const root = fs.realpathSync(mkScratch('gccli-root-'));
  const old = marked(root, 'old-cache');
  const plain = path.join(root, 'plain');
  fs.mkdirSync(plain);
  const dry = cli(['gc', '--root', root]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run, nothing is deleted/);
  assert.match(dry.stdout, /DELETE\s+cache/);
  assert.ok(fs.existsSync(old));
  const wet = cli(['gc', '--root', root, '--apply']);
  assert.equal(wet.status, 0, wet.stderr);
  assert.match(wet.stdout, /deleted 1/);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(plain));
});

test('--root can be repeated', () => {
  const { cli } = env();
  const a = fs.realpathSync(mkScratch('gccli-a-'));
  const b = fs.realpathSync(mkScratch('gccli-b-'));
  const da = marked(a, 'in-a');
  const db = marked(b, 'in-b');
  const r = cli(['gc', '--root', a, '--root', b, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const paths = JSON.parse(r.stdout).entries.map((e) => e.path).sort();
  assert.deepEqual(paths, [da, db].sort());
});

test('gc --protect add PATH and --protect list use the protect file, and a protected directory is kept', () => {
  const { home, cli } = env();
  const root = fs.realpathSync(mkScratch('gccli-root-'));
  const old = marked(root, 'precious-cache');
  const file = path.join(home, 'protect.txt');
  const add = cli(['gc', '--protect', 'add', path.join(root, 'precious-*'), '--protect-file', file]);
  assert.equal(add.status, 0, add.stderr);
  assert.match(cli(['gc', '--protect', 'list', '--protect-file', file]).stdout, /precious-\*/);
  const r = cli(['gc', '--root', root, '--apply', '--protect-file', file]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(old));
  assert.match(r.stdout, /protected by/);
});

test('gc --apply needs --older-than of at least 1h; bad values and unknown flags exit 2', () => {
  const { cli } = env();
  const root = fs.realpathSync(mkScratch('gccli-root-'));
  const old = marked(root, 'old-cache');
  assert.equal(cli(['gc', '--root', root, '--apply', '--older-than', '5m']).status, 2);
  assert.equal(cli(['gc', '--root', root, '--older-than', 'soon']).status, 2);
  assert.equal(cli(['gc', '--root', root, '--kind', 'results']).status, 2);
  assert.equal(cli(['gc', '--root', root, '--keep-last', 'two']).status, 2);
  const typo = cli(['gc', '--root', root, '--aply']);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /did you mean --apply/);
  assert.ok(fs.existsSync(old));
});

test('gc --adopt is a dry run until --apply and refuses a directory that holds .git', () => {
  const { cli } = env();
  const root = fs.realpathSync(mkScratch('gccli-root-'));
  const legacy = path.join(root, 'legacy');
  fs.mkdirSync(legacy);
  const dry = cli(['gc', '--adopt', legacy, '--kind', 'cache']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(path.join(legacy, '.bench-owner.json')), false);
  assert.equal(cli(['gc', '--adopt', legacy, '--kind', 'cache', '--apply']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(legacy, '.bench-owner.json'), 'utf8')).adopted, true);
  const repo = path.join(root, 'checkout');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  assert.equal(cli(['gc', '--adopt', repo, '--kind', 'cache', '--apply']).status, 1);
  assert.equal(cli(['gc', '--adopt', legacy]).status, 2);
});

test('archive: dry run, --apply, --remove-originals, then --restore', () => {
  const { cli } = env();
  const root = fs.realpathSync(mkScratch('gccli-run-'));
  const d = path.join(root, 'vanilla', 't1', '1');
  fs.mkdirSync(path.join(d, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(d, 'workspace', 'a.txt'), 'alpha');
  fs.writeFileSync(path.join(d, 'result.json'), '{}');
  assert.equal(cli(['archive', '--run', root]).status, 0);
  assert.equal(fs.readdirSync(d).some((n) => n.startsWith('workspace.tar')), false);
  assert.equal(cli(['archive', '--run', root, '--remove-originals']).status, 2);
  assert.ok(fs.existsSync(path.join(d, 'workspace')));
  const done = cli(['archive', '--run', root, '--apply', '--remove-originals']);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(fs.existsSync(path.join(d, 'workspace')), false);
  assert.ok(fs.existsSync(path.join(root, 'archive-manifest.json')));
  assert.equal(cli(['archive', '--restore', root]).status, 0);
  assert.equal(fs.readFileSync(path.join(d, 'workspace', 'a.txt'), 'utf8'), 'alpha');
});

test('the gc and archive flag tables match what the commands read', () => {
  assert.deepEqual(FLAGS.gc.slice().sort(), ['adopt', 'apply', 'json', 'keep-last', 'kind', 'older-than', 'protect', 'protect-file', 'root']);
  assert.deepEqual(FLAGS.archive.slice().sort(), ['apply', 'compress', 'dry-run', 'out', 'remove-originals', 'restore', 'run']);
});
