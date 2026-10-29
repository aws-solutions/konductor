// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pilot suite reuses tasks from other suites. A task keeps its own tier and gains "pilot", so one task can sit
// in several tiers and one suite can mix classes. The older suites must not change.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { loadTasks, loadSuite, SUITE_DEFAULTS, BENCH_DIR } = require('../lib/tasks.js');
const { checkPanel } = require('../../judge/config.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const PILOT_TASKS = [
  'orch-input-validation', 'review-inventory-security', 'design-hold-service',
  'real-click-3473-argument-help', 'real-rich-3934-empty-live',
  'autonomy-gateway-throttle', 'autonomy-merge-customers', 'autonomy-format-bytes',
];
const OWN_TIER = { orchestration: ['lite', 'full'], review: ['lite', 'full'], design: ['lite', 'full'], real: ['real'], autonomy: ['autonomy'] };

test('the shipped pilot suite lists the eight tasks, three arms, one replicate, parallel 1 and a three-family panel', () => {
  const tasks = loadTasks(BENCH_DIR);
  const s = loadSuite('pilot', tasks, BENCH_DIR);
  assert.deepEqual(s.taskIds, PILOT_TASKS);
  assert.deepEqual(s.arms, ['vanilla', 'v1.2.0', 'main']);
  assert.equal(s.replicates, 1);
  assert.equal(s.parallel, 1);
  assert.equal(s.judges.length, 3);
  assert.doesNotThrow(() => checkPanel(s.judges));
});

test('each pilot task keeps its own tiers and gains pilot; the other tasks do not gain it', () => {
  const tasks = loadTasks(BENCH_DIR);
  for (const t of tasks.values()) {
    if (PILOT_TASKS.includes(t.id)) {
      assert.deepEqual([...t.tiers].sort(), [...OWN_TIER[t.class], 'pilot'].sort(), t.id);
    } else {
      assert.ok(!t.tiers.includes('pilot'), `${t.id} is not a pilot task`);
    }
  }
});

test('the lite, full, hard, real and autonomy suites contain what they contained before', () => {
  const tasks = loadTasks(BENCH_DIR);
  const ids = (n) => loadSuite(n, tasks, BENCH_DIR).taskIds;
  assert.deepEqual(ids('lite'), ['simple-fix-failing-test', 'simple-explain-file', 'orch-input-validation', 'review-inventory-security', 'design-hold-service']);
  assert.equal(ids('full').length, 24);
  assert.ok(!ids('full').some((id) => id.startsWith('real-') || id.startsWith('autonomy-') || id.startsWith('hard-')));
  assert.equal(ids('hard').length, 6);
  assert.equal(ids('real').length, 8);
  assert.equal(ids('autonomy').length, 6);
  for (const n of ['lite', 'full', 'hard', 'real', 'autonomy']) assert.ok(!ids(n).includes('pilot'));
});

test('the loader takes a task in several tiers and a suite of mixed tiers; unknown tiers are still refused', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const base = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
    write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...base, tiers: ['lite', 'full', 'pilot'] }));
    write(path.join(bench, 'tasks/t2.json'), JSON.stringify({ ...base, id: 't2', tiers: ['hard', 'pilot'] }));
    write(path.join(bench, 'tasks/t3.json'), JSON.stringify({ ...base, id: 't3', tiers: ['lite'] }));
    const tasks = loadTasks(bench);
    const s = loadSuite('pilot', tasks, bench);
    assert.deepEqual(s.taskIds, ['t1', 't2'], 'without a suite file the pilot tier selects its tagged tasks');
    assert.equal(SUITE_DEFAULTS.pilot.parallel, 1);
    write(path.join(bench, 'suites/pilot.json'), JSON.stringify({ tasks: ['t2', 't1'], replicates: 2 }));
    const withFile = loadSuite('pilot', tasks, bench);
    assert.deepEqual(withFile.taskIds, ['t2', 't1']);
    assert.equal(withFile.replicates, 2);
    assert.deepEqual(loadSuite('lite', tasks, bench).taskIds, ['t1', 't3']);
    write(path.join(bench, 'tasks/t4.json'), JSON.stringify({ ...base, id: 't4', tiers: ['lite', 'nightly'] }));
    assert.throws(() => loadTasks(bench), /tiers/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unknown suite name lists pilot among the valid ones', () => {
  const r = spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'nightly'], { env: { PATH: process.env.PATH, HOME: tmp() }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /lite\|full\|hard\|real\|autonomy\|pilot/);
});

