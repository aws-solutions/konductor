// SPDX-License-Identifier: Apache-2.0
'use strict';

// The quality pack pass over synthetic runs: the separate output file, the unchanged default path, the dimension table in
// report and report-2x2, the calibration sheet and the command line. Fake judges only; nothing leaves the scratch directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun, writeJudgments } = require('./helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const { taskRevision } = require('../../judge/revision.js');
const { runPackJudging, planPack, readQuality, FILE } = require('../../judge/packrun.js');
const { loadPack } = require('../../judge/pack/index.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { loadRun } = require('../../report/load.js');
const { generateRunReport } = require('../../report/generate.js');
const { buildFactorial, renderFactorial } = require('../../report/factorial.js');
const { toMarkdown } = require('../../report/doc.js');
const { summarizeQuality } = require('../../report/quality.js');
const { exportSheet, scorePackLabels } = require('../../judge/calibrate.js');
const { checkArgs } = require('../lib/cli-flags.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const pack = loadPack('quality');
const DESIGN = '# Hold service design\n\nThis document says how holds work and what a librarian can do with them.\n\nThe queue is first come, first served \u2014 by creation time.\n\n## Testing\n\nTwo returns at once: exactly one hold becomes reserved.\n';
const DESIGN_PLAIN = DESIGN.replace(' \u2014 by', ', by');

function taskJson(base, id, cls, prompt) {
  return { ...base, id, class: cls, prompt };
}

// A bench with the stub task t1 plus a design task d1, an orchestration task c1 and a review task r1.
function setup({ specs, config = {} } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/d1.json'), JSON.stringify(taskJson(t1, 'd1', 'design', 'Write a design for the hold service.')));
  write(path.join(bench, 'tasks/c1.json'), JSON.stringify(taskJson(t1, 'c1', 'orchestration', 'Add validation to the API and add tests for it.')));
  write(path.join(bench, 'tasks/r1.json'), JSON.stringify(taskJson(t1, 'r1', 'review', 'Review the service.')));
  const runDir = makeRun(path.join(root, 'run'), bench, specs ?? [
    { arm: 'vanilla', task: 'd1', files: { 'docs/design.md': DESIGN } },
    { arm: 'other', task: 'd1', files: { 'docs/design.md': DESIGN_PLAIN } },
  ], { taskIds: ['t1', 'd1', 'c1', 'r1'], ...config });
  return { root, bench, runDir };
}
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

const idsOf = (prompt) => (/exactly one entry for each criterion id: (.+)\.$/m.exec(prompt) ?? [])[1]?.split(', ') ?? [];

// handler(ids, call) -> map id -> {verdict, evidence}; default is pass with a quote that exists in every bundle.
function stub(handler = () => ({})) {
  const calls = [];
  const fn = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const ids = idsOf(prompt);
    const over = handler(ids, { model, prompt }) ?? {};
    if (over.error) return { text: '', credits: 0, latencyMs: 1, error: over.error };
    return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'Hold service design', ...(over[id] ?? {}) })) }), credits: 0.1, latencyMs: 1 };
  };
  fn.calls = calls;
  return fn;
}

const common = (s, extra = {}) => ({
  runDir: s.runDir, benchDir: s.bench, judges: ['gpt-test', 'deepseek-test'], concurrency: 2, budgetCredits: null,
  limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {}, pack, ...extra,
});

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function treeHashes(dir, base = dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, treeHashes(p, base));
    else out[path.relative(base, p)] = sha(p);
  }
  return out;
}

// ---- the pass and its output ----

test('the pass writes judgments-quality.json and leaves judgments.json byte-identical', async () => {
  const s = setup();
  try {
    writeJudgments(s.runDir, { judges: ['gpt-test'], rubric: [{ judge: 'gpt-test', arm: 'vanilla', task: 'd1', score: 0.5, criteria: { c1: 'pass' } }] });
    const before = sha(path.join(s.runDir, 'judgments.json'));
    const j = await runPackJudging({ ...common(s), caller: stub() });
    assert.equal(sha(path.join(s.runDir, 'judgments.json')), before);
    const q = readQuality(s.runDir);
    assert.equal(q.kind, 'quality-pack');
    assert.deepEqual(q.pack, { id: 'quality', revision: pack.revision });
    assert.equal(q.records.length, 4);
    assert.equal(j.records.length, 4);
    assert.ok(q.records.every((r) => r.judgeError === null && r.taskRevision && r.packRevision === pack.revision));
  } finally { cleanup(s.root); }
});

