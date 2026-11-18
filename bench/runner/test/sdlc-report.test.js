// SPDX-License-Identifier: Apache-2.0
'use strict';

// The SDLC phases of the quality pack and the SDLC view of report-2x2 (report/sdlc.js): the phase lint, the phase of
// each new task, the three axes, phase pack scores as a median over judges, and the paired view per task. Synthetic
// cells; no model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../judge/pack/index.js');
const { summarizeSdlc, sdlcBlocks, taskPhases, spread } = require('../../report/sdlc.js');
const { taskRevision } = require('../../judge/revision.js');
const { loadTasks } = require('../lib/tasks.js');
const { toMarkdown } = require('../../report/doc.js');
const { tmp } = require('./helpers.js');
const { exportReferenceSheet } = require('../../judge/calibrate-reference.js');

const BENCH = path.join(__dirname, '..', '..');
const pack = P.loadPack('quality');
const clone = () => JSON.parse(JSON.stringify(pack));

const NEW_PHASE = {
  ideation: ['idea-problem-evidence', 'idea-options-range', 'idea-success-measure', 'idea-kill-criteria'],
  poc: ['spike-question', 'spike-evidence', 'spike-scope-throwaway', 'spike-recommendation'],
  architecture: ['arch-criteria-explicit', 'arch-tradeoff-matrix', 'arch-option-fair', 'arch-reversibility'],
  production: ['prod-observability', 'prod-config-secrets', 'prod-graceful-lifecycle', 'prod-cost-estimate', 'prod-runbook-actions'],
  'code-review': ['rev-severity-impact', 'cr-actionable', 'cr-signal', 'cr-coverage-areas', 'cr-verdict', 'ra-missed-explained', 'ra-claim-evidence', 'ra-severity-reason'],
  'design-review': ['dr-gap-specific', 'dr-consequence', 'dr-prioritized'],
};

test('every criterion sits in exactly one of the thirteen SDLC phases, and the lint refuses a gap or a double', () => {
  assert.deepEqual(P.validatePack(pack), []);
  assert.equal(pack.phases.length, 13);
  assert.equal(pack.phases.reduce((n, p) => n + p.criteria.length, 0), pack.criteria.length);
  for (const [phase, ids] of Object.entries(NEW_PHASE)) for (const id of ids) assert.ok(pack.phases.find((p) => p.id === phase).criteria.includes(id), `${id} in ${phase}`);
  const gap = clone();
  gap.phases[0].criteria.pop();
  assert.match(P.validatePack(gap).join(' | '), /in no phase/);
  const twice = clone();
  twice.phases[1].criteria.push(twice.phases[0].criteria[0]);
  assert.match(P.validatePack(twice).join(' | '), /in phases ideation and poc/);
});

test('the new artifact types are declared-only, so no earlier task gains the new criteria', () => {
  const NEW_TYPES = new Set(['framing', 'spike', 'decision', 'production', 'code-review', 'design-review', 'review-audit']);
  for (const t of NEW_TYPES) assert.ok(pack.declaredOnly.includes(t), t);
  const tasks = loadTasks(BENCH);
  for (const task of tasks.values()) assert.ok(!P.declaredArtifacts(pack, task).some((t) => NEW_TYPES.has(t)), task.id);
});

test('each sdlc task lands in its phase', () => {
  const tasks = loadTasks(BENCH, { extraDirs: [path.join(BENCH, 'sdlc')] });
  const want = { 'sdlc-problem-framing': 'ideation', 'sdlc-spike-dedupe': 'poc', 'sdlc-arch-decision': 'architecture', 'sdlc-prod-readiness': 'production', 'sdlc-code-review': 'code-review', 'sdlc-review-audit': 'code-review', 'sdlc-design-review-gaps': 'design-review' };
  for (const [id, phase] of Object.entries(want)) assert.ok(taskPhases(pack, tasks.get(id)).includes(phase), `${id}: ${taskPhases(pack, tasks.get(id))}`);
  assert.ok(taskPhases(pack, tasks.get('sdlc-prod-readiness')).includes('implementation'));
});

