// SPDX-License-Identifier: Apache-2.0
'use strict';

// The cap command through bench.js: list, audit and the argument rules. Each call gets a scratch HOME.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch } = require('./cap-helpers.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

function setup(entries = [entry()]) {
  const root = scratch();
  const r = makeCapRepo(root);
  const bench = makeCapBench(root);
  for (const e of entries) writeEntry(bench, e);
  const home = path.join(root, 'h');
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(home);
  fs.mkdirSync(tmpdir);
  const cap = (sub, ...a) => spawnSync(process.execPath, [BENCH_JS, 'cap', sub, '--repo-root', r.repo, '--bench-dir', bench, '--base', 'v0', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir } });
  return { root, tmpdir, repo: r.repo, bench, home, cap, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort().join('\n');

test('cap list prints every capability with owner, reach and tasks, and exits 0 on a valid registry', () => {
  const s = setup();
  try {
    const r = s.cap('list');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skill:alpha\s+yes\s+k-dev\s+2\s+1\s+0/);
    assert.match(r.stdout, /skill:gamma\s+-\s+-\s+0\s+0\s+-\s+no task/);
    assert.match(r.stdout, /skill:alpha: reached by k-dev, konductor on kiro-cli; linked tasks rev-one/);
    const only = s.cap('list', '--kind', 'sop');
    assert.doesNotMatch(only.stdout, /skill:alpha\s+yes/);
    assert.match(only.stdout, /sop:k-plan/);
    assert.deepEqual(fs.readdirSync(s.home), []);
  } finally { s.done(); }
});

test('cap list exits 1 and names the problem when the registry is invalid', () => {
  const s = setup([entry({ path: 'skills/missing/SKILL.md' })]);
  try {
    const r = s.cap('list');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ERROR capabilities\/skill\/alpha\.json: path skills\/missing\/SKILL\.md does not exist at the base ref/);
  } finally { s.done(); }
});

test('cap list --init prints skeletons for unregistered capabilities and writes nothing', () => {
  const s = setup();
  try {
    const before = tree(s.bench);
    const r = s.cap('list', '--init', '--kind', 'skill');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /# capabilities\/skill\/beta\.json/);
    assert.doesNotMatch(r.stdout, /# capabilities\/skill\/alpha\.json/, 'alpha is registered');
    assert.match(r.stderr, /3 unregistered capabilities; skeletons printed, no file written/);
    const json = s.cap('list', '--init', '--json', '--cap', 'sop:k-plan');
    const [e] = JSON.parse(json.stdout);
    assert.equal(e.entry.id, 'sop:k-plan');
    assert.equal(e.entry.owner, '');
    assert.equal(e.entry.expect['kiro-cli'].tool, 'prompt');
    assert.deepEqual(e.entry.expect['kiro-cli'].actingAgents, ['konductor']);
    assert.equal(tree(s.bench), before);
  } finally { s.done(); }
});

test('cap audit writes cap-audit.md and cap-audit.json under --out, prints a table, and exits 1 on an error finding', () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'out');
    const r = s.cap('audit', '--out', out);
    assert.equal(r.status, 1, 'gamma has no description');
    assert.match(r.stdout, /skill:alpha\s+yes\s+\d+\s+plain\s+yes/);
    assert.match(r.stdout, /ERROR description-missing/);
    assert.match(r.stdout, new RegExp(`wrote ${out.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/cap-audit\\.md`));
    assert.ok(fs.existsSync(path.join(out, 'cap-audit.md')));
    const j = JSON.parse(fs.readFileSync(path.join(out, 'cap-audit.json'), 'utf8'));
    assert.equal(j.base.ref, 'v0');
    assert.deepEqual(fs.readdirSync(s.home), []);
  } finally { s.done(); }
});

test('cap audit defaults --out under TMPDIR and refuses one inside the repo', () => {
  const s = setup();
  try {
    const inRepo = s.cap('audit', '--out', path.join(s.repo, 'out'));
    assert.equal(inRepo.status, 2);
    assert.match(inRepo.stderr, /inside the repository/);
    const def = s.cap('audit');
    assert.ok(def.stdout.includes(path.join(s.tmpdir, 'konductor-bench', 'cap')), def.stdout.slice(-300));
    assert.match(def.stdout, /wrote .*konductor-bench\/cap\/\d{8}T\d{6}Z\/cap-audit\.md/);
  } finally { s.done(); }
});

test('cap audit rejects an unknown harness and an unknown base, and cap alone is a usage error', () => {
  const s = setup();
  try {
    assert.equal(s.cap('audit', '--harness', 'claude').status, 2);
    const base = spawnSync(process.execPath, [BENCH_JS, 'cap', 'audit', '--repo-root', s.repo, '--bench-dir', s.bench, '--base', 'no-such-ref'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: s.home } });
    assert.equal(base.status, 2);
    assert.match(base.stderr, /not found/);
    const bare = spawnSync(process.execPath, [BENCH_JS, 'cap'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: s.home } });
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /cap takes list, audit, variant, plan/);
  } finally { s.done(); }
});

test('cap audit --base dir: reads a directory in place, and --public is accepted', () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'o2');
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'audit', '--repo-root', s.repo, '--bench-dir', s.bench, '--base', `dir:${s.repo}`, '--public', '--out', out], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: s.home } });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /Base dir:repo/);
  } finally { s.done(); }
});
