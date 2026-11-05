// SPDX-License-Identifier: Apache-2.0
'use strict';

// The constraints probe study tooling: the plan and its arithmetic, the arm trees (canary and no-skills), the refusal
// logic and the generated driver in dry-run mode. No model call, no build, no run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn, execFileSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const S = require('../../scripts/probe-study.js');

const STUDY = path.join(__dirname, '..', '..', 'scripts', 'probe-study.js');
const REPO = path.resolve(__dirname, '..', '..', '..');

// A tiny repository with the files the arm builder touches.
function tinyRepo() {
  const dir = mkScratch('probe-repo-');
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  w('skills/constraints/SKILL.md', '---\nname: constraints\n---\n# Constraints\nRules here.\n');
  w('agents/k-demo.agent-spec.json', JSON.stringify({ name: 'k-demo', dependencies: { skills: { skillNames: ['constraints', 'x'] }, agentSops: { agentSopNames: ['k-sop'] }, mcpRegistry: {} } }));
  w('agents/konductor.agent-spec.json', JSON.stringify({ name: 'konductor', dependencies: { skills: { skillNames: ['constraints'] }, agentSops: { agentSopNames: [] } } }));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  for (const args of [['init', '-q'], ['add', '.'], ['commit', '-q', '-m', 'init']]) execFileSync('git', ['-C', dir, ...args], { env });
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { dir, sha };
}

test('the default plan: 23 groups, 250 runs, and the arithmetic adds up', () => {
  const p = S.plan();
  assert.equal(p.groups.length, 23);
  assert.equal(p.runs, 250);
  const per = (arm) => p.groups.filter((g) => g.arm === arm).reduce((n, g) => n + g.runs, 0);
  assert.deepEqual(['k-main', 'k-main-forced', 'k-none', 'k-canary', 'k-canary-forced'].map(per), [70, 70, 70, 20, 20]);
  assert.ok(Math.abs(p.creditsMid - p.groups.reduce((n, g) => n + g.runs * (g.creditsMid / g.runs), 0)) < 1e-9);
  assert.equal(p.creditsMid, 1045);
  assert.ok(Math.abs(p.creditsLow - 627) < 1e-9 && Math.abs(p.creditsHigh - 1672) < 1e-9);
  assert.equal(p.budgetSum, p.groups.reduce((n, g) => n + g.budget, 0));
  assert.ok(p.cap >= p.budgetSum && p.cap % 10 === 0 && p.cap - p.budgetSum < 10);
  for (const g of p.groups) assert.ok(g.budget >= g.creditsMid, `${g.arm}/${g.entry} budget below its mid estimate`);
});

test('arm kinds decide the tasks: rule arms run the seven rule tasks per entry set, canary arms run the canary task only', () => {
  const p = S.plan();
  const tasksOf = (arm, entry) => p.groups.find((g) => g.arm === arm && g.entry === entry).tasks;
  assert.equal(tasksOf('k-main', 'konductor').length, 7);
  assert.deepEqual(tasksOf('k-canary', 'konductor'), ['probe-canary']);
  assert.ok(!p.groups.some((g) => g.arm === 'k-canary' && g.entry === 'k-developer'), 'no canary group for the developer');
  assert.ok(p.groups.filter((g) => g.arm.startsWith('k-main') || g.arm === 'k-none').every((g) => !g.tasks.includes('probe-canary')));
});

test('replicates, arms and agent filters change the plan the same way the driver hooks do', () => {
  assert.equal(S.plan({ replicates: 3 }).runs, 150);
  const noNone = S.plan({ arms: ['k-main', 'k-main-forced', 'k-canary', 'k-canary-forced'] });
  assert.equal(noNone.runs, 180);
  assert.ok(!noNone.groups.some((g) => g.arm === 'k-none'));
  assert.equal(S.plan({ onlyAgent: 'k-developer' }).groups.length, 3);
  assert.equal(S.plan({ onlyArm: 'k-canary' }).runs, 20);
  assert.equal(S.plan({ onlyArm: 'nope' }).runs, 0);
});