test('a design run is judged on the design, scenario and written-content criteria; the others are n/a with reasons', async () => {
  const s = setup();
  try {
    const caller = stub();
    await runPackJudging({ ...common(s), caller });
    const rec = readQuality(s.runDir).records.find((r) => r.armId === 'vanilla' && r.judge === 'gpt-test');
    const judged = rec.criteria.filter((c) => c.status === 'judged').map((c) => c.id);
    assert.ok(judged.includes('des-consistency') && judged.includes('scn-traced') && judged.includes('cq-human-voice'));
    assert.ok(!judged.includes('test-names') && !judged.includes('tm-stride'));
    const na = Object.fromEntries(rec.na.map((x) => [x.id, x.reason]));
    assert.match(na['test-names'], /does not ask for tests/);
    assert.match(na['tm-stride'], /does not ask for threat-model/);
    assert.deepEqual(new Set(caller.calls.map((c) => c.model)), new Set(['gpt-test', 'deepseek-test']));
    assert.equal(caller.calls.length, 4);
    for (const c of caller.calls) assert.doesNotMatch(c.prompt, /test-names|tm-stride|mod-isolation/);
  } finally { cleanup(s.root); }
});

test('counted criteria are scored without a call, and the em dash in one arm shows', async () => {
  const s = setup();
  try {
    await runPackJudging({ ...common(s), caller: stub() });
    const q = readQuality(s.runDir);
    const of = (arm) => q.records.find((r) => r.armId === arm && r.judge === 'gpt-test').criteria.find((c) => c.id === 'cq-plain-typography');
    assert.equal(of('vanilla').verdict, 'partial');
    assert.equal(of('vanilla').status, 'auto');
    assert.equal(of('other').verdict, 'pass');
  } finally { cleanup(s.root); }
});

test('a run with nothing the pack can judge costs no call and still gets a record with the n/a reasons', async () => {
  const s = setup({ specs: [{ arm: 'vanilla', task: 't1', files: { 'a.txt': 'changed\n' } }] });
  try {
    const caller = stub();
    const j = await runPackJudging({ ...common(s), caller });
    assert.equal(caller.calls.length, 0);
    assert.equal(j.records.length, 2);
    assert.ok(j.records[0].na.length === pack.criteria.length && j.records[0].dimensions.modularity.score === null);
  } finally { cleanup(s.root); }
});

test('a task that asks for tests and gets none is scored fail on test quality without a call', async () => {
  const s = setup({ specs: [{ arm: 'vanilla', task: 'c1', files: { 'src/validate.js': `${Array.from({ length: 14 }, (_, i) => `const rule${i} = ${i};`).join('\n')}\n` } }] });
  try {
    const caller = stub();
    await runPackJudging({ ...common(s), caller });
    const rec = readQuality(s.runDir).records[0];
    const test = rec.criteria.filter((c) => c.dimension === 'test-quality');
    assert.ok(test.length >= 6 && test.every((c) => c.status === 'absent' && c.verdict === 'fail'));
    assert.equal(rec.dimensions['test-quality'].score, 0);
    assert.ok(!caller.calls.some((c) => /test-names/.test(c.prompt)));
  } finally { cleanup(s.root); }
});

test('quote verification applies to pack items', async () => {
  const s = setup();
  try {
    await runPackJudging({
      ...common(s), judges: ['gpt-test'],
      caller: stub(() => ({ 'des-consistency': { evidence: 'a field that is not in the output @@ nor this one' }, 'des-alternatives': { verdict: 'fail', evidence: 'invented' } })),
    });
    const rec = readQuality(s.runDir).records.find((r) => r.armId === 'vanilla');
    const get = (id) => rec.criteria.find((c) => c.id === id);
    assert.deepEqual([get('des-consistency').verdict, get('des-consistency').verdictRaw, get('des-consistency').evidenceFound], ['partial', 'pass', false]);
    assert.equal(get('des-alternatives').verdict, 'fail');
    assert.equal(get('des-problem-first').verdict, 'pass');
    assert.equal(get('des-problem-first').evidenceFound, true);
  } finally { cleanup(s.root); }
});

