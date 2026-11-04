// SPDX-License-Identifier: Apache-2.0
'use strict';

// monitor.sh during the skill bench (P5): run counts and timeouts come from the study's own logs, the progress
// denominator is the number of skills in --only, a quiet chain log is not a stall while the study logs are fresh, and
// the credential expiry hint is shown only while it can still be true. Fake state and study directories only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { sandbox, out, opts } = require('./pipeline-helpers.js');

const HAS_JQ = spawnSync('jq', ['--version']).status === 0;
const jqOpts = HAS_JQ ? opts : { skip: 'jq is not installed' };
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19);

const STATUS = (waves = '3/40') => `study dir: STUDY
base: test base; 5 replicates, 4 tasks per skill, model m, engine v3
controls: passed
waves done: ${waves}
  skill-a (loaded): w1 done, w2 running
  skill-b (loaded): w1 done
  skill-c (large): w1 todo
  skill-d (large): w1 todo
runs logged: 12  credits so far: 340
`;

function p5(s, { only = 'skill-a,skill-b,skill-c', logs = {}, sbLogAgeS = 7200, chainLog = '', status = STATUS() } = {}) {
  const study = s.dir('results', 'skill-bench-1');
  const now = Date.now();
  fs.writeFileSync(path.join(s.state, 'skill-bench.study'), `${study}\n`);
  fs.writeFileSync(path.join(s.state, 'after-capability.state'), `FINAL=running\nP1=done\nP2=skipped\nP3=skipped\nP4=done\nP5=running\nCURRENT=5\nP5_study=${study}\nP5_results=${s.results}\nP5_started=${iso(now - 3600e3)}\n`);
  fs.writeFileSync(path.join(s.state, 'after-capability.log'), chainLog);
  const sbLog = path.join(s.state, 'skill-bench.log');
  fs.writeFileSync(sbLog, `[${iso(now - sbLogAgeS * 1000)}] P5 line\n`);
  fs.utimesSync(sbLog, (now - sbLogAgeS * 1000) / 1000, (now - sbLogAgeS * 1000) / 1000);
  for (const [name, { lines, ageS = 0 }] of Object.entries(logs)) {
    const f = path.join(study, 'logs', name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${lines.join('\n')}\n`);
    fs.utimesSync(f, (now - ageS * 1000) / 1000, (now - ageS * 1000) / 1000);
  }
  const sbStub = s.write('sb-status.sh', `#!/bin/bash\ncat <<'EOF'\n${status.replace('STUDY', study)}EOF\n`, 0o755);
  const kids = [];
  const chainProc = spawn('bash', ['-c', 'sleep 120; true', 'run-after-capability'], { stdio: 'ignore' });
  kids.push(chainProc);
  fs.writeFileSync(path.join(s.state, 'after-capability.pid'), `${chainProc.pid}\n`);
  if (only) kids.push(spawn('bash', ['-c', 'sleep 120; true', 'node', 'bench/runner/bench.js', 'cap', 'skill-study', '--study', study, '--only', only], { stdio: 'ignore' }));
  return { study, sbStub, stop: () => kids.forEach((k) => k.kill('SIGKILL')) };
}

const mon = (s, sb, args = [], extra = {}) => s.spawn('monitor.sh', args, { STATE_DIR: s.state, MON_PROC_RE: 'no-such-process-pattern', MON_DISK_PATH: s.root, MON_COLS: '160', MON_SB_SCRIPT: sb.sbStub, ...extra });

const now0 = () => Date.now();
const runLines = (n, ok = 1, to = 0) => {
  const t = hhmmss(now0() - 600e3);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`[bench ${t}] run arm-${i} / task / #${i}`, `[bench ${t}] done arm-${i} / task / #${i}: ${i <= ok ? 'success' : i <= ok + to ? 'timeout' : 'error'}, 1.2 credits, 60s`);
  return out;
};

test('run counts and timeouts are read from the study logs, not the chain log', opts, () => {
  const s = sandbox();
  const sb = p5(s, { logs: { 'screen-s1-run.log': { lines: runLines(6, 3, 2) }, 'controls-run.log': { lines: runLines(2, 2) } } });
  try {
    const r = mon(s, sb);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /log run results: 5 success, 2 timeout, 1 other \(of 8, from the study logs\)/);
    assert.match(r.stdout, /timeouts\/errors in P5: 2 timeouts, 1 other non-success \(of 8 logged runs\)/);
  } finally { sb.stop(); s.done(); }
});

test('with no study logs yet the counts fall back to the chain log lines', opts, () => {
  const s = sandbox();
  const sb = p5(s, { logs: {}, sbLogAgeS: 5 });
  try {
    fs.appendFileSync(path.join(s.state, 'skill-bench.log'), `${runLines(2, 2).join('\n')}\n`);
    const r = mon(s, sb);
    assert.match(r.stdout, /log run results: 2 success, 0 timeout, 0 other \(of 2, from the chain log\)/);
  } finally { sb.stop(); s.done(); }
});

test('the progress denominator is the number of skills in --only, and the bar counts finished skills', opts, () => {
  const s = sandbox();
  const sb = p5(s, { logs: { 'screen-s1-run.log': { lines: runLines(1) } } });
  try {
    const r = mon(s, sb);
    assert.match(r.stdout, /PROGRESS +P5 .* 1\/3 skills, 33%/);
    assert.match(r.stdout, /skills in --only: 3 \(skill-a, skill-b, skill-c\); waves 3\/40 are counted over the whole plan/);
  } finally { sb.stop(); s.done(); }
});

