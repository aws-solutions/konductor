// SPDX-License-Identifier: Apache-2.0
'use strict';

// Tests of the T7 grader (bench/scenarios/lib/hidden/plan-grade.cjs), the task builder in scenario.config.js, the
// mechanical answers with T7's options, and the files of every assembled T7 task.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock, gradeAssertion, getPath } = require('../../lib/hidden/plan-grade.cjs');
const CFG = require('../scenario.config.js');
const { loadConfig } = require('../../lib/config.js');
const { render } = require('../../lib/prompt.js');
const { shallow, vary, follow, DEFAULTS } = require('../../lib/answers.js');
const { sharedHelpers } = require('../../../runner/lib/hidden-lib.js');

const { taskOf, TEST_CMD, GRADER_FILES, decoysOf } = CFG;

const DIR = path.join(__dirname, '..');
const doc = {
  overall: 'red',
  risks: [{ tickets: ['PAY-212', 'OPS-7'], kind: 'critical-path' }, { tickets: ['CHK-40'], kind: 'other' }],
  critical_path: ['OPS-7', 'PAY-212', 'CHK-90'],
  revised_launch_date: '2027-04-16',
  reasoning: { 'Sprints_Needed': 3 },
};
const g = (a) => gradeAssertion(doc, { id: 'x', ...a });

test('readBlock takes the first block with the info string that parses', () => {
  const text = 'intro\n```status\nnot json\n```\n```json\n{"a":1}\n```\n```Status\n{"overall":"red"}\n```\n';
  assert.deepStrictEqual(readBlock(text, 'status'), { overall: 'red' });
  assert.strictEqual(readBlock(text, 'plan'), null);
});

test('readBlock also takes the name after a json language tag, but not a json block with no name', () => {
  assert.deepStrictEqual(readBlock('```json status\n{"overall":"red"}\n```\n', 'status'), { overall: 'red' });
  assert.deepStrictEqual(readBlock('```JSON  Status \n{"overall":"red"}\n```\n', 'status'), { overall: 'red' });
  assert.strictEqual(readBlock('```json\n{"overall":"red"}\n```\n', 'status'), null);
  assert.strictEqual(readBlock('```yaml status\n{"overall":"red"}\n```\n', 'status'), null);
});

test('cites: a list in where accepts any of its values', () => {
  assert.ok(g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['CHK-40'], where: { kind: ['schedule', 'other'] } }).ok);
  assert.ok(!g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['CHK-40'], where: { kind: ['schedule', 'scope'] } }).ok);
});

test('getPath matches keys ignoring case and indexes lists', () => {
  assert.strictEqual(getPath(doc, 'reasoning.sprints_needed'), 3);
  assert.strictEqual(getPath(doc, 'critical_path.1'), 'PAY-212');
  assert.strictEqual(getPath(doc, 'missing.key'), undefined);
});

test('ids match on a token edge only', () => {
  assert.ok(g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['pay-212'] }).ok);
  assert.ok(!g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['PAY-21'] }).ok);
  assert.ok(g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['PAY-212', 'OPS-7'], min: 2 }).ok);
});

test('cites with where checks the citing element only', () => {
  assert.ok(g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['CHK-40'], where: { kind: 'OTHER' } }).ok);
  assert.ok(!g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['CHK-40'], where: { kind: 'critical-path' } }).ok);
});

test('an object is read as the list of its values', () => {
  const plan = { sprints: { S1: ['A-1', 'A-2'], S2: ['A-3'] } };
  assert.ok(gradeAssertion(plan, { id: 'x', op: 'includes', path: 'sprints', ids: ['A-3', 'A-1'] }).ok);
  assert.ok(gradeAssertion(plan, { id: 'x', op: 'order', path: 'sprints', ids: ['A-1', 'A-3'] }).ok);
});

test('absent fails when a decoy is named', () => {
  assert.ok(!g({ op: 'absent', path: 'risks', field: 'tickets', ids: ['CHK-40'] }).ok);
  assert.ok(g({ op: 'absent', path: 'risks', field: 'tickets', ids: ['CHK-41'] }).ok);
});

test('includes, excludes and order on a list', () => {
  assert.ok(g({ op: 'includes', path: 'critical_path', ids: ['OPS-7', 'CHK-90'] }).ok);
  assert.ok(!g({ op: 'includes', path: 'critical_path', ids: ['OPS-7', 'X-1'] }).ok);
  assert.ok(g({ op: 'includes', path: 'critical_path', ids: ['OPS-7', 'X-1'], any: true }).ok);
  assert.ok(g({ op: 'excludes', path: 'critical_path', ids: ['X-1'] }).ok);
  assert.ok(g({ op: 'order', path: 'critical_path', ids: ['OPS-7', 'CHK-90'] }).ok);
  assert.ok(!g({ op: 'order', path: 'critical_path', ids: ['CHK-90', 'OPS-7'] }).ok);
});

