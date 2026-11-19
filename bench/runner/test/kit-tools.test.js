// SPDX-License-Identifier: Apache-2.0
'use strict';

// The read-only helpers of the run kits (bench/kit): listing-check.js, rescore-by-limit.js, timeline.py and the PR 312
// probe's table.py, each on a small fixture, plus a byte-compile of every Python file and a consistency check of the
// probe's task files. No model, no cloud, no sandbox.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun, addTask } = require('./helpers.js');

const KIT = path.join(__dirname, '..', '..', 'kit', '2x2');
const PROBE = path.join(__dirname, '..', '..', 'kit', 'probes', 'pr312-skill-access');
const env = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG });
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: env(), timeout: 60000, ...opts });
const git = (cwd, ...a) => {
  const r = run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

test('every Python file in the kit byte-compiles', () => {
  const dir = tmp();
  const files = [path.join(KIT, 'timeline.py'), ...fs.readdirSync(PROBE).filter((f) => f.endsWith('.py')).map((f) => path.join(PROBE, f))];
  assert.equal(files.length, 3);
  for (const f of files) {
    // cfile keeps the .pyc out of the source tree
    const r = run('python3', ['-c', 'import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)', f, path.join(dir, `${path.basename(f)}c`)]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

// ---- listing-check.js
function listingRepo(extra = {}) {
  const root = tmp();
  const files = {
    'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Does alpha things.\n---\nbody\n',
    'skills/beta/SKILL.md': '---\nname: beta\ndescription: >\n  Does beta\n  things.\n---\nbody\n',
    'skills/hidden/SKILL.md': '---\nname: hidden\ndescription: Never listed.\ndisable-model-invocation: true\n---\nbody\n',
    'agent-sops/plan.sop.md': '# plan\n\n## Overview\n\nPlans the work. Second sentence.\n\n## Steps\nx\n',
    ...extra,
  };
  for (const [f, text] of Object.entries(files)) write(path.join(root, f), text);
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  return { root, sha: git(root, 'rev-parse', 'HEAD') };
}
const listing = (repo, sha, ...args) => run('node', [path.join(KIT, 'listing-check.js'), repo, sha, '--json', ...args]);

test('listing-check: counts listed skills, skips the hidden one, and exits 0 when none is name-only', () => {
  const { root, sha } = listingRepo();
  const r = listing(root, sha, '--sops', 'off');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.listed, 2);
  assert.equal(j.described, 2);
  assert.equal(j.nameOnly, 0);
  assert.equal(j.sopsListed, false);
  // 6,198 built-in chars, then "- alpha: Does alpha things.\n" and "- beta: Does beta things.\n"
  assert.equal(j.listingChars, 6198 + '- alpha: Does alpha things.\n'.length + '- beta: Does beta things.\n'.length);
});

test('listing-check: SOPs listed with the first Overview paragraph, as "sop-NAME"', () => {
  const { root, sha } = listingRepo();
  const r = listing(root, sha, '--sops', 'on');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.listed, 3);
  assert.equal(j.sopsListed, true);
  assert.equal(j.listingChars, 6198 + '- alpha: Does alpha things.\n'.length + '- beta: Does beta things.\n'.length + '- sop-plan: Plans the work. Second sentence.\n'.length);
});

test('listing-check: a budget that cannot hold every description leaves the late names name-only and exits 1', () => {
  const { root, sha } = listingRepo();
  const r = listing(root, sha, '--sops', 'off', '--budget', String(6198 + '- alpha: Does alpha things.\n'.length + 10));
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.described, 1);
  assert.deepEqual(j.nameOnlyNames, ['beta']);
});

test('listing-check: --sops auto reads the installer, and a wrong usage exits 2', () => {
  const dir = 'cli/konductor-rs/src/cli/install/claude.rs';
  const hides = listingRepo({ [dir]: 'fn x() { s.push_str("disable-model-invocation: true\\n"); }\n' });
  assert.equal(JSON.parse(listing(hides.root, hides.sha, '--sops', 'auto').stdout).sopsListed, false);
  const shows = listingRepo({ [dir]: 'fn x() {}\n' });
  assert.equal(JSON.parse(listing(shows.root, shows.sha, '--sops', 'auto').stdout).sopsListed, true);
  assert.equal(run('node', [path.join(KIT, 'listing-check.js')]).status, 2);
});

// ---- rescore-by-limit.js
function rescoreFixture() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  addTask(bench, 't2', 'simple');
  // an extra-tasks dir in the layout loadTasks reads: <id>.json beside fixtures/
  const extra = path.join(root, 'extra');
  for (const id of ['t1', 't2']) write(path.join(extra, `${id}.json`), fs.readFileSync(path.join(bench, 'tasks', `${id}.json`), 'utf8'));
  fs.cpSync(path.join(bench, 'fixtures'), path.join(extra, 'fixtures'), { recursive: true });
  const FAIL = [{ type: 'file_exists', path: 'a.txt', passed: false }];
  const specs = [];
  for (const task of ['t1', 't2']) {
    specs.push({ arm: 'vanilla', task, rep: 1, checks: FAIL, wallClockMs: 100000 });
    // the konductor run on t2 is slow: over 600 s, so it counts at the 600 s limit and not at 1800 s
    specs.push({ arm: 'konductor', task, rep: 1, wallClockMs: task === 't2' ? 700000 : 100000 });
  }
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  return { root, runDir, extra };
}
const rescore = (f, out, ...a) => run('node', [path.join(KIT, 'rescore-by-limit.js'), '--run', f.runDir, '--extra-tasks', f.extra, '--out', out, ...a]);

test('rescore-by-limit: counts runs over each limit and the three treatments move the difference as described', () => {
  const f = rescoreFixture();
  const out = path.join(f.root, 'out', 'rescore.md');
  const r = rescore(f, out, '--limits', '600,1800');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('| limit | runs over the limit'), 'the table is also printed');
  const rows = fs.readFileSync(out, 'utf8').split('\n').filter((l) => /^\| \d+ s /.test(l)).map((l) => l.split('|').map((c) => c.trim()));
  assert.equal(rows.length, 6, 'two limits x three treatments');
  const row = (limit, treat) => rows.find((c) => c[1] === `${limit} s` && c[3] === treat);
  assert.equal(row(600, 'asis')[2], '0 / 1', 'one konductor run is over 600 s');
  assert.equal(row(1800, 'asis')[2], '0 / 0');
  const num = (c) => Number(c[5]);
  assert.equal(row(600, 'asis')[4], '2');
  assert.equal(row(600, 'drop')[4], '1', 'the over-limit run is dropped, so the task has no konductor score');
  assert.ok(num(row(600, 'zero')) < num(row(600, 'asis')), 'zeroing the slow run lowers konductor minus vanilla');
  assert.equal(row(1800, 'asis')[5], row(1800, 'drop')[5], 'nothing is over 1800 s, so the treatments agree');
  assert.equal(row(1800, 'asis')[5], row(1800, 'zero')[5]);
});