test('the judge sees the agent diff and the same redaction as the rubric pass: no arm or tool names', async () => {
  const s = setup({ specs: [{ arm: 'v1.2.0', task: 'd1', files: { 'docs/design.md': `${DESIGN}\nThe konductor orchestrator delegates to a subagent.\n` } }] });
  try {
    const caller = stub();
    await runPackJudging({ ...common(s), judges: ['gpt-test'], caller });
    const { prompt } = caller.calls[0];
    assert.match(prompt, /--- docs\/design\.md \(created: \+\d+ -0\)/);
    assert.match(prompt, /\+# Hold service design/);
    assert.doesNotMatch(prompt, /konductor|subagent|orchestrator|v1\.2\.0|delegates/i);
  } finally { cleanup(s.root); }
});

test('a judge error is recorded, dimension scores are left empty, and counted criteria still stand', async () => {
  const s = setup();
  try {
    await runPackJudging({ ...common(s), judges: ['gpt-test'], caller: stub(() => ({ error: 'boom' })) });
    const rec = readQuality(s.runDir).records.find((r) => r.armId === 'vanilla');
    assert.match(rec.judgeError, /boom/);
    assert.equal(rec.dimensions, null);
    assert.ok(rec.criteria.every((c) => c.status === 'auto' || c.status === 'absent'));
  } finally { cleanup(s.root); }
});

test('a rerun replaces records, answers from the cache and keeps one record per judge and run', async () => {
  const s = setup();
  try {
    await runPackJudging({ ...common(s), caller: stub() });
    const again = stub(() => { throw new Error('should be cached'); });
    const j = await runPackJudging({ ...common(s), caller: again });
    assert.equal(again.calls.length, 0);
    assert.equal(j.records.length, 4);
    assert.equal(j.invocations.length, 2);
  } finally { cleanup(s.root); }
});

test('one backend per results directory, and a different pack is refused', async () => {
  const s = setup();
  try {
    await runPackJudging({ ...common(s), caller: stub() });
    const file = path.join(s.runDir, FILE);
    const q = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...q, backend: 'opencode' }));
    await assert.rejects(() => runPackJudging({ ...common(s), caller: stub() }), /one backend per panel/);
    fs.writeFileSync(file, JSON.stringify({ ...q, pack: { id: 'other', revision: 'x' } }));
    await assert.rejects(() => runPackJudging({ ...common(s), caller: stub() }), /holds pack "other"/);
  } finally { cleanup(s.root); }
});

test('the plan counts calls per run and judge without calling anything', () => {
  const s = setup();
  try {
    const run = loadRun(s.runDir);
    const plan = planPack({ run, tasks: loadTasks(s.bench), benchDir: s.bench, limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), thePack: pack, judges: ['a', 'b', 'c'] });
    assert.equal(plan.calls, 6);
    assert.ok(plan.plan.every((p) => p.judged > 5 && p.auto === 3 && p.calls === 3));
  } finally { cleanup(s.root); }
});

// ---- the default path stays as it was ----

const reportInto = (s, out, qualityPack = null) => {
  const run = loadRun(s.runDir);
  generateRunReport({ run, tasks: loadTasks(s.bench), baseline: 'vanilla', out, detail: 'full', format: 'both', defaultDir: s.runDir, qualityPack });
};

