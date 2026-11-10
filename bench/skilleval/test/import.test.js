// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { main } = require('../import.js');
const lib = require('../lib/import.js');
const { convertCheck } = require('../lib/import-checks.js');
const { loadTasks } = require('../../runner/lib/tasks.js');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'skilleval-import-test-')); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const rubricItem = (id, dimension = 'process') => ({ id, dimension, criterion: `Does the thing ${id}`, pass: 'Done', partial: 'Half', fail: 'None' });

// An eval data tree with the skills alpha (one fixture with a key, one nested file) and beta.
function makeEvals(root, { scenario = {}, evals = null, queries = [] } = {}) {
  const skill = path.join(root, 'alpha');
  put(path.join(skill, 'fixtures', 'alpha', 'sub', 'docs', 'a.md'), '# A\n');
  put(path.join(skill, 'fixtures', 'alpha', 'sub', 'top.txt'), 'top\n');
  put(path.join(skill, 'fixtures', 'alpha.KEY.md'), 'secret key\n');
  const prompt = 'Review docs/a.md and write report.md.';
  put(path.join(skill, 'scenario.json'), JSON.stringify({
    skill: 'alpha', limited: false,
    prompts: [{
      id: 'p1', prompt, fixture: 'fixtures/alpha/sub/',
      floor_checks: [
        { id: 'f1', text: 'Report exists', check: 'test -f report.md' },
        { id: 'f2', text: 'Report names the heading', check: "grep -qi 'heading' report.md" },
        { id: 'f3', text: 'Report passes a script', check: 'python3 -c "print(1)"' },
      ],
      rubric: [rubricItem('r1'), rubricItem('r2', 'restraint'), rubricItem('r3')],
    }],
    ...scenario,
  }));
  put(path.join(skill, 'evals.json'), JSON.stringify({
    skill_name: 'alpha',
    evals: evals ?? [
      { id: 0, name: 'paired', scenario_prompt_id: 'p1', prompt, files: ['fixtures/alpha/sub/'], expectations: ['a', 'b', 'c'], scripted_checks: [{ text: 'Mentions risk', check: "grep -qi 'risk' report.md" }] },
      { id: 1, name: 'only', scenario_prompt_id: 'e1', prompt: 'Write notes.md from docs/a.md.', files: [], expectations: ['Writes notes', 'Does not invent facts', 'Cites the doc'], scripted_checks: [] },
    ],
  }));
  put(path.join(skill, 'queries.json'), JSON.stringify(queries));
  const beta = path.join(root, 'beta');
  put(path.join(beta, 'scenario.json'), JSON.stringify({ skill: 'beta', limited: false, prompts: [{ id: 'p1', prompt: 'Do beta.', fixture: null, rubric: [rubricItem('r1'), rubricItem('r2'), rubricItem('r3')] }] }));
}

const git = (present) => ({ skillsAtRef: () => new Set(present), resolveRef: () => 'a'.repeat(40), skillBlob: () => 'b'.repeat(40) });
const run = (argv, deps) => { const lines = []; const result = main(argv, (l) => lines.push(l), deps); return { lines, result }; };

function digest(root) {
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r); else h.update(`${r}\0`).update(fs.readFileSync(path.join(root, r)));
    }
  };
  walk('');
  return h.digest('hex');
}

test('a skill that is absent from the ref is skipped and writes nothing', () => {
  const evals = tmp(); const out = tmp();
  makeEvals(evals);
  const { lines } = run(['tasks', '--skill', 'alpha,beta', '--ref', 'some-ref', '--out', out, '--evals-dir', evals], git(['alpha']));
  assert.ok(lines.includes('beta: skipped: not in some-ref'));
  assert.ok(fs.existsSync(path.join(out, 'alpha', 'tasks')));
  assert.ok(!fs.existsSync(path.join(out, 'beta')));
});

test('a nested fixture is flattened to one name and the key becomes .bench-answer-key.md', () => {
  const evals = tmp(); const out = tmp();
  makeEvals(evals);
  run(['tasks', '--skill', 'alpha', '--ref', 'r', '--out', out, '--evals-dir', evals], git(['alpha']));
  const fx = path.join(out, 'alpha', 'tasks', 'fixtures', 'fx-alpha-sub');
  assert.equal(fs.readFileSync(path.join(fx, 'docs', 'a.md'), 'utf8'), '# A\n');
  assert.equal(fs.readFileSync(path.join(fx, '.bench-answer-key.md'), 'utf8'), 'secret key\n');
  assert.ok(!fs.readdirSync(path.join(out, 'alpha', 'tasks', 'fixtures')).some((n) => n.endsWith('.KEY.md')));
  const task = JSON.parse(fs.readFileSync(path.join(out, 'alpha', 'tasks', 'si-alpha-p1.json'), 'utf8'));
  assert.equal(task.fixture, 'fx-alpha-sub');
});

