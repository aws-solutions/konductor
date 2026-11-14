// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const LIB = path.join(SCRIPTS, 'state-dir.sh');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
const modeOf = (p) => fs.statSync(p).mode & 0o777;

function resolve(env, args = ['']) {
  const quoted = args.map((a) => `'${a}'`).join(' ');
  const r = spawnSync('bash', ['-c', `. '${LIB}'; bench_state_dir ${quoted}`], {
    env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}

test('default dir sits under XDG_STATE_HOME and is created with mode 700', () => {
  const root = tmp();
  const r = resolve({ HOME: root, XDG_STATE_HOME: path.join(root, 'xdg') });
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, path.join(root, 'xdg', 'konductor-bench'));
  assert.equal(modeOf(r.out), 0o700);
});

test('default dir falls back to $HOME/.local/state when XDG_STATE_HOME is unset', () => {
  const root = tmp();
  const r = resolve({ HOME: root });
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, path.join(root, '.local', 'state', 'konductor-bench'));
  assert.equal(modeOf(r.out), 0o700);
});

test('without HOME the default is $TMPDIR/konductor-bench-<uid>', () => {
  const root = tmp();
  const r = resolve({ TMPDIR: root });
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, path.join(root, `konductor-bench-${process.getuid()}`));
  assert.equal(modeOf(r.out), 0o700);
});

test('an unusable HOME falls back to the per-uid temp dir', { skip: isRoot && 'root can write anywhere' }, () => {
  const root = tmp();
  const home = path.join(root, 'ro');
  fs.mkdirSync(home, { mode: 0o500 });
  const r = resolve({ HOME: home, TMPDIR: root });
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, path.join(root, `konductor-bench-${process.getuid()}`));
});

test('an override wins and is created with mode 700', () => {
  const root = tmp();
  const want = path.join(root, 'a', 'b');
  const r = resolve({ HOME: root }, [want]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, want);
  assert.equal(modeOf(want), 0o700);
});

test('--no-create resolves without creating the directory', () => {
  const root = tmp();
  const r = resolve({ HOME: root }, ['', '--no-create']);
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.existsSync(r.out), false);
});

test('a symlink is refused, even one that points at a safe directory', () => {
  const root = tmp();
  const real = path.join(root, 'real');
  fs.mkdirSync(real, { mode: 0o700 });
  const link = path.join(root, 'link');
  fs.symlinkSync(real, link);
  const r = resolve({ HOME: root }, [link]);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /symlink/);
  assert.equal(r.out, '');
});

test('a dangling symlink is refused and not followed', () => {
  const root = tmp();
  const link = path.join(root, 'link');
  fs.symlinkSync(path.join(root, 'nowhere'), link);
  const r = resolve({ HOME: root }, [link]);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /symlink/);
  assert.equal(fs.existsSync(path.join(root, 'nowhere')), false);
});

test('a symlinked default dir is refused when planted at the fallback path', () => {
  const root = tmp();
  const target = path.join(root, 'elsewhere');
  fs.mkdirSync(target, { mode: 0o700 });
  fs.symlinkSync(target, path.join(root, `konductor-bench-${process.getuid()}`));
  const r = resolve({ TMPDIR: root });
  assert.notEqual(r.status, 0);
  assert.match(r.err, /symlink/);
});

test('a directory writable by group or others is refused', () => {
  const root = tmp();
  for (const mode of [0o770, 0o707, 0o777]) {
    const dir = path.join(root, `m${mode.toString(8)}`);
    fs.mkdirSync(dir);
    fs.chmodSync(dir, mode);
    const r = resolve({ HOME: root }, [dir]);
    assert.notEqual(r.status, 0, mode.toString(8));
    assert.match(r.err, /writable by group or others/);
  }
});

test('an existing 700 or 755 directory owned by the user is accepted', () => {
  const root = tmp();
  for (const mode of [0o700, 0o755]) {
    const dir = path.join(root, `m${mode.toString(8)}`);
    fs.mkdirSync(dir);
    fs.chmodSync(dir, mode);
    const r = resolve({ HOME: root }, [dir]);
    assert.equal(r.status, 0, r.err);
    assert.equal(modeOf(dir), mode, 'an existing directory is not chmodded');
  }
});

test('a directory owned by another user is refused', { skip: (isRoot && 'root owns it') || (!fs.existsSync('/usr') && 'no /usr') }, () => {
  const owner = fs.statSync('/usr').uid;
  if (owner === process.getuid()) return;
  const r = resolve({ HOME: os.tmpdir() }, ['/usr']);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /not the current user/);
});

test('a regular file in place of the directory is refused', () => {
  const root = tmp();
  const file = path.join(root, 'file');
  fs.writeFileSync(file, '');
  const r = resolve({ HOME: root }, [file]);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /not a directory/);
});

test('a path with spaces and quotes survives resolution', () => {
  const root = tmp();
  const want = path.join(root, 'with space', 'state');
  const r = resolve({ HOME: root }, [want]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, want);
});

for (const script of ['monitor.sh', 'run-judging.sh', 'run-skill-bench.sh', 'run-real-pilot.sh', 'run-after-capability.sh']) {
  test(`${script} stops before doing any work when STATE_DIR is a symlink`, () => {
    const root = tmp();
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    const link = path.join(root, 'link');
    fs.symlinkSync(real, link);
    const envName = script === 'run-after-capability.sh' ? 'AC_STATE_DIR' : 'STATE_DIR';
    const r = spawnSync('bash', [path.join(SCRIPTS, script), '--status'], {
      env: { PATH: process.env.PATH, HOME: root, [envName]: link }, encoding: 'utf8', timeout: 20000,
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /refusing state dir .* symlink/);
    assert.deepEqual(fs.readdirSync(real), []);
  });
}