test('the sdlc suite covers every phase with at least one task', () => {
  const suite = JSON.parse(fs.readFileSync(path.join(BENCH, 'suites', 'sdlc.json'), 'utf8'));
  const tasks = loadTasks(BENCH, { extraDirs: [path.join(BENCH, 'sdlc')] });
  const covered = new Set(suite.tasks.flatMap((id) => taskPhases(pack, tasks.get(id))));
  assert.deepEqual(pack.phases.map((p) => p.id).filter((p) => !covered.has(p)), []);
});

test('spread gives n, mean, median, sample sd and range', () => {
  assert.deepEqual(spread([3, 1, 2, null]), { n: 3, mean: 2, median: 2, sd: 1, min: 1, max: 3 });
  assert.equal(spread([]).mean, null);
});

// ---- the report view on synthetic cells ----

const SPECS = [['kiroVanilla', 'kiro-cli', 'vanilla', 'credits'], ['kiroKonductor', 'kiro-cli', 'konductor', 'credits'], ['ccVanilla', 'claude-code', 'vanilla', 'USD'], ['ccKonductor', 'claude-code', 'konductor', 'USD']];

/** One loaded cell: rows from `quality(task, rep)`, cost and seconds per run, and pack records for three judges. */
function fakeCell(root, [id, harness, role, unit], { quality, cost, seconds, verdicts, tasks }) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const armId = role === 'vanilla' ? 'vanilla' : 'main';
  const rows = [];
  const records = [];
  for (const t of ['sdlc-arch-decision', 'sdlc-problem-framing']) {
    for (const rep of [1, 2]) {
      rows.push({ task: t, rep, quality: quality(t, rep), cost, wallMs: seconds * 1000, excluded: false });
      for (const [j, judge] of ['a', 'b', 'c'].entries()) {
        const v = verdicts[j];
        const ids = t === 'sdlc-arch-decision' ? NEW_PHASE.architecture : NEW_PHASE.ideation;
        records.push({ judge, armId, taskId: t, replicate: rep, packRevision: pack.revision, taskRevision: taskRevision(tasks.get(t)), judgeError: null, dimensions: {}, na: [], criteria: ids.map((cid) => ({ id: cid, verdict: v, status: 'judged' })) });
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'judgments-quality.json'), JSON.stringify({ judges: ['a', 'b', 'c'], records }));
  return { spec: { id, harness, role }, armId, unit, rows, run: { dir, runs: [] } };
}