test('a check the schema cannot express becomes a guard rubric item and is not dropped', () => {
  const evals = tmp(); const out = tmp();
  makeEvals(evals);
  run(['tasks', '--skill', 'alpha', '--ref', 'r', '--out', out, '--evals-dir', evals], git(['alpha']));
  const task = JSON.parse(fs.readFileSync(path.join(out, 'alpha', 'tasks', 'si-alpha-p1.json'), 'utf8'));
  assert.deepEqual(task.checks.map((c) => c.type), ['file_exists', 'contains', 'contains']);
  assert.ok(task.rubric.some((r) => r.id.startsWith('guard-') && r.criterion === 'Report passes a script.'));
  assert.equal(task.rubric.filter((r) => r.id.startsWith('value-')).length, 2);
  assert.ok(task.prompt.endsWith('finish the work.'));
});

test('convertCheck maps simple commands, keeps safe pipelines as cmd and rejects other tools', () => {
  assert.deepEqual(convertCheck('test -f out.md').checks, [{ type: 'file_exists', path: 'out.md' }]);
  assert.deepEqual(convertCheck("grep -qiE 'a|b' out.md").checks, [{ type: 'contains', path: 'out.md', pattern: 'a|b' }]);
  assert.deepEqual(convertCheck("! grep -q 'TODO' out.md").checks, [{ type: 'not_contains', path: 'out.md', pattern: 'TODO' }]);
  assert.equal(convertCheck("test -f out.md && grep -q 'x' out.md").checks.length, 2);
  assert.equal(convertCheck("grep -q 'a\\|b' out.md").checks[0].type, 'cmd');
  assert.equal(convertCheck("grep -c x out.md | wc -l").checks[0].type, 'cmd');
  assert.match(convertCheck('python3 -c "1"').unsupported, /python3/);
  assert.match(convertCheck('sha256sum -c sums.txt').unsupported, /sha256sum/);
  assert.match(convertCheck("grep -qiE 'verdict|ready' report.md").unsupported, /verdict/);
  assert.match(convertCheck('grep -q x a.md && [ "$(md5sum b.docx | cut -d" " -f1)" = abc ]').unsupported, /md5sum/);
});

test('a prompt that forbids edits gets a fixture_unchanged guard when the fixture has files', () => {
  const evals = tmp();
  makeEvals(evals);
  const file = path.join(evals, 'alpha', 'scenario.json');
  const scen = JSON.parse(fs.readFileSync(file, 'utf8'));
  scen.prompts[0].prompt = 'Review docs/a.md. Do not change any source files. Write report.md.';
  fs.writeFileSync(file, JSON.stringify(scen));
  const plan = lib.planSkill({ skill: 'alpha', evalsDir: evals });
  const guard = { type: 'fixture_unchanged', path: '.', allowAdditions: true };
  assert.deepEqual(plan.tasks.find((t) => t.task.id === 'si-alpha-p1').task.checks.at(-1), guard);
  assert.ok(!plan.tasks.find((t) => t.task.id === 'si-alpha-e1').task.checks.some((c) => c.type === 'fixture_unchanged'));
});

test('eval cases: a paired case with the same prompt folds into its scenario, an eval-only case gets its own tagged task', () => {
  const evals = tmp();
  makeEvals(evals);
  const plan = lib.planSkill({ skill: 'alpha', evalsDir: evals });
  assert.deepEqual(plan.tasks.map((t) => t.task.id), ['si-alpha-e1', 'si-alpha-p1']);
  const p1 = plan.tasks.find((t) => t.task.id === 'si-alpha-p1');
  assert.ok(p1.task.checks.some((c) => c.pattern === 'risk'));
  assert.deepEqual(p1.provenance.evals, [0]);
  const e1 = plan.tasks.find((t) => t.task.id === 'si-alpha-e1');
  assert.deepEqual(e1.provenance.tags, ['eval-only']);
  assert.equal(e1.provenance.source, 'skill-evals');
  assert.equal(e1.task.fixture, lib.EMPTY_FIXTURE);
  assert.equal(e1.task.rubric.find((r) => r.criterion === 'Does not invent facts.').id, 'guard-1');
  assert.deepEqual(plan.counts, { scenarios: 1, evals: 2, folded: 1, evalOnly: 1, queries: 0 });
});