test('rescore-by-limit: needs --run, and refuses a BENCH_ROOT that is not a bench directory', () => {
  const root = tmp();
  const r = run('node', [path.join(KIT, 'rescore-by-limit.js'), '--run', root, '--out', path.join(root, 'o.md')], { env: { ...env(), BENCH_ROOT: root } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a bench directory; set BENCH_ROOT/);
});

// ---- timeline.py
test('timeline.py: a Claude Code stream over the limit gets a timeline, a shorter run does not', () => {
  const root = tmp();
  const base = path.join(root, 'run', 'cc-konductor', 'task-a', '1');
  write(path.join(base, 'result.json'), JSON.stringify({ status: 'timeout', wallClockMs: 700000 }));
  const events = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'plan' } }, { type: 'text', text: 'drafting' }] } },
    { type: 'system', subtype: 'task_started', subagent_type: 'k-architect', description: 'review the draft' },
    { type: 'system', subtype: 'task_notification', status: 'completed', usage: { duration_ms: 240000 } },
  ];
  write(path.join(base, 'stream.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const quick = path.join(root, 'run', 'cc-konductor', 'task-b', '1');
  write(path.join(quick, 'result.json'), JSON.stringify({ status: 'success', wallClockMs: 60000 }));
  write(path.join(quick, 'stream.jsonl'), '');
  const out = path.join(root, 'out');
  const r = run('python3', [path.join(KIT, 'timeline.py'), '--run', path.join(root, 'run'), '--min-sec', '600', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 timeline\(s\)/);
  const index = fs.readFileSync(path.join(out, 'timelines.md'), 'utf8');
  assert.match(index, /task-a/);
  assert.doesNotMatch(index, /task-b/);
  const files = fs.readdirSync(out).filter((f) => f !== 'timelines.md');
  assert.equal(files.length, 1);
  const page = fs.readFileSync(path.join(out, files[0]), 'utf8');
  assert.match(page, /Why it ran long/);
  assert.match(page, /k-architect/);
  assert.match(page, /Verdict: delegated review at the end/);
});

// ---- PR 312 probe
test('probe: twelve task files, one expected skill per number, and every task is the same shape', () => {
  const tasks = fs.readdirSync(path.join(PROBE, 'tasks')).filter((f) => /^pr312-probe-\d\d-.*\.json$/.test(f)).sort();
  assert.equal(tasks.length, 12);
  const expected = JSON.parse(fs.readFileSync(path.join(PROBE, 'expected.json'), 'utf8'));
  assert.deepEqual(Object.keys(expected).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => String(i + 1)));
  tasks.forEach((f, i) => {
    const t = JSON.parse(fs.readFileSync(path.join(PROBE, 'tasks', f), 'utf8'));
    assert.equal(`${t.id}.json`, f);
    assert.equal(expected[String(i + 1)], f.replace(/^pr312-probe-\d\d-/, '').replace(/\.json$/, ''), `${f} is probe ${i + 1}`);
    assert.equal(t.fixture, 'probe-repo');
    assert.ok(fs.existsSync(path.join(PROBE, 'tasks', 'fixtures', t.fixture)));
    assert.ok(!t.prompt.includes(expected[String(i + 1)]), `${f}: the prompt must not name the skill`);
  });
});