test('date and number tolerances', () => {
  assert.ok(g({ op: 'date', path: 'revised_launch_date', value: '2027-04-14', tolDays: 2 }).ok);
  assert.ok(!g({ op: 'date', path: 'revised_launch_date', value: '2027-04-13', tolDays: 2 }).ok);
  assert.ok(g({ op: 'number', path: 'reasoning.sprints_needed', value: 3.4, tol: 0.5 }).ok);
  assert.ok(!g({ op: 'number', path: 'reasoning.sprints_needed', value: 4, tolPct: 10 }).ok);
  assert.ok(!g({ op: 'number', path: 'overall', value: 1, tol: 5 }).ok);
  assert.throws(() => g({ op: 'date', path: 'revised_launch_date', value: 'soon' }));
});

test('equals ignores case; precision caps a padded list', () => {
  assert.ok(g({ op: 'equals', path: 'overall', value: 'RED' }).ok);
  assert.ok(g({ op: 'equals', path: 'overall', oneOf: ['amber', 'red'] }).ok);
  assert.ok(g({ op: 'precision', path: 'risks', field: 'tickets', ids: ['PAY-212'], min: 0.5 }).ok);
  assert.ok(!g({ op: 'precision', path: 'risks', field: 'tickets', ids: ['PAY-212'], min: 0.6 }).ok);
  assert.ok(!g({ op: 'precision', path: 'risks', field: 'tickets', ids: ['PAY-212', 'CHK-40'], maxCount: 1 }).ok);
});

test('no block fails every assertion; an unknown op is a key error', () => {
  assert.strictEqual(gradeAssertion(null, { id: 'x', op: 'equals', path: 'overall', value: 'red' }).ok, false);
  assert.throws(() => g({ op: 'nope' }));
});

test('taskOf: checks, twin targets and authorship', () => {
  const b = { id: 't7-a-twin', phase: 'planning', role: 'tpm', author: 'gpt-5.6-luna', controlKind: 'twin', twinOf: 't7-a', output: 'r/n.md', block: 'numbers', source: 'original', date: '2026-11-19' };
  const draft = { prompt: 'p', rubric: [], limits: { softSec: 300, hardSec: 600 }, dataFile: 'tickets.csv' };
  const t = taskOf(b, draft, { assertions: [{}, {}] }, { targetSkills: ['s1'], targetSop: null, targetAgent: null }, null, '2026-11-19');
  assert.strictEqual(t.fixture, 't7-a');
  assert.deepStrictEqual(t.targetSkills, []);
  assert.deepStrictEqual(t.loadCheck, { mustLoad: [], mustNotLoad: ['s1'] });
  assert.strictEqual(t.checks[0].cmd, TEST_CMD);
  assert.strictEqual(t.checks[0].min, 2);
  assert.strictEqual(t.authorship.family, 'openai');
});

test('every brief renders a prompt with no placeholder left', () => {
  for (const f of fs.readdirSync(path.join(DIR, 'briefs'))) {
    const text = render(loadConfig(CFG), path.basename(f, '.json'));
    assert.ok(!/\{\{[A-Z]+\}\}/.test(text), f);
  }
});

test('the mechanical alternative varies order, own ids and wording but keeps ordered lists', () => {
  const ids = new Map();
  const v = follow(vary({ risks: [{ id: 'R-A', summary: 's', tickets: ['X-1'] }, { id: 'R-B' }], top_three: ['R-A', 'R-B'], critical_path: ['X-1', 'X-2'] }, DEFAULTS, '', ids), ids);
  assert.deepStrictEqual(v.critical_path, ['X-1', 'X-2']);
  assert.deepStrictEqual(v.top_three, ['item-1', 'item-2'].reverse());
  assert.strictEqual(v.risks[1].summary, 'In short: s');
  assert.deepStrictEqual(v.risks[1].tickets, ['X-1']);
});

test('pad-answer fills id lists with every fixture id and keeps scalars', () => {
  const { shotgun } = require('../pad-answer.js');
  const v = shotgun({ n: 3, path: ['AB-10'], risks: [{ tickets: ['AB-10'], kind: 'x' }], notes: ['plain'] }, ['AB-10', 'CD-20']);
  assert.strictEqual(v.n, 3);
  assert.deepStrictEqual(v.path, ['AB-10', 'CD-20']);
  assert.deepStrictEqual(v.risks, [{ tickets: ['AB-10'], kind: 'x' }, { tickets: ['CD-20'], kind: 'x' }]);
  assert.deepStrictEqual(v.notes, ['plain']);
});