test('limited skills are held back unless --include-limited, and setup.sh fixtures are skipped', () => {
  const evals = tmp(); const out = tmp(); const out2 = tmp();
  makeEvals(evals);
  const file = path.join(evals, 'alpha', 'scenario.json');
  const scen = JSON.parse(fs.readFileSync(file, 'utf8'));
  scen.limited = true;
  fs.writeFileSync(file, JSON.stringify(scen));
  const a = run(['tasks', '--skill', 'alpha', '--ref', 'r', '--out', out, '--evals-dir', evals], git(['alpha']));
  assert.match(a.lines[0], /alpha: wrote 0 tasks .*\(2 limited held back\)/);
  const b = run(['tasks', '--skill', 'alpha', '--ref', 'r', '--out', out2, '--include-limited', '--evals-dir', evals], git(['alpha']));
  assert.match(b.lines[0], /wrote 2 tasks/);
  const prov = JSON.parse(fs.readFileSync(path.join(out2, 'alpha', 'provenance.json'), 'utf8'));
  assert.ok(Object.values(prov.tasks).every((t) => t.tags.includes('limited')));

  put(path.join(evals, 'alpha', 'fixtures', 'alpha', 'sub', 'setup.sh'), '#!/bin/sh\n');
  const plan = lib.planSkill({ skill: 'alpha', evalsDir: evals, includeLimited: true });
  assert.deepEqual(plan.skipped.map((s) => s.id), ['si-alpha-p1']);
  assert.match(plan.skipped[0].reason, /setup\.sh/);
});

test('trigger queries: rows that cap import would reject are dropped with a reason', () => {
  const rows = [
    { query: 'review the report for gaps before release', should_trigger: true },
    { query: 'use alpha to review the report', should_trigger: true },
    { query: 'review the report \u2014 quickly please', should_trigger: false },
    { query: 'short', should_trigger: false },
    { query: 'review the report for gaps before release', should_trigger: false },
    { query: 'run the k-plan procedure for this change', should_trigger: false },
    { query: 'write a haiku about the weather today', should_trigger: false },
  ];
  const r = lib.filterQueries('alpha', rows);
  assert.deepEqual(r.kept.map((x) => x.query), ['review the report for gaps before release', 'write a haiku about the weather today']);
  assert.deepEqual(r.dropped.map((d) => d.index), [2, 3, 4, 5, 6]);
  assert.match(r.dropped[0].reason, /names the capability/);
  assert.match(r.dropped[1].reason, /dash/);
  assert.match(r.dropped[3].reason, /duplicate/);
  assert.equal(r.warnings.length, 1);

  const evals = tmp(); const out = path.join(tmp(), 'q.json');
  makeEvals(evals, { queries: rows });
  const { lines } = run(['queries', '--skill', 'alpha', '--out', out, '--evals-dir', evals]);
  assert.match(lines[0], /wrote 2 of 7 queries .*dropped 5/);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), r.kept);
});

test('the same input gives byte-identical output', () => {
  const evals = tmp(); const out = tmp();
  makeEvals(evals);
  const argv = ['tasks', '--skill', 'alpha,beta', '--ref', 'r', '--out', out, '--evals-dir', evals];
  run(argv, git(['alpha', 'beta']));
  const first = digest(out);
  run(argv, git(['alpha', 'beta']));
  assert.equal(digest(out), first);
});

test('written tasks load through the runner task loader', () => {
  const evals = tmp(); const out = tmp();
  makeEvals(evals);
  run(['tasks', '--skill', 'alpha,beta', '--ref', 'r', '--out', out, '--evals-dir', evals], git(['alpha', 'beta']));
  const tasks = loadTasks(undefined, { extraDirs: [path.join(out, 'alpha', 'tasks'), path.join(out, 'beta', 'tasks')] });
  for (const id of ['si-alpha-p1', 'si-alpha-e1', 'si-beta-p1']) assert.ok(tasks.has(id), id);
  const suite = JSON.parse(fs.readFileSync(path.join(out, 'alpha', 'suites', 'skilleval-import-alpha.json'), 'utf8'));
  assert.deepEqual(suite.tasks, ['si-alpha-e1', 'si-alpha-p1']);
});

test('the report lists counts and the skills missing from the ref', () => {
  const evals = tmp();
  makeEvals(evals);
  const { lines } = run(['report', '--ref', 'r', '--evals-dir', evals], git(['alpha']));
  assert.match(lines.find((l) => l.startsWith('beta')), /\bno\b/);
  assert.match(lines.find((l) => l.startsWith('beta')), /not in r/);
  assert.match(lines.find((l) => l.startsWith('alpha')), /alpha\s+1\s+2\s+1\s+1\s+2\s+0\s+0\s+yes/);
});

test('skillsAtRef reads the skills of a real ref', () => {
  const names = lib.skillsAtRef('HEAD');
  assert.ok(names.has('threat-modeling'));
});
