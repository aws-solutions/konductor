// SPDX-License-Identifier: Apache-2.0
'use strict';

// The references-read study tooling: the plan and its arithmetic, the arm checks and prefix files, the refusal logic and
// the generated driver in dry-run mode. No model call, no build, no run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn, execFileSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const S = require('../../scripts/refs-study.js');

const STUDY = path.join(__dirname, '..', '..', 'scripts', 'refs-study.js');
const REPO = path.resolve(__dirname, '..', '..', '..');
const real = JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'suites', 'references-read.manifest.json'), 'utf8'));

// A tiny repository with one commit per ref of the manifest, holding the files each ref must carry.
function tinyRepo() {
  const dir = mkScratch('refs-repo-');
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' }).trim();
  g('init', '-q');
  const manifest = JSON.parse(JSON.stringify(real));
  for (const key of Object.keys(manifest.refs)) {
    for (const f of manifest.refs[key].requires) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), `${key} ${f}\n`); }
    g('add', '.');
    g('commit', '-q', '-m', key);
    manifest.refs[key].sha = g('rev-parse', 'HEAD');
  }
  return { dir, manifest };
}

test('the default plan: 9 groups, 27 runs, and the arithmetic adds up and stays under 100 credits at the mid estimate', () => {
  const p = S.plan();
  assert.equal(p.groups.length, 9);
  assert.equal(p.runs, 27);
  assert.equal(p.replicates, 3);
  assert.ok(Math.abs(p.creditsMid - 88.5) < 1e-9);
  assert.ok(p.creditsMid < 100);
  assert.ok(Math.abs(p.creditsLow - 53.1) < 1e-9 && Math.abs(p.creditsHigh - 141.6) < 1e-9);
  assert.equal(p.budgetSum, p.groups.reduce((n, g) => n + g.budget, 0));
  assert.ok(p.cap >= p.budgetSum && p.cap % 10 === 0 && p.cap - p.budgetSum < 10);
  for (const g of p.groups) assert.ok(g.budget >= g.creditsMid, `${g.arm}/${g.entry} budget below its mid estimate`);
  const per = (arm) => p.groups.filter((g) => g.arm === arm).reduce((n, g) => n + g.runs, 0);
  assert.deepEqual(['refs-main', 'refs-main-forced', 'refs-pr155', 'refs-pr155-forced', 'refs-asana', 'refs-asana-forced', 'refs-readable'].map(per), [6, 6, 3, 3, 3, 3, 3]);
});

test('each group runs one task of its entry agent: dynamodb under the architect, sprint under the product manager', () => {
  for (const g of S.plan().groups) {
    for (const t of g.tasks) assert.equal(real.tasks[t].owner, g.entry, `${g.arm}: ${t}`);
  }
  assert.ok(S.plan().groups.every((g) => g.tasks.length === 1));
});

test('replicate and arm filters change the plan the way the driver hooks do', () => {
  assert.equal(S.plan({ replicates: 2 }).runs, 18);
  assert.equal(S.plan({ arms: ['refs-pr155', 'refs-pr155-forced'] }).runs, 6);
  assert.equal(S.plan({ onlyArm: 'refs-readable' }).runs, 3);
  assert.equal(S.plan({ onlyArm: 'nope' }).runs, 0);
});

test('the plan text always states counts, the cap and the per-run limit', () => {
  const text = S.formatPlan(S.plan());
  assert.match(text, /9 groups, 27 runs, 3 replicates/);
  assert.match(text, /TOTAL\s+27\s+53\.1\s+88\.5\s+141\.6\s+136/);
  assert.match(text, /Credit cap for the whole study: 140/);
  assert.match(text, /--run-credit-limit 8/);
});

