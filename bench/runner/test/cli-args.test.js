// SPDX-License-Identifier: Apache-2.0
'use strict';

// A mistyped or unknown flag must never start work. --help and -h print usage and exit 0 for every command.
// Every spawn gets a scratch HOME; a fake kiro-cli on PATH records any launch in a marker file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { parseArgs } = require('../bench.js');
const { FLAGS, BOOLEAN_FLAGS, checkArgs, COMMANDS } = require('../lib/cli-flags.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const COMMAND_NAMES = ['run', 'judge', 'report', 'compare', 'contrast', 'pr-plan', 'recheck', 'skills', 'calibrate', 'list-arms', 'cap'];
const CAP_SUBS = ['list', 'audit', 'variant', 'plan'];

function sandbox() {
  const root = tmp();
  const bin = path.join(root, 'bin');
  const marker = path.join(root, 'launched');
  write(path.join(bin, 'kiro-cli'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'kiro-cli'), 0o755);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(tmpdir);
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: home, TMPDIR: tmpdir };
  const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { env, encoding: 'utf8', cwd: root });
  return { root, marker, home, tmpdir, cli };
}

const untouched = (s) => assert.deepEqual([fs.existsSync(s.marker), fs.readdirSync(s.home), fs.readdirSync(s.tmpdir)], [false, [], []]);

test('the command table covers exactly the documented commands', () => {
  assert.deepEqual([...COMMANDS].sort(), [...COMMAND_NAMES].sort());
});