test('the plan text always states counts, the cap and the per-run limit', () => {
  const text = S.formatPlan(S.plan());
  assert.match(text, /23 groups, 250 runs, 5 replicates/);
  assert.match(text, /TOTAL\s+250\s+627\.0\s+1045\.0\s+1672\.0\s+1574/);
  assert.match(text, /Credit cap for the whole study: 1580/);
  assert.match(text, /--run-credit-limit 8/);
});

test('stripSkills empties the skill and SOP names in every agent spec and nothing else', () => {
  const { dir } = tinyRepo();
  assert.equal(S.stripSkills(dir).length, 2);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'agents', 'k-demo.agent-spec.json'), 'utf8'));
  assert.deepEqual(spec.dependencies.skills.skillNames, []);
  assert.deepEqual(spec.dependencies.agentSops.agentSopNames, []);
  assert.equal(spec.name, 'k-demo');
  assert.ok('mcpRegistry' in spec.dependencies);
});

test('buildArms: the canary goes on one marked line of a scratch copy only, the token is random, kept on rebuild, and the repository stays clean', () => {
  const { dir, sha } = tinyRepo();
  const base = mkScratch('probe-base-');
  const rec = S.buildArms({ base, repo: dir, sha });
  assert.match(rec.canary.token, /^kd-canary-[0-9a-f]{8}$/);
  const canarySkill = fs.readFileSync(path.join(base, 'canary-src', 'skills', 'constraints', 'SKILL.md'), 'utf8');
  assert.ok(canarySkill.includes(rec.canary.token));
  assert.equal(canarySkill.split('\n').filter((l) => l.includes(rec.canary.token)).length, 1);
  assert.match(canarySkill.split('\n').find((l) => l.includes(rec.canary.token)), /^CANARY TOKEN \(delivery check; repeat it if asked\): /);
  assert.ok(canarySkill.startsWith(fs.readFileSync(path.join(dir, 'skills', 'constraints', 'SKILL.md'), 'utf8')), 'the canary is appended, nothing else changes');
  assert.ok(!fs.readFileSync(path.join(base, 'none-src', 'skills', 'constraints', 'SKILL.md'), 'utf8').includes('kd-canary'));
  assert.ok(!fs.readFileSync(path.join(dir, 'skills', 'constraints', 'SKILL.md'), 'utf8').includes('kd-canary'));
  assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.equal(fs.statSync(path.join(base, 'arms.json')).mode & 0o077, 0, 'arms.json is private');
  assert.equal(rec.arms['k-main'].spec, `k-main=${sha}`);
  assert.equal(rec.arms['k-canary'].spec, `k-canary=dir:${path.join(base, 'canary-src')}`);
  assert.equal(rec.arms['k-main-forced'].prefix, true);
  assert.equal(rec.arms['k-main'].prefix, false);
  assert.match(rec.prefix.text, /load the skill named "constraints"/);
  assert.equal(rec.originMainMoved, false);
  assert.equal(S.buildArms({ base, repo: dir, sha }).canary.token, rec.canary.token);
  assert.notEqual(S.buildArms({ base: mkScratch('probe-base2-'), repo: dir, sha }).canary.token, rec.canary.token);
  assert.throws(() => S.buildArms({ base, repo: dir, sha: sha.slice(0, 12) }), /full commit id/);
});