function judgedSetup() {
  const s = setup();
  const t = loadTasks(s.bench);
  const rubric = [];
  for (const arm of ['vanilla', 'other']) for (const judge of ['gpt-test', 'deepseek-test']) {
    rubric.push({ judge, arm, task: 'd1', score: 0.6, criteria: { c1: 'pass', c2: 'partial' } });
  }
  writeJudgments(s.runDir, { judges: ['gpt-test', 'deepseek-test'], rubric });
  const j = JSON.parse(fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8'));
  for (const r of j.rubric) r.taskRevision = taskRevision(t.get('d1'));
  fs.writeFileSync(path.join(s.runDir, 'judgments.json'), JSON.stringify(j));
  return s;
}

test('without the flag, report output is byte-identical whether or not judgments-quality.json exists', async () => {
  const s = judgedSetup();
  try {
    reportInto(s, path.join(s.root, 'before'));
    await runPackJudging({ ...common(s), caller: stub() });
    reportInto(s, path.join(s.root, 'after'));
    const a = treeHashes(path.join(s.root, 'before'));
    const b = treeHashes(path.join(s.root, 'after'));
    assert.ok(Object.keys(a).length >= 3);
    assert.deepEqual(b, a);
    for (const f of Object.keys(b)) assert.doesNotMatch(fs.readFileSync(path.join(s.root, 'after', f), 'utf8'), /Quality dimensions/);
  } finally { cleanup(s.root); }
});

test('with the flag, report adds the dimensions table and says the scores are not calibrated; the rest is unchanged', async () => {
  const s = judgedSetup();
  try {
    reportInto(s, path.join(s.root, 'plain'));
    await runPackJudging({ ...common(s), caller: stub((ids) => (ids.includes('des-consistency') ? { 'des-consistency': { verdict: 'fail', evidence: 'Hold service design' } } : {})) });
    reportInto(s, path.join(s.root, 'pack'), pack);
    const plain = fs.readFileSync(path.join(s.root, 'plain', 'report.md'), 'utf8');
    const withPack = fs.readFileSync(path.join(s.root, 'pack', 'report.md'), 'utf8');
    assert.ok(withPack.startsWith(plain.trimEnd()));
    const added = withPack.slice(plain.trimEnd().length);
    assert.match(added, /## Quality dimensions \(indicative, not in the quality score\)/);
    assert.match(added, /no person has rated a sample/);
    assert.match(added, /\| Design doc structure and accuracy \|/);
    assert.match(added, /\| Test quality \| n\/a \(1 run\) \| n\/a \(1 run\) \|/);
    assert.equal((added.match(/Inline documentation, vanilla/g) || []).length, 1);
    assert.match(added, /Why a dimension was n\/a/);
    const json = JSON.parse(fs.readFileSync(path.join(s.root, 'pack', 'report.json'), 'utf8'));
    assert.equal(json.qualityDimensions.indicative, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, 'plain', 'report.json'), 'utf8')).qualityDimensions, undefined);
    assert.deepEqual(json.scores, JSON.parse(fs.readFileSync(path.join(s.root, 'plain', 'report.json'), 'utf8')).scores);
  } finally { cleanup(s.root); }
});

test('the table flags judges that differ, counts n/a runs and ignores records from another pack revision', async () => {
  const s = judgedSetup();
  try {
    await runPackJudging({ ...common(s), caller: stub((ids, { model }) => (model === 'gpt-test' ? { 'des-consistency': { verdict: 'fail', evidence: 'Hold service design' }, 'des-testable-acceptance': { verdict: 'fail', evidence: 'Hold service design' } } : {})) });
    const run = loadRun(s.runDir);
    const sum = summarizeQuality({ groups: [{ id: 'vanilla', label: 'vanilla', run, arm: 'vanilla' }], tasks: loadTasks(s.bench), pack });
    const design = sum.groups[0].dimensions['design-doc'];
    assert.equal(design.n, 1);
    assert.equal(design.disagree, true);
    assert.ok(design.spread > 0.2);
    assert.equal(sum.groups[0].dimensions['test-quality'].score, null);
    assert.equal(sum.groups[0].dimensions['test-quality'].na, 1);
    assert.match(sum.groups[0].dimensions['test-quality'].naReasons[0].reason, /does not ask for tests/);
    const file = path.join(s.runDir, FILE);
    const q = JSON.parse(fs.readFileSync(file, 'utf8'));
    q.records.find((r) => r.armId === 'vanilla').packRevision = 'old';
    fs.writeFileSync(file, JSON.stringify(q));
    const stale = summarizeQuality({ groups: [{ id: 'vanilla', label: 'vanilla', run: loadRun(s.runDir), arm: 'vanilla' }], tasks: loadTasks(s.bench), pack });
    assert.equal(stale.stale, 1);
    assert.throws(() => summarizeQuality({ groups: [{ id: 'x', label: 'x', run: { dir: path.join(s.root, 'none'), runs: [] } }], tasks: loadTasks(s.bench), pack }), /no judgments-quality\.json/);
  } finally { cleanup(s.root); }
});