test('--help and -h print usage on stdout and exit 0 without doing anything, for every command and with other flags', () => {
  const s = sandbox();
  try {
    for (const cmd of COMMAND_NAMES) {
      for (const h of ['--help', '-h']) {
        for (const extra of [[], ['--suite', 'lite', '--arms', 'vanilla', '--out', path.join(s.root, 'out')]]) {
          const r = s.cli([cmd, h, ...extra]);
          assert.equal(r.status, 0, `${cmd} ${h}: ${r.stderr}`);
          assert.match(r.stdout, /^Usage:/, `${cmd} ${h}`);
          assert.equal(r.stderr, '', `${cmd} ${h}`);
        }
      }
      // A flag that takes no value must not swallow -h.
      const swallow = s.cli([cmd, '--prepare-only', '-h']);
      assert.equal(swallow.status, 0, `${cmd}: ${swallow.stderr}`);
    }
    for (const top of [['--help'], ['-h'], ['help']]) {
      const r = s.cli(top);
      assert.equal(r.status, 0, top.join(' '));
      assert.match(r.stdout, /^Usage:/);
    }
    untouched(s);
    assert.equal(fs.existsSync(path.join(s.root, 'out')), false);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('no command prints usage and exits 0; an unknown command exits 2', () => {
  const s = sandbox();
  try {
    assert.equal(s.cli([]).status, 0);
    const r = s.cli(['frobnicate']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage:/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('an unknown flag exits 2 and lists the known flags of that command, for every command', () => {
  const s = sandbox();
  try {
    const calls = [...COMMAND_NAMES.filter((c) => c !== 'calibrate' && c !== 'cap').map((c) => [c]), ['calibrate', 'export'], ['calibrate', 'score'], ...CAP_SUBS.map((c) => ['cap', c])];
    for (const call of calls) {
      const r = s.cli([...call, '--bogus-flag']);
      const label = call.join(' ');
      assert.equal(r.status, 2, `${label}: ${r.stderr}`);
      assert.match(r.stderr, /unknown flag --bogus-flag/, label);
      const known = FLAGS[call.join(' ')];
      assert.ok(known && known.length, label);
      for (const f of known) assert.ok(r.stderr.includes(`--${f}`), `${label} lists --${f}`);
      assert.equal(r.stdout, '', label);
    }
    untouched(s);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('run: a typo next to otherwise valid flags launches nothing and creates no output directory', () => {
  const s = sandbox();
  try {
    const out = path.join(s.root, 'out');
    const base = ['run', '--suite', 'lite', '--arms', 'vanilla', '--replicates', '1', '--out', out];
    for (const typo of [['--arm', 'vanilla'], ['--replicate', '1'], ['--budget-credit', '3'], ['--parallell', '1'], ['--arms=vanilla'], ['--prepare_only'], ['-arms', 'vanilla'], ['-s', 'lite']]) {
      const r = s.cli([...base, ...typo]);
      assert.equal(r.status, 2, `${typo.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /unknown flag/, typo.join(' '));
    }
    const stray = s.cli([...base, 'vanilla']);
    assert.equal(stray.status, 2);
    assert.match(stray.stderr, /unexpected argument "vanilla"/);
    untouched(s);
    assert.equal(fs.existsSync(out), false);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('a close misspelling gets a suggestion, and --flag=value gets a hint about the space', () => {
  const s = sandbox();
  try {
    const near = s.cli(['run', '--suite', 'lite', '--replicate', '1']);
    assert.match(near.stderr, /did you mean --replicates\?/);
    const eq = s.cli(['run', '--suite=lite']);
    assert.match(eq.stderr, /unknown flag --suite=lite/);
    assert.match(eq.stderr, /--suite lite/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('report, contrast, recheck, skills, compare and judge refuse an unknown flag before writing or calling anything', () => {
  const s = sandbox();
  try {
    const bench = makeBench(path.join(s.root, 'bench'));
    const run = makeRun(path.join(s.root, 'r1'), bench, ['vanilla', 'k'].map((arm) => ({ arm })));
    const run2 = makeRun(path.join(s.root, 'r2'), bench, ['vanilla', 'k'].map((arm) => ({ arm })));
    const before = fs.readdirSync(run).sort();
    const judgeCmd = `touch ${s.marker}`;
    const cases = [
      ['report', '--run', run, '--bench-dir', bench, '--baselin', 'k'],
      ['contrast', '--run', run, '--bench-dir', bench, '--bse', 'vanilla'],
      ['recheck', '--run', run, '--bench-dir', bench, '--dryrun'],
      ['skills', '--run', run, '--bench-dir', bench, '--jsno'],
      ['compare', '--base', run, '--head', run2, '--bench-dir', bench, '--minrel', '0.1'],
      ['judge', '--run', run, '--bench-dir', bench, '--judge-cmd', judgeCmd, '--judges', 'gpt-test', '--allow-small-panel', '--concurency', '2'],
      ['calibrate', 'export', '--run', run, '--bench-dir', bench, '--nn', '3'],
      ['pr-plan', '--ref', 'x=main', '--suit', 'lite'],
    ];
    for (const c of cases) {
      const r = s.cli(c);
      assert.equal(r.status, 2, `${c[0]}: ${r.stderr}`);
      assert.match(r.stderr, /unknown flag/, c[0]);
    }
    assert.deepEqual(fs.readdirSync(run).sort(), before, 'no file was written into the run directory');
    assert.equal(fs.existsSync(s.marker), false);
    assert.equal(fs.existsSync(path.join(run, 'calibration')), false);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('calibrate takes exactly one subcommand; the flags of the other subcommand are unknown', () => {
  const s = sandbox();
  try {
    const wrong = s.cli(['calibrate', 'score', '--run', 'x']);
    assert.equal(wrong.status, 2);
    assert.match(wrong.stderr, /unknown flag --run/);
    const wrong2 = s.cli(['calibrate', 'export', '--labels', 'x']);
    assert.equal(wrong2.status, 2);
    const none = s.cli(['calibrate']);
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /export or score/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('every flag in the usage text is accepted, and every accepted flag is in the usage text', () => {
  const usage = spawnSync(process.execPath, [BENCH_JS, 'run', '--help'], { env: { PATH: process.env.PATH, HOME: tmp() }, encoding: 'utf8' }).stdout;
  const blocks = usage.split(/\n(?=  node bench\/runner\/bench\.js )/).filter((b) => b.startsWith('  node bench/runner/bench.js '));
  const documented = {};
  for (const b of blocks) {
    const m = b.match(/^ {2}node bench\/runner\/bench\.js (calibrate (?:export|score)|cap (?:list|audit|variant|plan)|[a-z-]+)/);
    const key = m[1];
    const flags = new Set([...b.matchAll(/--([a-z][a-z-]*)/g)].map((x) => x[1]).filter((f) => f !== 'help'));
    documented[key] = new Set([...(documented[key] || []), ...flags]);
  }
  for (const [key, flags] of Object.entries(documented)) {
    const known = new Set(FLAGS[key]);
    assert.ok(FLAGS[key], `no flag table for "${key}"`);
    assert.deepEqual([...flags].filter((f) => !known.has(f)), [], `${key}: documented but rejected`);
    assert.deepEqual([...known].filter((f) => !flags.has(f)), [], `${key}: accepted but not documented`);
  }
  for (const key of Object.keys(FLAGS)) assert.ok(documented[key], `${key} is not in the usage text`);
});

test('checkArgs accepts each command with all of its flags, valued or boolean', () => {
  for (const [key, flags] of Object.entries(FLAGS)) {
    const [cmd, sub] = key.split(' ');
    const argv = [...(sub ? [sub] : [])];
    for (const f of flags) argv.push(`--${f}`, ...(BOOLEAN_FLAGS.has(f) ? [] : ['v']));
    assert.equal(checkArgs(cmd, parseArgs(argv)), null, key);
  }
});

test('parseArgs: booleans never take a value, -h is a help flag, and --help wins over its neighbours', () => {
  assert.deepEqual(parseArgs(['--prepare-only', 'x']), { _: ['x'], 'prepare-only': true });
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--cargo-online', '-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.deepEqual(parseArgs(['--seed', '-1']), { _: [], seed: '-1' });
});