test('probe: table.py reads the first get_skill call of each run and marks an alternate skill as OK', () => {
  const root = tmp();
  const mk = (num, slug, session, status = 'success') => {
    const dir = path.join(root, 'konductor', `pr312-probe-${num}-${slug}`, '1');
    write(path.join(dir, 'result.json'), JSON.stringify({ taskId: `pr312-probe-${num}-${slug}`, status, subagentCalls: 0, skillCallsFailed: 0 }));
    if (session) {
      const call = (ts, name) => ({ timestamp: ts, payload: { type: 'tool_call', args: { name: 'get_skill', arguments: { name } } } });
      write(path.join(dir, 'session', 'sess_1', 'messages.jsonl'), session.map(([ts, n]) => JSON.stringify(call(ts, n))).join('\n') + '\n');
    }
  };
  mk('01', 'dynamodb-design', [['2026-11-19T10:00:00.000Z', 'dynamodb-design']]);
  mk('06', 'decision-writing', [['2026-11-19T10:00:05.000Z', 'program-decision-docs'], ['2026-11-19T10:00:09.000Z', 'decision-writing']]);
  mk('02', 'requirements-extraction', [['2026-11-19T10:00:00.000Z', 'sprint-planning']]);
  mk('03', 'e2e-test-strategy', null);
  const r = run('python3', [path.join(PROBE, 'table.py'), '--run', path.join(root)]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| dynamodb-design \(1\) \| dynamodb-design \| dynamodb-design \| main \| 0 \| 0 \| success \| yes \|/);
  assert.match(r.stdout, /decision-writing \(6\) \| decision-writing \| program-decision-docs \| main .*\| yes \|/, 'a listed alternate is a fair first load');
  assert.match(r.stdout, /requirements-extraction \(2\) \| requirements-extraction \| sprint-planning .*\| NO \|/);
  assert.match(r.stdout, /e2e-test-strategy \(3\) \| e2e-test-strategy \| none .*\| NO \|/);
  assert.match(r.stdout, /2 of 4 prompts loaded the expected skill first/);
});