test('the pack does not change any task rubric revision', () => {
  const s = setup();
  try {
    const t = loadTasks(s.bench);
    const before = ['t1', 'd1', 'c1', 'r1'].map((id) => taskRevision(t.get(id)));
    exportSheet({ runDir: s.runDir, benchDir: s.bench, n: 2, seed: 1, limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), outDir: path.join(s.root, 'cal'), criteriaPack: pack });
    assert.deepEqual(['t1', 'd1', 'c1', 'r1'].map((id) => taskRevision(loadTasks(s.bench).get(id))), before);
  } finally { cleanup(s.root); }
});

// ---- report-2x2 ----

function cellDir(root, bench, name, arm, kind, { panel = ['deepseek-test', 'gpt-test'], backend = 'kiro', shift = 0 } = {}) {
  const cc = kind === 'cc';
  const base = cc
    ? { harness: 'claude-code', credits: null, kiroCliVersion: null, harnessVersion: '2.1.316', model: 'us.anthropic.claude-sonnet-5-5', costUsd: 0.1, costCensored: false, sessionModel: 'claude-sonnet-5-5', claudeCode: { canonicalModel: 'claude-sonnet-5-5', modelsSeen: ['claude-sonnet-5-5'], spawned: 0 } }
    : { credits: 1, model: 'claude-sonnet-5.5', sessionModel: 'claude-sonnet-5.5', subagentCalls: 0, agentEngine: 'v3' };
  const dir = path.join(root, name);
  const sha = arm.includes('konductor') ? { commitSha: 'bf07556f0000000000000000000000000000abcd' } : {};
  makeRun(dir, bench, ['d1', 't1'].map((task) => ({ arm, task, rep: 1, files: task === 'd1' ? { 'docs/design.md': DESIGN } : {}, ...base, ...sha })), { taskIds: ['d1', 't1'], ...(cc ? { harness: 'claude-code', model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: 'claude-sonnet-5-5' } : { model: 'claude-sonnet-5.5', agentEngine: 'v3' }) });
  const loaded = loadTasks(bench);
  const rubric = [];
  for (const task of ['d1', 't1']) for (const judge of panel) rubric.push({ kind: 'rubric', judge, armId: arm, taskId: task, replicate: 1, taskRevision: taskRevision(loaded.get(task)), score: 0.5 + shift, scoreRaw: 0.5 + shift, criteria: [], judgeError: null, parseFailures: 0, calls: [], redactionsFired: {} });
  write(path.join(dir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: arm, backend, judges: panel, modes: ['rubric'], panel: { families: ['deepseek', 'gpt'], small: true }, rubric, pairwise: [], graded: [], notJudged: [], spentCredits: 0 }));
  return dir;
}

async function fourCells(extra = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/d1.json'), JSON.stringify(taskJson(t1, 'd1', 'design', 'Write a design for the hold service.')));
  const dirs = {
    kiroVanilla: [cellDir(root, bench, 'kv', 'vanilla', 'kiro')],
    kiroKonductor: [cellDir(root, bench, 'kk', 'konductor', 'kiro', { shift: 0.1 })],
    ccVanilla: [cellDir(root, bench, 'cv', 'cc-vanilla', 'cc')],
    ccKonductor: [cellDir(root, bench, 'ck', 'cc-konductor', 'cc', { shift: 0.1 })],
  };
  for (const d of Object.values(dirs)) {
    const s = { runDir: d[0], bench };
    await runPackJudging({ ...common(s), subjectModel: 'claude-sonnet-5.5', backend: extra.backend ?? 'kiro', caller: stub() });
  }
  return { root, bench, dirs };
}