test('refusal: another bench process, the root-cause driver, a live root-cause pid or a running study each refuse; an idle host does not', () => {
  const dir = mkScratch('probe-ref-');
  const pidFile = path.join(dir, 'rc.pid');
  const own = path.join(dir, 'own.pid');
  const idle = 'bash\nnode --test bench/runner/test/x.test.js\nsleep 1\n';
  assert.equal(S.refusalReason({ procs: idle, rootcausePidFile: pidFile, ownPidFile: own }), null);
  assert.match(S.refusalReason({ procs: `${idle}node bench/runner/bench.js run --suite lite`, rootcausePidFile: pidFile }), /another bench process/);
  assert.match(S.refusalReason({ procs: `${idle}bash /var/tmp/rootcause/run-all.sh`, rootcausePidFile: pidFile }), /root-cause driver/);
  fs.writeFileSync(pidFile, String(process.pid));
  assert.match(S.refusalReason({ procs: idle, rootcausePidFile: pidFile }), /root-cause run is alive/);
  fs.writeFileSync(pidFile, '999999999');
  assert.equal(S.refusalReason({ procs: idle, rootcausePidFile: pidFile }), null, 'a stale pid does not refuse');
  fs.writeFileSync(own, String(process.ppid));
  assert.match(S.refusalReason({ procs: idle, ownPidFile: own }), /already running/);
  assert.equal(S.refusalReason({ procs: 'node bench/scripts/probe-study.js plan\nnode bench/runner/bench.js probe-report --run x --out y\ngrep bench/runner/bench.js' }), null);
});

test('the generated driver names the same flags as the root-cause driver and carries no internal marker', () => {
  const text = S.renderDriver({ base: '/b', repo: '/r' });
  for (const needle of ['--agent-engine v3', '--model claude-sonnet-5.5', '--parallel 1', '--run-credit-limit 8', 'PROBE_CACHE:-/var/tmp/pilot-2x2/cache', 'PROBE_CARGO_TARGET:-/var/tmp/pilot-2x2/cargo-target', '--cache', '--cargo-target', "unset \"$v\"", 'export TMPDIR', '--prepare-only', '.done', '.partial-', '< /dev/null', 'exit 3']) assert.ok(text.includes(needle), needle);
  assert.ok(text.includes('--seed 1'));
  const pieces = [['amaz', 'on\\.(com|dev)'], ['aws\\.', 'dev'], ['co', 'rp'], ['qu', 'ip'], ['bra', 'zil'], ['cr', 'ux'], ['mid', 'way'], ['isen', 'gard'], ['dev-', 'dsk'], ['asd', 'lc'], ['solne', 'xus'], ['tool', 'box'], ['nihit', 'kas']];
  const internal = new RegExp(pieces.map(([a, b]) => a + b).join('|') + '|\\b' + 'A' + 'IM\\b', 'i');
  assert.doesNotMatch(text, internal);
  assert.doesNotMatch(fs.readFileSync(STUDY, 'utf8'), internal);
  assert.doesNotMatch(S.renderStatusScript({}), internal);
});