test('without --only the denominator stays the waves of the plan', opts, () => {
  const s = sandbox();
  const sb = p5(s, { only: '', logs: { 'screen-s1-run.log': { lines: runLines(1) } } });
  try {
    const r = mon(s, sb);
    assert.match(r.stdout, /PROGRESS +P5 .* 3\/40 waves/);
    assert.doesNotMatch(r.stdout, /skills in --only/);
  } finally { sb.stop(); s.done(); }
});

test('the skills in --only come from the state when no process shows them', opts, () => {
  const s = sandbox();
  const sb = p5(s, { only: '', logs: { 'screen-s1-run.log': { lines: runLines(1) } } });
  try {
    fs.appendFileSync(path.join(s.state, 'after-capability.state'), 'P5_skills=skill-b,skill-c\n');
    const r = mon(s, sb);
    assert.match(r.stdout, /PROGRESS +P5 .* 1\/2 skills, 50%/);
  } finally { sb.stop(); s.done(); }
});

test('a quiet chain log is not a stall while a study log is fresh; stale study logs still are', opts, () => {
  const s = sandbox();
  const fresh = p5(s, { logs: { 'screen-s1-run.log': { lines: runLines(2, 2), ageS: 20 } } });
  try {
    const r = mon(s, fresh);
    assert.doesNotMatch(r.stdout, /no log output for/);
    assert.match(r.stdout, /VERDICT +OK/);
    assert.match(r.stdout, /last log output \d+s ago/);
  } finally { fresh.stop(); s.done(); }
  const t = sandbox();
  const stale = p5(t, { logs: { 'screen-s1-run.log': { lines: runLines(2, 2), ageS: 7200 } } });
  try {
    const r = mon(t, stale);
    assert.match(r.stdout, /no log output for 2h/);
    assert.match(r.stdout, /VERDICT +ATTENTION/);
  } finally { stale.stop(); t.done(); }
});

const HINT = (ms) => `P4: credentials hint: the file is expected to expire about ${iso(ms)}; if it does, the chain waits`;
const STARTED = '[2026-01-01T00:00:00Z] run-after-capability started, pid 1; state x; resuming from: P1=done';

test('the credential expiry hint is shown while it can still be true', opts, () => {
  const s = sandbox();
  const sb = p5(s, { logs: { 'screen-s1-run.log': { lines: runLines(1), ageS: 5 } }, chainLog: `${STARTED}\n[2026-01-01T00:00:01Z] ${HINT(now0() + 3 * 3600e3)}\n` });
  try {
    const r = mon(s, sb);
    assert.match(r.stdout, /WAITING FOR CREDENTIALS: no  \(credentials hint: expire about \d\d:\d\dZ, in [23]h/);
  } finally { sb.stop(); s.done(); }
});

test('a hint from before a re-vend, or from an earlier launch, or already past while nothing waits, is shown as unknown', opts, () => {
  const cases = {
    'after a re-vend': `${STARTED}\n[2026-01-01T00:00:01Z] ${HINT(now0() + 3 * 3600e3)}\n[2026-01-01T00:10:00Z] credentials are valid again after 9m\n`,
    'from an earlier launch': `[2025-12-31T00:00:00Z] run-after-capability started, pid 9; state x\n[2025-12-31T00:00:01Z] ${HINT(now0() + 3 * 3600e3)}\n${STARTED}\n`,
    'already past': `${STARTED}\n[2026-01-01T00:00:01Z] ${HINT(now0() - 3600e3)}\n`,
  };
  for (const [name, chainLog] of Object.entries(cases)) {
    const s = sandbox();
    const sb = p5(s, { logs: { 'screen-s1-run.log': { lines: runLines(1), ageS: 5 } }, chainLog });
    try {
      const r = mon(s, sb);
      assert.match(r.stdout, /WAITING FOR CREDENTIALS: no  \(credentials expiry: unknown\)/, name);
      assert.doesNotMatch(r.stdout, /credentials hint/, name);
    } finally { sb.stop(); s.done(); }
  }
});

test('--json carries the skills in --only, the skills done and a null expiry when it is unknown', jqOpts, () => {
  const s = sandbox();
  const sb = p5(s, { logs: { 'screen-s1-run.log': { lines: runLines(3, 2, 1) } }, chainLog: `${STARTED}\n[2026-01-01T00:00:01Z] ${HINT(now0() - 3600e3)}\n` });
  try {
    const doc = JSON.parse(mon(s, sb, ['--json']).stdout);
    assert.deepEqual(doc.p5.only, ['skill-a', 'skill-b', 'skill-c']);
    assert.equal(doc.p5.skills_total, 3);
    assert.equal(doc.p5.skills_done, 1);
    assert.equal(doc.p5.waves_total, 40);
    assert.equal(doc.p5.runs_in_logs, 3);
    assert.equal(doc.p5.timeouts_in_logs, 1);
    assert.equal(doc.health.credentials_expire_hint, null);
    assert.equal(doc.health.credentials_expiry, 'unknown');
    assert.equal(doc.health.stalled, false);
  } finally { sb.stop(); s.done(); }
});