test('report-2x2 adds the dimensions table per cell only with the flag, and the rest of the output is unchanged', async () => {
  const { root, bench, dirs } = await fourCells();
  try {
    const plain = buildFactorial({ dirs, benchDir: bench });
    const withPack = buildFactorial({ dirs, benchDir: bench, qualityPack: pack });
    assert.equal(plain.qualityDimensions, undefined);
    const { qualityDimensions, ...rest } = withPack;
    assert.deepEqual(rest, plain);
    assert.deepEqual(qualityDimensions.groups.map((g) => g.label), ['Kiro CLI vanilla', 'Kiro CLI konductor', 'Claude Code vanilla', 'Claude Code konductor']);
    const md = toMarkdown(renderFactorial(withPack));
    assert.match(md, /## Quality dimensions \(indicative, not in the quality score\)/);
    assert.match(md, /\| dimension \| Kiro CLI vanilla \| Kiro CLI konductor \| Claude Code vanilla \| Claude Code konductor \|/);
    assert.equal(toMarkdown(renderFactorial(plain)).includes('Quality dimensions'), false);
  } finally { cleanup(root); }
});

test('report-2x2 refuses cells whose pack judgments came from different panels', async () => {
  const { root, bench, dirs } = await fourCells();
  try {
    const file = path.join(dirs.ccKonductor[0], FILE);
    const q = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...q, judges: ['glm-test'] }));
    assert.throws(() => buildFactorial({ dirs, benchDir: bench, qualityPack: pack }), /different panels or backends/);
  } finally { cleanup(root); }
});

// ---- calibration ----

test('calibrate export without the flag has no pack block; with it each item lists the criteria, anchors and empty labels', () => {
  const s = setup();
  try {
    const args = { runDir: s.runDir, benchDir: s.bench, n: 2, seed: 1, limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS) };
    exportSheet({ ...args, outDir: path.join(s.root, 'plain') });
    exportSheet({ ...args, outDir: path.join(s.root, 'pack'), criteriaPack: pack });
    const plain = JSON.parse(fs.readFileSync(path.join(s.root, 'plain', 'sheet.json'), 'utf8'));
    const withPack = JSON.parse(fs.readFileSync(path.join(s.root, 'pack', 'sheet.json'), 'utf8'));
    assert.ok(plain.items.every((it) => it.pack === undefined));
    const stripped = withPack.items.map(({ pack: _p, ...it }) => it);
    assert.deepEqual(stripped, plain.items);
    const item = withPack.items[0];
    assert.equal(item.pack.revision, pack.revision);
    assert.ok(item.pack.criteria.length > 5);
    assert.ok(item.pack.criteria.every((c) => c.levels.fail && c.levels.partial && c.levels.pass && c.quote));
    assert.ok(Object.values(item.pack.labels).every((v) => v === null));
    assert.ok(item.pack.computed.includes('cq-plain-typography'));
    assert.match(item.pack.changes, /\+# Hold service design/);
    const md = fs.readFileSync(path.join(s.root, 'pack', 'sheet.md'), 'utf8');
    assert.match(md, /Quality pack quality \(revision/);
    assert.match(md, /Scored by a program, not rated: cq-plain-typography/);
    assert.equal(fs.readFileSync(path.join(s.root, 'plain', 'sheet.md'), 'utf8').includes('Quality pack'), false);
  } finally { cleanup(s.root); }
});

test('calibrate score with the flag pairs a person\'s labels with each judge, per dimension, and invents none', async () => {
  const s = setup();
  try {
    await runPackJudging({ ...common(s), judges: ['gpt-test'], caller: stub() });
    const args = { runDir: s.runDir, benchDir: s.bench, n: 2, seed: 1, limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), outDir: path.join(s.root, 'cal'), criteriaPack: pack };
    exportSheet(args);
    const sheetPath = path.join(s.root, 'cal', 'sheet.json');
    const sheet = JSON.parse(fs.readFileSync(sheetPath, 'utf8'));
    const unlabeled = scorePackLabels({ labelsFile: sheetPath, thresholds: { kappaMin: 0.6, agreementMin: 0.7, spearmanMin: 0.6 } });
    assert.equal(unlabeled.judges['gpt-test'].nCriteria, 0);
    assert.equal(unlabeled.itemsLabeled, 0);
    const item = sheet.items.find((it) => it.pack.criteria.some((c) => c.id === 'des-consistency'));
    item.pack.labels['des-consistency'] = 'fail';
    item.pack.labels['des-problem-first'] = 'pass';
    fs.writeFileSync(sheetPath, JSON.stringify(sheet));
    const res = scorePackLabels({ labelsFile: sheetPath, thresholds: { kappaMin: 0.6, agreementMin: 0.7, spearmanMin: 0.6 } });
    const g = res.judges['gpt-test'];
    assert.equal(g.nCriteria, 2);
    assert.equal(g.agreement, 0.5);
    assert.equal(g.byDimension['design-doc'].n, 2);
    assert.equal(res.itemsLabeled, 1);
  } finally { cleanup(s.root); }
});

