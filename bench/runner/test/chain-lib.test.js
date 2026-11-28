// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/lib/chain: the after-capability chain's pieces one by one (configuration, state file, phase runner,
// study dirs, credentials check). pipeline-chain.test.js runs the whole chain through its launcher.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');

const CHAIN = path.join(__dirname, '..', '..', 'scripts', 'lib', 'chain');
const { loadConfig, makeContext, envOr, fmtDur, ts, which } = require(path.join(CHAIN, 'context.js'));
const { globRe, capDirs, capDirsKind, globIn, studyDir } = require(path.join(CHAIN, 'study-dirs.js'));
const { runPhase } = require(path.join(CHAIN, 'main.js'));
const { credsOk } = require(path.join(CHAIN, 'creds.js'));
const P = require(path.join(CHAIN, 'proc.js'));

function tmp(t) {
  const d = mkScratch('chain-lib-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
const ctxIn = (d, env = {}) => makeContext(loadConfig({ AC_STATE_DIR: d, PATH: process.env.PATH, ...env }, path.join(d, 'run-after-capability.sh')));

test('configuration: an empty value counts as unset, AC_ names win, the rerun defaults on with patches', (t) => {
  const d = tmp(t);
  assert.equal(envOr({ A: '', B: 'b' }, ['A', 'B'], 'x'), 'b');
  assert.equal(envOr({}, ['A'], 'x'), 'x');
  const c = ctxIn(d, { CREDS: '/c', AC_CREDS: '', AWS_PROFILE_NAME: 'p', AC_POLL_S: '7' }).cfg;
  assert.equal(c.creds, '/c');
  assert.equal(c.awsProfile, 'p');
  assert.equal(c.pollS, 7);
  assert.equal(c.rerunAutonomy, '0');
  assert.equal(c.repo, path.resolve(d, '..', '..'));
  assert.equal(c.statefile, path.join(d, 'after-capability.state'));
  const p = path.join(d, 'a.patch');
  fs.writeFileSync(p, '');
  const w = ctxIn(d, { PATCHES: p }).cfg;
  assert.deepEqual(w.patchList, [fs.realpathSync(p)]);
  assert.equal(w.rerunAutonomy, '1');
  assert.equal(ctxIn(d, { PATCHES: p, RERUN_AUTONOMY: '0' }).cfg.rerunAutonomy, '0');
});

test('small formats: durations, UTC stamps, PATH lookups', () => {
  assert.equal(fmtDur(0), '0h00m');
  assert.equal(fmtDur(129600), '36h00m');
  assert.equal(fmtDur(3725), '1h02m');
  assert.equal(ts(new Date('2026-01-02T03:04:05.678Z')), '2026-01-02T03:04:05Z');
  assert.match(which('node'), /\/node$/);
  assert.equal(which(process.execPath), process.execPath);
  assert.equal(which('no-such-tool-here'), '');
});

test('state file: the last value wins, newlines become spaces, other keys stay, a missing key reads empty', (t) => {
  const d = tmp(t);
  const ctx = ctxIn(d);
  assert.equal(ctx.stGet('P1'), '');
  ctx.stSet('P1', 'running');
  ctx.stSet('P2_reason', 'line one\nline two');
  ctx.stSet('P1', 'done');
  ctx.stSet('P10', 'other');
  assert.equal(ctx.stGet('P1'), 'done');
  assert.equal(ctx.stGet('P2_reason'), 'line one line two');
  assert.equal(fs.readFileSync(ctx.cfg.statefile, 'utf8'), 'P2_reason=line one line two\nP1=done\nP10=other\n');
  assert.deepEqual(fs.readdirSync(d), ['after-capability.state'], 'no temp file is left');
});

test('the phase runner: done and skipped are not rerun, a failure keeps its reason, a stop is interrupted', async (t) => {
  const d = tmp(t);
  const ctx = ctxIn(d);
  let calls = 0;
  assert.equal(await runPhase(ctx, 2, async (c) => { calls++; c.phaseResult = 'skipped'; return 0; }), 0);
  assert.equal(ctx.stGet('P2'), 'skipped');
  assert.equal(await runPhase(ctx, 2, async () => { calls++; return 0; }), 0);
  assert.equal(calls, 1, 'a skipped phase is not run again');
  assert.equal(await runPhase(ctx, 3, async (c) => c.fail('it broke')), 1);
  assert.deepEqual([ctx.stGet('P3'), ctx.stGet('P3_reason')], ['failed', 'it broke']);
  assert.equal(await runPhase(ctx, 3, async () => 0), 0, 'a failed phase reruns');
  assert.deepEqual([ctx.stGet('P3'), ctx.stGet('P3_reason')], ['done', '']);
  assert.equal(await runPhase(ctx, 4, async (c) => { c.stopping = true; return 130; }), 130);
  assert.equal(ctx.stGet('P4'), 'interrupted');
  assert.equal(await runPhase(ctx, 5, async () => 0), 130, 'nothing starts once stopping');
  assert.match(fs.readFileSync(ctx.cfg.log, 'utf8'), /P2 PATCH: already skipped, skipping \(resume\)/);
});

test('study dirs: real-* and pilot-* with a summary, sorted; the autonomy glob picks by name', (t) => {
  const d = tmp(t);
  for (const n of ['real-b', 'real-a', 'pilot-autonomy-x', 'pilot-lite', 'other']) {
    fs.mkdirSync(path.join(d, n));
    fs.writeFileSync(path.join(d, n, 'summary.json'), '{}');
  }
  fs.mkdirSync(path.join(d, 'real-nosummary'));
  const ctx = ctxIn(d, { AC_PILOT_STUDYFILE: path.join(d, 'study') });
  assert.deepEqual(capDirs(d).map((x) => path.basename(x)), ['pilot-autonomy-x', 'pilot-lite', 'real-a', 'real-b']);
  assert.deepEqual(capDirsKind(ctx.cfg, d, 'autonomy').map((x) => path.basename(x)), ['pilot-autonomy-x']);
  assert.deepEqual(capDirsKind(ctx.cfg, d, 'real').map((x) => path.basename(x)), ['real-a', 'real-b']);
  assert.deepEqual(globIn(d, 'real-?').map((x) => path.basename(x)), ['real-a', 'real-b']);
  assert.ok(globRe('a[bc].*').test('ab.x'));
  assert.ok(!globRe('a[!b]').test('ab'));
  assert.equal(studyDir(ctx.cfg), null);
  fs.writeFileSync(path.join(d, 'study'), `${d}\n`);
  assert.equal(studyDir(ctx.cfg), d);
});

test('credentials: unset, empty, valid, expired and denied, without reading the file', (t) => {
  const d = tmp(t);
  const aws = (script) => { const f = path.join(d, `aws-${Math.random()}`); fs.writeFileSync(f, `#!/bin/sh\n${script}\n`, { mode: 0o755 }); return f; };
  const creds = path.join(d, 'creds');
  const unset = ctxIn(d);
  assert.equal(credsOk(unset), false);
  assert.equal(unset.credNote, 'CREDS is not set');
  fs.writeFileSync(creds, '');
  const empty = ctxIn(d, { AC_CREDS: creds });
  assert.equal(credsOk(empty), false);
  assert.match(empty.credNote, /missing, empty or unreadable/);
  fs.writeFileSync(creds, 'x');
  assert.equal(credsOk(ctxIn(d, { AC_CREDS: creds, AC_AWS: aws('[ "$AWS_SHARED_CREDENTIALS_FILE" = "$X" ] && [ -z "$AWS_SECRET_ACCESS_KEY" ] && echo 9') })), false);
  process.env.X = creds;
  process.env.AWS_SECRET_ACCESS_KEY = 'parent-secret';
  t.after(() => { delete process.env.X; delete process.env.AWS_SECRET_ACCESS_KEY; });
  assert.equal(credsOk(ctxIn(d, { AC_CREDS: creds, AC_AWS: aws('[ "$AWS_SHARED_CREDENTIALS_FILE" = "$X" ] && [ -z "$AWS_SECRET_ACCESS_KEY" ] && echo 9') })), true);
  const expired = ctxIn(d, { AC_CREDS: creds, AC_AWS: aws('echo "An error occurred (ExpiredToken) when calling" >&2; exit 255') });
  assert.equal(credsOk(expired), false);
  assert.equal(expired.credNote, 'An error occurred (ExpiredToken)');
  const denied = ctxIn(d, { AC_CREDS: creds, AC_AWS: aws('echo "AccessDeniedException" >&2; exit 254') });
  assert.equal(credsOk(denied), true);
  assert.match(denied.credNote, /not treated as expired/);
  const missing = ctxIn(d, { AC_CREDS: creds, AC_AWS: path.join(d, 'no-aws') });
  assert.equal(credsOk(missing), false);
  assert.equal(missing.credNote, 'aws call failed with exit status 127');
});

test('processes: a nap a stop cuts short, a child whose exit status comes back, a killed child reads 128 + signal', async (t) => {
  const d = tmp(t);
  const ctx = ctxIn(d);
  const t0 = Date.now();
  const n = P.nap(ctx, 30);
  ctx.napCancel();
  await n;
  assert.ok(Date.now() - t0 < 5000);
  const out = path.join(d, 'out.log');
  assert.equal(await P.runChild(ctx, 'sh', ['-c', 'echo hi; exit 4'], { out }), 4);
  assert.equal(fs.readFileSync(out, 'utf8'), 'hi\n');
  const k = P.runChild(ctx, 'sleep', ['30'], { out });
  ctx.child.kill('SIGTERM');
  assert.equal(await k, 143);
  assert.equal(ctx.child, null);
  assert.equal(P.alive(''), false);
  assert.equal(P.alive('0'), false);
  assert.equal(P.alive(String(process.pid)), true);
});