function sandbox() {
  const root = tmp();
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  return { root, cli: (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { env: { PATH: process.env.PATH, HOME: home, TMPDIR: root }, encoding: 'utf8' }) };
}

test('list-arms works, and pr-plan --suite pilot refuses to guess credits unless --budget-credits is given', () => {
  const s = sandbox();
  try {
    const arms = s.cli(['list-arms']);
    assert.equal(arms.status, 0, arms.stderr);
    assert.match(arms.stdout, /vanilla/);
    const refused = s.cli(['pr-plan', '--ref', 'opt-a=main', '--suite', 'pilot']);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /no observed credits for pilot/);
    assert.match(refused.stderr, /--budget-credits/);
    const planned = s.cli(['pr-plan', '--ref', 'opt-a=main', '--suite', 'pilot', '--budget-credits', '120']);
    assert.equal(planned.status, 0, planned.stderr);
    assert.match(planned.stdout, /on the pilot suite \(8 task\(s\), 1 replicate\)/);
    assert.match(planned.stdout, /No estimate:/);
    assert.match(planned.stdout, /run --suite pilot --arms vanilla,v1\.2\.0,opt-a=main .*--budget-credits 120 /);
    assert.match(planned.stdout, /contrast --run .* --base v1\.2\.0/);
    assert.equal(fs.readdirSync(s.root).filter((f) => f !== 'home').length, 0, 'plans only; nothing is created');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

// The real validator script on copies of bench/ with a few tasks kept. Other suites then disagree with the task
// set, so only the lines about the kept tasks and the pilot suite are read.
function validateCopy(keep, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'val-'));
  fs.cpSync(BENCH_DIR, path.join(root, 'bench'), { recursive: true, filter: (p) => path.basename(p) !== 'results' });
  const bench = path.join(root, 'bench');
  const used = new Set();
  for (const f of fs.readdirSync(path.join(bench, 'tasks'))) {
    if (!f.endsWith('.json')) continue;
    if (keep.includes(f.slice(0, -5))) used.add(JSON.parse(fs.readFileSync(path.join(bench, 'tasks', f), 'utf8')).fixture);
    else fs.rmSync(path.join(bench, 'tasks', f));
  }
  for (const f of fs.readdirSync(path.join(bench, 'fixtures'))) if (!used.has(f)) fs.rmSync(path.join(bench, 'fixtures', f), { recursive: true, force: true });
  mutate(bench);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(bench, 'tasks/validate-tasks.js')], { cwd: root, env: { PATH: process.env.PATH, HOME: path.join(root, 'home') } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => { fs.rmSync(root, { recursive: true, force: true }); resolve({ code, out }); });
  });
}

const editTask = (id, fn) => (bench) => {
  const file = path.join(bench, 'tasks', `${id}.json`);
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(t, bench);
  fs.writeFileSync(file, JSON.stringify(t));
};
const errorsAbout = (out, re) => out.split('\n').filter((l) => l.startsWith('error:') && re.test(l));