// ---- command line ----

const cli = (args, env = {}) => spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR, ...env } });

test('the flag is accepted by judge, report, report-2x2 and calibrate, and rejected elsewhere', () => {
  for (const cmd of [['judge'], ['report'], ['report-2x2'], ['calibrate', 'export'], ['calibrate', 'score']]) {
    assert.equal(checkArgs(cmd[0], { _: cmd.slice(1), 'criteria-pack': 'quality' }), null, cmd.join(' '));
  }
  assert.match(checkArgs('run', { _: [], 'criteria-pack': 'quality' }), /unknown flag --criteria-pack/);
  assert.equal(checkArgs('judge', { _: [], plan: true, run: 'x' }), null);
});

test('judge --criteria-pack --plan prints the call plan and calls nothing; --mode is refused with the pack', () => {
  const s = setup();
  try {
    const base = ['judge', '--run', s.runDir, '--bench-dir', s.bench, '--judges', 'gpt-test,deepseek-test,glm-test'];
    const plan = cli([...base, '--criteria-pack', 'quality', '--plan']);
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /vanilla\|d1\|1: \d+ judged, 3 counted by program, \d+ scored fail \(artifact not produced\), \d+ n\/a/);
    assert.match(plan.stdout, /6 judge call\(s\) for 2 run\(s\) x 3 judge\(s\)/);
    assert.match(plan.stdout, /nothing was called/);
    assert.equal(fs.existsSync(path.join(s.runDir, FILE)), false);
    const bad = cli([...base, '--criteria-pack', 'quality', '--mode', 'rubric']);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /--mode does not apply with --criteria-pack/);
    assert.match(cli([...base, '--criteria-pack', 'nope', '--plan']).stderr, /no pack "nope"/);
  } finally { cleanup(s.root); }
});

test('judge --criteria-pack runs through --judge-cmd, writes the quality file only, and report shows the table', () => {
  const s = setup();
  try {
    const script = path.join(s.root, 'pack-judge.js');
    fs.writeFileSync(script, `const fs=require('fs');const p=fs.readFileSync(0,'utf8');const m=/exactly one entry for each criterion id: (.+)\\.$/m.exec(p);const ids=m[1].split(', ');console.log(JSON.stringify({criteria:ids.map((id)=>({id,verdict:'partial',evidence:'Hold service design'}))}));`);
    const judge = cli(['judge', '--run', s.runDir, '--bench-dir', s.bench, '--judges', 'gpt-test,deepseek-test,glm-test', '--criteria-pack', 'quality', '--judge-cmd', `${process.execPath} ${script}`]);
    assert.equal(judge.status, 0, judge.stderr);
    assert.match(judge.stdout, /quality pack quality: 6 record\(s\), 0 with judgeError/);
    assert.equal(fs.existsSync(path.join(s.runDir, 'judgments.json')), false);
    assert.equal(readQuality(s.runDir).records.length, 6);
  } finally { cleanup(s.root); }
});

test('report --verdict with --criteria-pack is refused instead of ignoring the pack', () => {
  const s = setup();
  try {
    const r = cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--verdict', 'platform', '--criteria-pack', 'quality']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--criteria-pack does not apply with --verdict/);
  } finally { cleanup(s.root); }
});

// ---- the pack as part of the quality score ----

const SCORING_QUALITY = path.join(__dirname, '..', '..', 'profiles', 'scoring-quality.json');
const reportWith = (s, out, extra = {}) => generateRunReport({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), baseline: 'vanilla', out, detail: 'full', format: 'both', defaultDir: s.runDir, ...extra });
const readReport = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));