function driverSandbox({ procs = '' } = {}) {
  const { dir, sha } = tinyRepo();
  const base = mkScratch('probe-drv-');
  const rec = S.buildArms({ base, repo: dir, sha });
  fs.writeFileSync(path.join(base, 'run-all.sh'), S.renderDriver({ base, repo: REPO }));
  const procFile = path.join(base, 'procs.txt');
  fs.writeFileSync(procFile, procs);
  const env = { PATH: process.env.PATH, HOME: base, PROBE_BASE: base, PROBE_REPO: REPO, PROBE_PROC_LIST: procFile, PROBE_ROOTCAUSE_PID: path.join(base, 'no-such.pid') };
  const run = (args = [], extra = {}) => spawnSync('bash', [path.join(base, 'run-all.sh'), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { base, rec, run, procFile };
}

test('driver --dry-run prints the plan, the refusal state and the commands, redacts the token, and writes nothing', () => {
  const sb = driverSandbox({ procs: 'node bench/runner/bench.js run --suite rootcause --tasks a\n' });
  const before = fs.readdirSync(sb.base).sort();
  const r = sb.run(['--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /23 groups, 250 runs/);
  assert.match(r.stdout, /A real start would refuse now: another bench process is running/);
  assert.match(r.stdout, /canary token\s+kd-canar\.\.\./);
  assert.ok(!r.stdout.includes(sb.rec.canary.token));
  assert.match(r.stdout, /--run-credit-limit 8/);
  assert.match(r.stdout, /--arm-prefix k-main-forced=/);
  assert.deepEqual(fs.readdirSync(sb.base).sort(), before, 'dry-run created or removed nothing');
  const idle = driverSandbox({ procs: '' }).run(['--dry-run']);
  assert.match(idle.stdout, /would not be refused/);
  const filtered = driverSandbox({}).run(['--dry-run'], { PROBE_ONLY_ARM: 'k-canary', PROBE_REPLICATES: '2' });
  assert.match(filtered.stdout, /4 groups, 8 runs, 2 replicates/);
});

test('a real start refuses while a bench process runs, and creates no run directory or marker', () => {
  const sb = driverSandbox({ procs: 'node bench/runner/bench.js run --suite rootcause\n' });
  const r = sb.run([]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /REFUSING to start: another bench process is running/);
  assert.ok(!fs.existsSync(path.join(sb.base, 'runs')) && !fs.existsSync(path.join(sb.base, 'markers')) && !fs.existsSync(path.join(sb.base, 'run.pid')));
});

test('a real start refuses while the root-cause driver or its pid is alive', () => {
  const sb = driverSandbox({ procs: 'bash /var/tmp/rootcause/run-all.sh\n' });
  const r = sb.run([]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /root-cause driver is running/);
  const sb2 = driverSandbox({ procs: '' });
  const child = spawn('sleep', ['30']);
  try {
    const pidFile = path.join(sb2.base, 'rc.pid');
    fs.writeFileSync(pidFile, String(child.pid));
    const r2 = sb2.run([], { PROBE_ROOTCAUSE_PID: pidFile });
    assert.equal(r2.status, 3);
    assert.match(r2.stdout, /root-cause run is alive/);
    assert.ok(!fs.existsSync(path.join(sb2.base, 'runs')));
  } finally {
    child.kill();
  }
});

test('the groups table the driver reads has one line per group with spec, prefix and agent fields', () => {
  const sb = driverSandbox({});
  const r = spawnSync(process.execPath, [STUDY, 'groups', '--base', sb.base, '--only-agent', 'konductor'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => l.split('|'));
  assert.equal(lines.length, 5);
  for (const f of lines) assert.equal(f.length, 8);
  const forced = lines.find((f) => f[0] === 'k-main-forced');
  assert.match(forced[6], /^k-main-forced=.*constraints-kiro-cli\.txt$/);
  assert.equal(forced[7], '', 'the orchestrator group has no --arm-agent');
  const spec = lines.find((f) => f[0] === 'k-main');
  assert.equal(spec[6], '');
});

test('spent and status read only: they sum charged run credits and list markers', () => {
  const base = mkScratch('probe-status-');
  const dir = path.join(base, 'runs', 'k-main', 'k-tpm');
  fs.mkdirSync(path.join(dir, 'k-main', 'probe-canary', '1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'k-main', 'probe-canary', '1', 'result.json'), '{}');
  fs.writeFileSync(path.join(dir, 'credit-ledger.jsonl'), [{ kind: 'run', charged: 2.5 }, { kind: 'judge', charged: 9 }, { kind: 'run', credits: 1 }].map((x) => JSON.stringify(x)).join('\n') + '\n{torn');
  fs.mkdirSync(path.join(base, 'markers'));
  fs.writeFileSync(path.join(base, 'markers', 'k-main__k-tpm.started'), 'x');
  assert.equal(S.spentUnder(path.join(base, 'runs')), 3.5);
  const text = S.status(base);
  assert.match(text, /process: NOT RUNNING/);
  assert.match(text, /k-main__k-tpm\.started/);
  assert.match(text, /k-main \/ k-tpm\s+runs=\s*1 credits=\s*3\.5/);
  assert.match(text, /TOTAL charged: 3\.5/);
});