test('the validator accepts pilot on lite and autonomy tasks and still rejects a task that lost its own tier', async () => {
  const lite = 'orch-input-validation';
  const auto = 'autonomy-format-bytes';
  const [ok, pilotOnlyLite, pilotOnlyAuto, autoFull, suiteMismatch, suiteParallel] = await Promise.all([
    validateCopy([lite, auto], () => {}),
    validateCopy([lite], editTask(lite, (t) => { t.tiers = ['pilot']; })),
    validateCopy([auto], editTask(auto, (t) => { t.tiers = ['pilot']; })),
    validateCopy([auto], editTask(auto, (t) => { t.tiers = ['autonomy', 'full']; })),
    validateCopy([lite], (bench) => {
      const f = path.join(bench, 'suites/pilot.json');
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      s.tasks = [lite, 'simple-fix-failing-test'];
      fs.writeFileSync(f, JSON.stringify(s));
    }),
    validateCopy([lite], (bench) => {
      const f = path.join(bench, 'suites/pilot.json');
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      s.parallel = 3;
      fs.writeFileSync(f, JSON.stringify(s));
    }),
  ]);
  assert.deepEqual(errorsAbout(ok.out, new RegExp(`^error: (${lite}|${auto})[.:]`)), []);
  assert.match(ok.out, /autonomy autonomy-format-bytes: reference 8\/8/);
  assert.match(pilotOnlyLite.out, /error: orch-input-validation\.json: every task must include the full tier/);
  assert.match(pilotOnlyAuto.out, /error: autonomy-format-bytes\.json: tiers must be \["autonomy"\] \(and optionally "pilot"\)/);
  assert.match(autoFull.out, /error: autonomy-format-bytes\.json: tiers must be \["autonomy"\] \(and optionally "pilot"\)/);
  assert.match(suiteMismatch.out, /error: suites\/pilot\.json: tasks do not match the tasks tagged "pilot"/);
  assert.match(suiteParallel.out, /error: suites\/pilot\.json: parallel must be 1/);
});

test('the validator accepts pilot on a real task and rejects a real task without its real tier', async () => {
  const real = 'real-rich-3934-empty-live';
  const [ok, lost] = await Promise.all([
    validateCopy([real], () => {}),
    validateCopy([real], editTask(real, (t) => { t.tiers = ['pilot']; })),
  ]);
  assert.deepEqual(errorsAbout(ok.out, new RegExp(`^error: ${real}[.:]`)), []);
  assert.match(lost.out, /error: real-rich-3934-empty-live\.json: real tasks must have tiers \["real"\] \(and optionally "pilot"\) only/);
});

test('run --suite pilot executes tasks of different classes in one run; only the autonomy task records a conversation', () => {
  const { makeFakeKiro } = require('./fake-kiro.js');
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const base = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
    write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...base, tiers: ['lite', 'full', 'pilot'] }));
    write(path.join(bench, 'tasks/t2.json'), JSON.stringify({
      ...base, id: 't2', class: 'autonomy', tiers: ['autonomy', 'pilot'],
      autonomy: { clarifications: [{ id: 'unit', topic: 'unit', keywords: ['seconds'], answer: 'Seconds.' }] },
    }));
    write(path.join(bench, 'suites/pilot.json'), JSON.stringify({ tasks: ['t1', 't2'], arms: ['vanilla'], replicates: 1, parallel: 1 }));
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(path.join(root, 'bin'), { dir: probe, sessionJson: true, turns: [{ finalText: 'Seconds or milliseconds?', credits: 1 }, { finalText: 'Done.', credits: 2 }] });
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.local/share/kiro-cli'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local/share/kiro-cli/data.sqlite3'), 'fake-auth');
    const tmpdir = path.join(root, 'tmp');
    fs.mkdirSync(tmpdir);
    const out = path.join(root, 'out');
    const env = { PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: home, TMPDIR: tmpdir };
    const run = spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'pilot', '--isolate', 'none', '--bench-dir', bench, '--out', out, '--cache', path.join(root, 'cache')], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const r1 = JSON.parse(fs.readFileSync(path.join(out, 'vanilla/t1/1/result.json'), 'utf8'));
    const r2 = JSON.parse(fs.readFileSync(path.join(out, 'vanilla/t2/1/result.json'), 'utf8'));
    assert.equal(r1.status, 'success', r1.error);
    assert.equal(r2.status, 'success', r2.error);
    assert.equal(r1.turns, undefined, 'a non-autonomy task is a single turn with no conversation fields');
    assert.ok(r2.turns >= 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).suite, 'pilot');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