test('evidence check: required items come from all-items assertions only', () => {
  const { requiredItems, evidenceCheck, checksFor } = CFG;
  const key = { output: 'o.md', block: 'b', assertions: [
    { op: 'includes', ids: ['AB-1', 'AB-2'] }, { op: 'includes', ids: ['ZZ-9'], any: true },
    { op: 'cites', ids: ['CD-3', 'CD-4'], min: 1 }, { op: 'cites', ids: ['EF-5'] }, { op: 'absent', ids: ['DE-9'] },
  ] };
  assert.deepStrictEqual(requiredItems(key), ['AB-1', 'AB-2', 'EF-5']);
  const c = evidenceCheck(key);
  assert.strictEqual(c.weight, 4);
  assert.ok(!c.cmd.slice(9, -1).includes("'"), 'the script must not hold a single quote');
  assert.strictEqual(evidenceCheck({ ...key, assertions: [{ op: 'equals', value: 'x' }] }), null);
  const checks = checksFor({ output: 'o.md', block: 'b' }, key, 'data.csv');
  assert.deepStrictEqual(checks.map((x) => [x.type, x.weight, x.kind]), [['tests', 3, 'substance'], ['cmd', 4, 'substance'], ['file_exists', 1, 'substance'], ['fixture_unchanged', 1, 'substance'], ['contains', 1, 'format']]);
});

test('evidence check passes a block naming enough required items and fails one naming too few', () => {
  const { evidenceCheck } = CFG;
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const key = { output: 'o.md', block: 'b', assertions: [{ op: 'includes', ids: ['AB-1', 'AB-2', 'AB-3', 'AB-4', 'AB-5'] }] };
  const cmd = evidenceCheck(key).cmd;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't7-ev-'));
  const run = (text) => { fs.writeFileSync(path.join(dir, 'o.md'), text); try { execFileSync('sh', ['-c', cmd], { cwd: dir, stdio: 'ignore' }); return 0; } catch { return 1; } };
  try {
    const f = '`'.repeat(3);
    assert.strictEqual(run(`x\n${f}b\n{"a":["AB-1","AB-2","AB-3","AB-4"]}\n${f}\n`), 0);
    assert.strictEqual(run(`x\n${f}b\n{"a":["AB-1","AB-2","AB-33"]}\n${f}\n`), 1);
    assert.strictEqual(run('AB-1 AB-2 AB-3 AB-4 AB-5 named only in prose'), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the mechanical lazy answer keeps half of each list, adds the decoys of the key, and shifts numbers and dates', () => {
  const key = { assertions: [{ op: 'absent', ids: ['DE-9'] }, { op: 'cites', ids: ['AB-1'] }] };
  assert.deepStrictEqual(decoysOf(key), ['DE-9']);
  const v = shallow({ path: ['AB-1', 'AB-2', 'AB-3'], n: 10, d: '2027-03-22', word: 'red', files: ['a.js', 'b.js', 'c.js', 'd.js'] }, { ...DEFAULTS, decoys: decoysOf(key) });
  assert.deepStrictEqual(v, { path: ['AB-1', 'AB-2', 'DE-9'], n: 7, d: '2027-03-01', word: 'red', files: ['a.js', 'b.js'] });
});

const tasks = fs.readdirSync(DIR).filter((f) => /^t7-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

test('every assembled task names its grader helpers and has its key and reference', () => {
  for (const t of tasks) {
    const hid = path.join(DIR, 'hidden', t.id, 'hidden');
    const helpers = sharedHelpers(path.join(DIR, 'hidden', t.id)).map(([rel]) => rel);
    for (const f of GRADER_FILES) {
      assert.ok(helpers.includes(`hidden/${f}`), `${t.id}: .bench-lib.json does not name ${f}`);
      assert.ok(!fs.existsSync(path.join(hid, f)), `${t.id}: commits a copy of ${f}`);
    }
    const key = JSON.parse(fs.readFileSync(path.join(hid, 'key.json'), 'utf8'));
    assert.strictEqual(t.checks[0].min, key.assertions.length, t.id);
    assert.ok(fs.existsSync(path.join(DIR, 'solutions', t.id, key.output)), `${t.id}: reference ${key.output} missing`);
    assert.ok(fs.existsSync(path.join(DIR, 'fixtures', t.fixture)), `${t.id}: fixture ${t.fixture} missing`);
  }
});
