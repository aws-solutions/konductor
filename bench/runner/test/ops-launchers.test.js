// SPDX-License-Identifier: Apache-2.0
// The owner's workspace scripts are versioned under bench/ops (DEBT D-236); the workspace keeps thin launchers written
// by bench/ops/make-launchers.sh. Each launcher's stub path is run here: against a stub ops tree where every script
// prints its own name, its arguments and KONDUCTOR_WS, so a launcher that points at the wrong file, drops an argument
// or forgets the workspace fails. No model call, no real script runs.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OPS = path.join(__dirname, '..', '..', 'ops');
const MAKE = path.join(OPS, 'make-launchers.sh');
const SOURCED = new Set(['kp-pilot-lib.sh', 'standard-kit-env.sh']);

/** Every file under bench/ops that gets a launcher, relative to bench/ops. */
function versioned() {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(OPS, rel), { withFileTypes: true })) {
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk('workspace');
  walk('next-experiment-2026-11-22');
  return out.sort();
}

const destOf = (ws, rel) => (rel.startsWith('workspace/') ? path.join(ws, 'scripts', rel.slice('workspace/'.length)) : path.join(ws, 'reports', rel));

/** A temp workspace and a stub ops tree with one stub per versioned file. */
function setUp(t) {
  // realpath: make-launchers.sh writes the workspace's real path (pwd -P), so a symlinked TMPDIR must match it.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ops-launchers-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = path.join(root, 'ws');
  const stub = path.join(root, 'ops');
  fs.mkdirSync(ws);
  for (const rel of versioned()) {
    const file = path.join(stub, 'bench', 'ops', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (rel.endsWith('.sh')) fs.writeFileSync(file, SOURCED.has(path.basename(rel)) ? `STUB_SOURCED='${rel}'\n` : `echo "ran ${rel} ws=$KONDUCTOR_WS args=$*"\n`);
    else if (rel.endsWith('.js')) fs.writeFileSync(file, `console.log('ran ${rel} ws=' + process.env.KONDUCTOR_WS + ' args=' + process.argv.slice(2).join(' '));\n`);
    else fs.writeFileSync(file, `data ${rel}\n`);
  }
  return { ws, stub };
}

function make(ws, stub, ...args) {
  return spawnSync('bash', [MAKE, ws, ...args], { env: { ...process.env, KONDUCTOR_OPS: stub }, encoding: 'utf8' });
}

test('the versioned scripts parse, and none is the local-only credential script', () => {
  const files = versioned();
  assert.ok(files.length > 50, `found ${files.length}`);
  assert.ok(!files.some((f) => path.basename(f) === 'keep-creds-fresh.sh'), 'keep-creds-fresh.sh names an account and role: it stays local');
  for (const f of files.filter((x) => x.endsWith('.sh'))) {
    const r = spawnSync('bash', ['-n', path.join(OPS, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('every launcher runs its own versioned script with the arguments and the workspace', (t) => {
  const { ws, stub } = setUp(t);
  const r = make(ws, stub);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const rel of versioned()) {
    const dest = destOf(ws, rel);
    const env = { ...process.env, KONDUCTOR_OPS: stub };
    delete env.KONDUCTOR_WS;
    if (rel.endsWith('.sh') && SOURCED.has(path.basename(rel))) {
      const s = spawnSync('bash', ['-c', `. "${dest}"; echo "$STUB_SOURCED $KONDUCTOR_WS"`], { env, encoding: 'utf8' });
      assert.equal(s.stdout.trim(), `${rel} ${ws}`, rel);
    } else if (rel.endsWith('.sh')) {
      const s = spawnSync('bash', [dest, 'a b', 'c'], { env, encoding: 'utf8' });
      assert.equal(s.stdout.trim(), `ran ${rel} ws=${ws} args=a b c`, rel);
    } else if (rel.endsWith('.js')) {
      const s = spawnSync(process.execPath, [dest, 'x', 'y'], { env, encoding: 'utf8' });
      assert.equal(s.stdout.trim(), `ran ${rel} ws=${ws} args=x y`, `${rel}: ${s.stderr}`);
    } else {
      assert.ok(fs.lstatSync(dest).isSymbolicLink(), rel);
      assert.equal(fs.readFileSync(dest, 'utf8'), `data ${rel}\n`, rel);
    }
  }
});

test('bench/ops/README.md lists every versioned file', () => {
  const readme = fs.readFileSync(path.join(OPS, 'README.md'), 'utf8');
  const missing = versioned().filter((rel) => !readme.includes(`| \`${rel.replace(/^(workspace|next-experiment-2026-11-22)\//, '')}\` |`));
  assert.deepEqual(missing, []);
});

test('a file that is not a launcher is refused without --replace, and a rerun over launchers is clean', (t) => {
  const { ws, stub } = setUp(t);
  const own = path.join(ws, 'scripts', 'run-tonight.sh');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, 'echo the owner edit\n');
  const r = make(ws, stub);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /refused \(not a launcher; back it up and pass --replace\): .*run-tonight\.sh/);
  assert.equal(fs.readFileSync(own, 'utf8'), 'echo the owner edit\n');
  assert.equal(make(ws, stub, '--replace').status, 0);
  const again = make(ws, stub);
  assert.equal(again.status, 0, again.stdout);
});