test('a scoring file that weights the pack puts it in quality, and the report says so', async () => {
  const s = judgedSetup();
  try {
    await runPackJudging({ ...common(s), caller: stub((ids) => (ids.includes('des-consistency') ? { 'des-consistency': { verdict: 'fail', evidence: 'Hold service design' } } : {})) });
    reportWith(s, path.join(s.root, 'plain'), { qualityPack: pack });
    reportWith(s, path.join(s.root, 'scored'), { qualityPack: pack, scoringFile: SCORING_QUALITY });
    const plain = readReport(path.join(s.root, 'plain'));
    const scored = readReport(path.join(s.root, 'scored'));
    assert.deepEqual(plain.scores.weights, { hidden: 0.5, checks: 0.2, rubric: 0.3 });
    assert.deepEqual(scored.scores.weights, { hidden: 0.4, checks: 0.16, rubric: 0.24, pack: 0.2 });
    const q = (r) => r.scores.arms.vanilla.overall.quality;
    assert.equal(q(scored).components.pack.n, 1);
    assert.equal(q(plain).components.pack, undefined);
    assert.notEqual(q(scored).value, q(plain).value);
    assert.match(q(scored).inputs, /pack 1\/1 \(w 0\.2\)/);
    const md = fs.readFileSync(path.join(s.root, 'scored', 'report.md'), 'utf8');
    assert.match(md, /## Quality dimensions \(indicative, part of the quality score\)/);
    assert.match(md, /The pack is part of the quality score in this report, with weight 0\.2/);
    assert.match(md, /quality pack 0\.2/);
    assert.equal(scored.qualityDimensions.scoredWeight, 0.2);
    assert.equal(plain.qualityDimensions.scoredWeight, undefined);
  } finally { cleanup(s.root); }
});

test('with a pack weight, a run with no current pack judgment stops the report, and a scoring file with a pack weight is refused without the pack', async () => {
  const s = judgedSetup();
  try {
    await runPackJudging({ ...common(s), caller: stub() });
    assert.throws(() => reportWith(s, path.join(s.root, 'a'), { scoringFile: SCORING_QUALITY }), /weight for pack needs the quality-pack scores/);
    const file = path.join(s.runDir, FILE);
    const q = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...q, records: q.records.filter((r) => r.armId !== 'other') }));
    assert.throws(() => reportWith(s, path.join(s.root, 'b'), { qualityPack: pack, scoringFile: SCORING_QUALITY }), /never judged by the pack \(other\/d1\/1\)/);
    reportWith(s, path.join(s.root, 'c'), { qualityPack: pack });
    fs.writeFileSync(file, JSON.stringify({ ...q, records: q.records.map((r) => ({ ...r, packRevision: 'old' })) }));
    assert.throws(() => reportWith(s, path.join(s.root, 'd'), { qualityPack: pack, scoringFile: SCORING_QUALITY }), /another pack revision/);
    const md = (() => { reportWith(s, path.join(s.root, 'e'), { qualityPack: pack }); return fs.readFileSync(path.join(s.root, 'e', 'report.md'), 'utf8'); })();
    assert.match(md, /made against pack revision old/);
    assert.match(md, /No run has a current pack record/);
  } finally { cleanup(s.root); }
});

test('report-2x2 scores the pack in every cell when the scoring file weights it, and labels the weights', async () => {
  const { root, bench, dirs } = await fourCells();
  try {
    const plain = buildFactorial({ dirs, benchDir: bench, qualityPack: pack });
    const scored = buildFactorial({ dirs, benchDir: bench, qualityPack: pack, scoringFile: SCORING_QUALITY });
    assert.deepEqual(scored.weights, { hidden: 0.4, checks: 0.16, rubric: 0.24, pack: 0.2 });
    assert.notEqual(scored.cells[0].quality, plain.cells[0].quality);
    assert.match(toMarkdown(renderFactorial(scored)), /hidden tests 0\.4, checks 0\.16, rubric 0\.24, quality pack 0\.2/);
    assert.match(toMarkdown(renderFactorial(plain)), /hidden tests 0\.5, checks 0\.2, rubric 0\.3, renormalised/);
    assert.throws(() => buildFactorial({ dirs, benchDir: bench, scoringFile: SCORING_QUALITY }), /weight for pack needs the quality-pack scores/);
  } finally { cleanup(root); }
});