test('the view gives three axes per cell, per phase with the pack median, and the paired difference with its spread', () => {
  const root = tmp();
  try {
    const tasks = loadTasks(BENCH, { extraDirs: [path.join(BENCH, 'sdlc')] });
    const kon = (t, rep) => (t === 'sdlc-arch-decision' ? 80 + rep : 70 + rep);
    const van = (t, rep) => (t === 'sdlc-arch-decision' ? 60 + rep : 72 + rep);
    const cells = SPECS.map((s) => fakeCell(root, s, {
      tasks,
      quality: s[2] === 'vanilla' ? van : kon,
      cost: s[2] === 'vanilla' ? 1 : 3,
      seconds: s[2] === 'vanilla' ? 100 : 250,
      // The median of fail, pass, pass is pass for konductor; of fail, fail, partial is fail for vanilla.
      verdicts: s[2] === 'vanilla' ? ['fail', 'fail', 'partial'] : ['fail', 'pass', 'pass'],
    }));
    const s = summarizeSdlc({ cells, tasks, pack, taskIds: ['sdlc-arch-decision', 'sdlc-problem-framing'] });
    const kk = s.cells.find((c) => c.id === 'kiroKonductor');
    assert.deepEqual([kk.quality.mean, kk.costPerRun, kk.secondsPerRun, kk.runs], [76.5, 3, 250, 4]);
    const arch = s.phases.find((p) => p.id === 'architecture');
    assert.deepEqual(arch.tasks, ['sdlc-arch-decision']);
    assert.deepEqual([arch.cells.kiroKonductor.quality.mean, arch.cells.kiroKonductor.pack.mean, arch.cells.kiroVanilla.pack.mean], [81.5, 100, 0]);
    assert.ok(s.uncovered.includes('poc'));
    const p = s.paired.kiro;
    assert.deepEqual(p.perTask.map((x) => x.delta), [20, -2]);
    assert.deepEqual([p.summary.wins, p.summary.losses, p.summary.ties, p.summary.median], [1, 1, 0, 9]);
    assert.equal(p.perTask[0].costRatio, 3);
    assert.equal(p.perTask[0].timeRatio, 2.5);
    assert.ok(p.perTask[0].konductor.sd > 0, 'the spread over replicates is kept');
    const md = toMarkdown(sdlcBlocks(s, (id) => id));
    assert.match(md, /## Quality, cost and time/);
    assert.match(md, /## By SDLC phase/);
    assert.match(md, /## Paired by task, Kiro CLI: konductor minus vanilla/);
    assert.match(md, /konductor ahead on 1, behind on 1, tied on 0/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('export-reference reads an extra tasks directory and adds the keyword stub laid over the reference', () => {
  const out = tmp();
  try {
    const r = exportReferenceSheet({ benchDir: BENCH, extraDirs: [path.join(BENCH, 'sdlc')], taskIds: ['sdlc-spike-dedupe'], criteriaIds: NEW_PHASE.poc, outDir: out, seed: 2 });
    const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
    assert.equal(r.n, 2);
    assert.deepEqual(Object.values(key.items).map((k) => k.tree).sort(), ['reference', 'stub']);
    const sheet = JSON.parse(fs.readFileSync(r.sheetPath, 'utf8'));
    for (const it of sheet.items) assert.deepEqual(it.criteria.map((c) => c.id), NEW_PHASE.poc);
    // The stub item shows the reference files it sits on plus its own, so it is not told apart by a short diff alone.
    assert.ok(sheet.items.every((it) => it.changes.includes('spike/run.js') && it.changes.includes('docs/spike.md')));
    assert.ok(!sheet.items.some((it) => /stub/i.test(it.changes)), 'no file names the tree');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

const REVIEW_TASKS = { 'sdlc-code-review': 'sd-review-diff', 'sdlc-design-review-gaps': 'sd-design-doc', 'sdlc-review-audit': 'sd-review-audit' };

test('the review tasks share one key matcher, kept identical in each hidden directory', () => {
  const copies = Object.keys(REVIEW_TASKS).map((id) => fs.readFileSync(path.join(BENCH, 'sdlc', 'hidden', id, 'hidden', 'review-key.js'), 'utf8'));
  assert.equal(new Set(copies).size, 1);
});

test('the review keys stay out of what the agent sees: no fixture file names a planted id or holds the key', () => {
  for (const fixture of Object.values(REVIEW_TASKS)) {
    const dir = path.join(BENCH, 'sdlc', 'fixtures', fixture);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const file of walk(dir).filter((f) => path.basename(f) !== '.bench-answer-key.md')) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!/\b(D[1-6]|G[1-7]|M[1-3]|X[12])\b|planted|decoy|answer key/i.test(text), path.relative(BENCH, file));
    }
  }
});

test('the key matcher gives each finding to one planted item and reads severities and locations', () => {
  const key = require(path.join(BENCH, 'sdlc', 'hidden', 'sdlc-code-review', 'hidden', 'review-key.js'));
  const items = key.parseItems('## Findings\n\n- [high] `src/a.js:3` lost update\n  across awaits\n- [nit] naming\n\nVerdict: X');
  assert.deepEqual(items.map((i) => [i.severity, i.file, i.line]), [['high', 'src/a.js', 3], ['nit', null, null]]);
  assert.match(items[0].text, /across awaits/);
  const a = key.assign(items, [{ id: 'A', phrases: [/lost update/] }, { id: 'B', phrases: [/update|naming/] }]);
  assert.deepEqual([a.get('A').length, a.get('B').length], [1, 1]);
});