test('buildArms: checks the pinned commits and files, writes one prefix per skill, and leaves the repository clean', () => {
  const { dir, manifest } = tinyRepo();
  const base = mkScratch('refs-base-');
  const rec = S.buildArms({ base, repo: dir, manifest });
  assert.deepEqual(Object.keys(rec.prefixes).sort(), ['asana-sprint-planning', 'dynamodb-design', 'sprint-planning']);
  assert.match(rec.prefixes['dynamodb-design'].text, /load the skill named "dynamodb-design"/);
  assert.equal(fs.readFileSync(rec.prefixes['dynamodb-design'].file, 'utf8'), `${rec.prefixes['dynamodb-design'].text}\n`);
  assert.equal(rec.arms['refs-pr155'].spec, `refs-pr155=${manifest.refs.pr155.sha}`);
  assert.equal(rec.arms['refs-main-forced'].spec, `refs-main-forced=${manifest.refs.main.sha}`);
  assert.equal(rec.arms['refs-readable'].spec, `refs-readable=${manifest.refs.pr155.sha}`);
  assert.equal(rec.arms['refs-asana'].forced, false);
  assert.equal(rec.refs.main.onRemote, false, 'a tiny repo has no remote branch');
  assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }), '');
});

test('buildArms refuses a short commit id, a missing commit and a missing reference file', () => {
  const { dir, manifest } = tinyRepo();
  const base = mkScratch('refs-base-');
  const short = JSON.parse(JSON.stringify(manifest));
  short.refs.main.sha = short.refs.main.sha.slice(0, 12);
  assert.throws(() => S.buildArms({ base, repo: dir, manifest: short }), /full commit id/);
  const missing = JSON.parse(JSON.stringify(manifest));
  missing.refs.asana.sha = '0'.repeat(40);
  assert.throws(() => S.buildArms({ base, repo: dir, manifest: missing }), /not in/);
  const nofile = JSON.parse(JSON.stringify(manifest));
  nofile.refs.pr155.requires = ['skills/none/references/x.md'];
  assert.throws(() => S.buildArms({ base, repo: dir, manifest: nofile }), /not found in pr155/);
});

test('buildArms with freeze extracts each commit to a directory and the arms use dir: specs', () => {
  const { dir, manifest } = tinyRepo();
  const base = mkScratch('refs-base-');
  const rec = S.buildArms({ base, repo: dir, manifest, freeze: true });
  assert.equal(rec.arms['refs-asana'].spec, `refs-asana=dir:${path.join(base, 'trees', 'asana')}`);
  assert.ok(fs.existsSync(path.join(base, 'trees', 'asana', 'skills', 'sprint-planning', 'references', 'asana.md')));
});

test('refusal: another bench process, the root-cause driver, a live root-cause pid or a running study each refuse; an idle host does not', () => {
  const dir = mkScratch('refs-ref-');
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
  assert.equal(S.refusalReason({ procs: 'node bench/scripts/refs-study.js plan\nnode bench/runner/bench.js refs-report --run x --out y\ngrep bench/runner/bench.js' }), null);
});

test('the generated driver carries the run flags, the guards and no internal marker', () => {
  const text = S.renderDriver({ base: '/b', repo: '/r' });
  for (const needle of ['--suite references-read', '--agent-engine v3', '--model claude-sonnet-5.5', '--parallel 1', '--run-credit-limit 8', 'REFS_CACHE:-/var/tmp/pilot-2x2/cache', 'REFS_CARGO_TARGET:-/var/tmp/pilot-2x2/cargo-target', '--seed 1',
    "unset \"$v\"", 'export TMPDIR', '--prepare-only', '.done', '.partial-', '< /dev/null', 'exit 3', '--arm-prefix', '--arm-agent', 'refs-report']) assert.ok(text.includes(needle), needle);
  const pieces = [['amaz', 'on\\.(com|dev)'], ['aws\\.', 'dev'], ['co', 'rp'], ['qu', 'ip'], ['bra', 'zil'], ['cr', 'ux'], ['mid', 'way'], ['isen', 'gard'], ['dev-', 'dsk'], ['asd', 'lc'], ['solne', 'xus'], ['tool', 'box'], ['nihit', 'kas']];
  const internal = new RegExp(pieces.map(([a, b]) => a + b).join('|') + '|\\b' + 'A' + 'IM\\b', 'i');
  assert.doesNotMatch(text, internal);
  assert.doesNotMatch(fs.readFileSync(STUDY, 'utf8'), internal);
  assert.doesNotMatch(S.renderStatusScript({}), internal);
});

