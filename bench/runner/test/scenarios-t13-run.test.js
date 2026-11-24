// SPDX-License-Identifier: Apache-2.0
'use strict';

// The T13 run script (bench/scenarios/t13/run.sh) on a stub kiro-cli: the paid path writes the stream and a ledger line
// counted at max(15, real), the spend check refuses a call that would pass the cap, and a Claude model is refused.
// No real model call: KIRO points at a shell stub.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, '..', '..', 'scenarios', 't13', 'run.sh');
const REPO = path.join(__dirname, '..', '..', '..');

function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 't13-run-')));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.local/share/kiro-cli'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local/share/kiro-cli/data.sqlite3'), 'fake sign-in');
  const auth = path.join(root, 'auth');
  fs.mkdirSync(path.join(auth, 'work'), { recursive: true });
  fs.writeFileSync(path.join(auth, 'work', 'x.author.prompt.txt'), 'Write the task.');
  const kiro = path.join(root, 'kiro');
  const line = (type, data) => JSON.stringify({ type, data });
  fs.writeFileSync(kiro, `#!/bin/sh
echo "$@" > "$HOME/kiro.args"
echo '${line('metadata', { sessionId: 's1', meteringUsage: [{ value: 4.2, unit: 'credit' }] })}'
echo '${line('runFinished', { status: 'success', finalText: 'done' })}'
`);
  fs.chmodSync(kiro, 0o755);
  return { root, home, auth, kiro };
}

const run = (s, model, env = {}) => spawnSync('bash', [RUN, model, path.join(s.auth, 'work', 'x'), path.join(s.auth, 'work', 'x.author.prompt.txt'), path.join(s.auth, 'work', 'x.author')], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: s.home, TMPDIR: s.root, T13_AUTH: s.auth, KIRO: s.kiro, BENCH_REPO: REPO, HOST_CHECK: '0', ...env },
});

test('the paid path runs the stub in an isolated HOME, writes the stream and counts the call at 15 when the real cost is lower', () => {
  const s = setup();
  try {
    const r = run(s, 'gpt-5.6-luna');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(s.auth, 'work', 'x.author.refused')));
    const out = fs.readFileSync(path.join(s.auth, 'work', 'x.author.out'), 'utf8');
    assert.ok(out.includes('runFinished'));
    const ledger = fs.readFileSync(path.join(s.auth, 'ledger.tsv'), 'utf8').trim().split('\n');
    assert.strictEqual(ledger.length, 1);
    assert.match(ledger[0], /^x\.author gpt-5\.6-luna 15 real=4\.200 rc=0 /);
    assert.match(r.stderr, /spent 15 of 300/);
    // The stub ran with the prompt text as its last argument, in a HOME that is not the real one.
    const homes = fs.readdirSync(s.root).filter((n) => n.startsWith('t13-home.'));
    assert.strictEqual(homes.length, 1);
    const args = fs.readFileSync(path.join(s.root, homes[0], 'kiro.args'), 'utf8');
    assert.match(args, /chat --no-interactive --trust-all-tools --model gpt-5\.6-luna --output-format stream-json Write the task\./);
    assert.ok(!fs.existsSync(path.join(s.root, homes[0], '.local/share/kiro-cli/data.sqlite3')), 'the sign-in copy is removed after the call');
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test('a real cost above 15 is counted as is, and a call that would pass the cap is refused before any model call', () => {
  const s = setup();
  try {
    fs.writeFileSync(s.kiro, `#!/bin/sh
echo '${JSON.stringify({ type: 'metadata', data: { sessionId: 's1', meteringUsage: [{ value: 22.5, unit: 'credit' }] } })}'
echo '${JSON.stringify({ type: 'runFinished', data: { status: 'success', finalText: 'done' } })}'
`);
    assert.strictEqual(run(s, 'deepseek-3.2').status, 0);
    assert.match(fs.readFileSync(path.join(s.auth, 'ledger.tsv'), 'utf8'), /deepseek-3\.2 22\.500 real=22\.500/);
    fs.appendFileSync(path.join(s.auth, 'ledger.tsv'), 'y.author glm-5 265 real=3.000 rc=0 2026-11-24T00:00:00Z\n');
    fs.rmSync(path.join(s.auth, 'work', 'x.author.out'));
    const r = run(s, 'gpt-5.6-luna');
    assert.strictEqual(r.status, 0);
    const refused = fs.readFileSync(path.join(s.auth, 'work', 'x.author.refused'), 'utf8');
    assert.match(refused, /spent 287\.5 counted of the 300 cap/);
    assert.ok(!fs.existsSync(path.join(s.auth, 'work', 'x.author.out')), 'no model call was made');
    assert.strictEqual(fs.readFileSync(path.join(s.auth, 'ledger.tsv'), 'utf8').trim().split('\n').length, 2, 'a refusal writes no ledger line');
    // A smaller cap through CAP and another ledger through LEDGER are honoured too: 10 spent of 20 leaves no room for 15.
    fs.writeFileSync(path.join(s.root, 'other.tsv'), 'z.map glm-5 10 real=0.160 rc=0 2026-11-24T00:00:00Z\n');
    const r2 = run(s, 'gpt-5.6-luna', { CAP: '20', LEDGER: path.join(s.root, 'other.tsv') });
    assert.strictEqual(r2.status, 0);
    assert.match(fs.readFileSync(path.join(s.auth, 'work', 'x.author.refused'), 'utf8'), /of the 20 cap/);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test('a Claude model is refused: the writer path is non-Claude', () => {
  const s = setup();
  try {
    assert.strictEqual(run(s, 'claude-sonnet-5.5').status, 0);
    assert.match(fs.readFileSync(path.join(s.auth, 'work', 'x.author.refused'), 'utf8'), /Claude family/);
    assert.ok(!fs.existsSync(path.join(s.auth, 'ledger.tsv')) || fs.readFileSync(path.join(s.auth, 'ledger.tsv'), 'utf8').trim() === '');
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});