function driverSandbox({ procs = '' } = {}) {
  const { dir, manifest } = tinyRepo();
  const base = mkScratch('refs-drv-');
  const rec = S.buildArms({ base, repo: dir, manifest });
  fs.writeFileSync(path.join(base, 'run-all.sh'), S.renderDriver({ base, repo: REPO }));
  const procFile = path.join(base, 'procs.txt');
  fs.writeFileSync(procFile, procs);
  const env = { PATH: process.env.PATH, HOME: base, REFS_BASE: base, REFS_REPO: REPO, REFS_PROC_LIST: procFile, REFS_ROOTCAUSE_PID: path.join(base, 'no-such.pid') };
  const run = (args = [], extra = {}) => spawnSync('bash', [path.join(base, 'run-all.sh'), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { base, rec, run, procFile };
}

test('driver --dry-run prints the plan, the refusal state and the commands, and writes nothing', () => {
  const sb = driverSandbox({ procs: 'node bench/runner/bench.js run --suite rootcause --tasks a\n' });
  const before = fs.readdirSync(sb.base).sort();
  const r = sb.run(['--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /9 groups, 27 runs/);
  assert.match(r.stdout, /A real start would refuse now: another bench process is running/);
  assert.match(r.stdout, /--run-credit-limit 8/);
  assert.match(r.stdout, /--arm-prefix refs-pr155-forced=.*dynamodb-design\.txt --arm-agent refs-pr155-forced=k-architect/);
  assert.match(r.stdout, /--arm-agent refs-asana=k-product-manager/);
  assert.deepEqual(fs.readdirSync(sb.base).sort(), before, 'dry-run created or removed nothing');
  const idle = driverSandbox({ procs: '' }).run(['--dry-run']);
  assert.match(idle.stdout, /would not be refused/);
  const filtered = driverSandbox({}).run(['--dry-run'], { REFS_ONLY_ARM: 'refs-readable', REFS_REPLICATES: '2' });
  assert.match(filtered.stdout, /1 groups, 2 runs, 2 replicates/);
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
    const r2 = sb2.run([], { REFS_ROOTCAUSE_PID: pidFile });
    assert.equal(r2.status, 3);
    assert.match(r2.stdout, /root-cause run is alive/);
    assert.ok(!fs.existsSync(path.join(sb2.base, 'runs')));
  } finally {
    child.kill();
  }
});

test('the groups table the driver reads has one line per group with spec, prefix and agent fields', () => {
  const sb = driverSandbox({});
  const r = spawnSync(process.execPath, [STUDY, 'groups', '--base', sb.base], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => l.split('|'));
  assert.equal(lines.length, 9);
  for (const f of lines) assert.equal(f.length, 8);
  const forced = lines.find((f) => f[0] === 'refs-main-forced' && f[1] === 'k-product-manager');
  assert.match(forced[6], /^refs-main-forced=.*asana-sprint-planning\.txt$/);
  assert.equal(forced[7], 'refs-main-forced=k-product-manager');
  const plain = lines.find((f) => f[0] === 'refs-pr155');
  assert.equal(plain[6], '');
});

test('spent and status read only: they sum charged run credits and list markers', () => {
  const base = mkScratch('refs-status-');
  const dir = path.join(base, 'runs', 'refs-pr155', 'k-architect');
  fs.mkdirSync(path.join(dir, 'refs-pr155', 'refs-dynamodb-design', '1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'refs-pr155', 'refs-dynamodb-design', '1', 'result.json'), '{}');
  fs.writeFileSync(path.join(dir, 'credit-ledger.jsonl'), [{ kind: 'run', charged: 2.5 }, { kind: 'judge', charged: 9 }, { kind: 'run', credits: 1 }].map((x) => JSON.stringify(x)).join('\n') + '\n{torn');
  fs.mkdirSync(path.join(base, 'markers'));
  fs.writeFileSync(path.join(base, 'markers', 'refs-pr155__k-architect.started'), 'x');
  assert.equal(S.spentUnder(path.join(base, 'runs')), 3.5);
  const text = S.status(base);
  assert.match(text, /process: NOT RUNNING/);
  assert.match(text, /refs-pr155__k-architect\.started/);
  assert.match(text, /refs-pr155 \/ k-architect\s+runs=\s*1 credits=\s*3\.5/);
  assert.match(text, /TOTAL charged: 3\.5/);
});
