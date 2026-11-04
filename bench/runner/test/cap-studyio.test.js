// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reading finished wave directories into arm scores, the completeness check, and the unified diff of a decision.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { write } = require('./helpers.js');
const { makeRunDir, kiroEvents, jsonl } = require('./cap-prune-helpers.js');
const { makeCapRepo, makeCapBench, spec } = require('./cap-helpers.js');
const { armScoresFromRows, readWave, waveComplete, treeDiff, buildSkillPatch } = require('../../cap/studyio.js');
const { parseSkill } = require('../../cap/sections.js');
const { candidateSections } = require('../../cap/ablate.js');

const ARMS = [{ id: 'ctl', ref: 'v0', sha: 'a'.repeat(40) }, { id: 'ctl-b', ref: 'v0', sha: 'a'.repeat(40) }, { id: 'del', ref: null, label: 'del@x', sha: null }];

test('armScoresFromRows turns quality 0..100 into 0..1, keeps credits, drops infra errors and counts failures as zero', () => {
  const row = (arm, over) => ({ arm, task: 't', rep: 1, outcome: 'pass', hidden: 1, checks: 1, rubric: null, credits: 2, ...over });
  const rows = [
    row('ctl', { hidden: 1, checks: 1 }), row('ctl', { rep: 2, hidden: 0.5, checks: 1 }),
    row('ctl', { rep: 3, outcome: 'timeout', hidden: null, checks: null, credits: null }),
    row('ctl', { rep: 4, outcome: 'infraError' }), row('ctl', { rep: 5, hidden: null, checks: null, rubric: null }),
  ];
  const a = armScoresFromRows(rows, { hidden: 0.5, checks: 0.2, rubric: 0.3 }).ctl;
  assert.equal(a.scores.length, 3);
  assert.ok(a.scores.every((x) => x >= 0 && x <= 1));
  assert.equal(a.scores[2], 0, 'a timeout counts as zero');
  assert.equal(a.excluded.infraError, 1);
  assert.equal(a.unscored, 1);
  assert.equal(a.credits.length, 2);
});

test('armScoresFromRows counts the runs and the timeouts per arm, and the tasks that timed out', () => {
  const row = (arm, over) => ({ arm, task: 't1', rep: 1, outcome: 'good', hidden: 1, checks: 1, rubric: null, credits: 2, ...over });
  const rows = [
    row('ctl'), row('ctl', { rep: 2, task: 't2' }),
    row('del', { outcome: 'timeout', hidden: 0.5, checks: 0.5 }), row('del', { rep: 2, outcome: 'timeout', hidden: null, checks: null, task: 't2' }), row('del', { rep: 3 }),
    row('del', { rep: 4, outcome: 'infraError' }),
  ];
  const out = armScoresFromRows(rows, { hidden: 0.5, checks: 0.2, rubric: 0.3 });
  assert.deepEqual([out.ctl.runs, out.ctl.timeouts, out.ctl.timeoutTasks], [2, 0, {}]);
  assert.equal(out.del.runs, 3, 'an infra error is left out of the count');
  assert.equal(out.del.timeouts, 2, 'a timeout that still earned a partial score is a timeout');
  assert.deepEqual(out.del.timeoutTasks, { t1: 1, t2: 1 });
});

test('waveComplete wants a summary that is not interrupted, a passed isolation gate and every run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captest-'));
  const sum = (o = {}) => write(path.join(dir, 'summary.json'), JSON.stringify({ interrupted: null, isolationGate: { ok: true }, armIds: ['a', 'b'], replicates: 2, taskIds: ['t'], results: [1, 2, 3, 4].map(() => ({ status: 'success' })), ...o }));
  try {
    assert.equal(waveComplete(dir, { arms: 2, reps: 2, tasks: 1 }).complete, false, 'no summary yet');
    sum();
    assert.equal(waveComplete(dir, { arms: 2, reps: 2, tasks: 1 }).complete, true);
    sum({ interrupted: 'SIGTERM' });
    assert.match(waveComplete(dir, { arms: 2, reps: 2, tasks: 1 }).state, /interrupted/);
    sum({ isolationGate: { ok: false } });
    assert.match(waveComplete(dir, { arms: 2, reps: 2, tasks: 1 }).state, /isolation/);
    sum({ results: [{}, {}] });
    assert.match(waveComplete(dir, { arms: 2, reps: 2, tasks: 1 }).state, /runs 2\/4/);
    sum({ results: [1, 2, 3, 4].map((i) => ({ status: i === 1 ? 'budget_skipped' : 'success' })) });
    assert.match(waveComplete(dir, { arms: 2, reps: 2, tasks: 1 }).state, /budget/);
    assert.match(waveComplete(dir, { arms: 3, reps: 2, tasks: 1 }).state, /config/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readWave gives per-arm scores, credits, whether the skill loaded and how many runs opened a reference file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'captest-'));
  try {
    const bench = makeCapBench(root);
    const dir = path.join(root, 'w1');
    const pass = [{ type: 'file_exists', path: 'a.txt', passed: true }];
    const fail = [{ type: 'file_exists', path: 'a.txt', passed: false }];
    const runs = [];
    for (let rep = 1; rep <= 4; rep++) {
      runs.push({ arm: 'ctl', task: 'rev-one', rep, loads: rep <= 3 ? ['alpha'] : [], credits: 4, checks: pass });
      runs.push({ arm: 'ctl-b', task: 'rev-one', rep, loads: ['alpha'], credits: 4, checks: pass });
      runs.push({ arm: 'del', task: 'rev-one', rep, loads: [], credits: 3, checks: rep <= 2 ? pass : fail });
    }
    makeRunDir(dir, { arms: ARMS, runs });
    fs.appendFileSync(path.join(dir, 'del/rev-one/1/stream.jsonl'), `${JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: 'r1', rawInput: { path: 'skills/alpha/references/detail.md' } } } })}\n`);
    fs.appendFileSync(path.join(dir, 'del/rev-one/2/stream.jsonl'), `${JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'r1', rawOutput: 'references/detail.md is mentioned in an output only' } } })}\n`);
    const w = readWave({ dir, benchDir: bench, skill: 'alpha', refPaths: { del: 'references/detail.md' } });
    assert.deepEqual(Object.keys(w.arms).sort(), ['ctl', 'ctl-b', 'del']);
    assert.equal(w.arms.ctl.scores.length, 4);
    assert.deepEqual(w.arms.ctl.loaded, [true, true, true, false]);
    assert.equal(w.arms.del.scores.filter((s) => s === 0).length, 2);
    assert.deepEqual(w.arms.del.credits, [3, 3, 3, 3]);
    assert.equal(w.opened.del, 1, 'only a tool call that names the file counts, not text that mentions it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- patches ----

const body = (t, n) => Array.from({ length: n }, (_, i) => `${t} line ${i + 1} with enough words to take some bytes.`).join('\n');
const SKILL_TEXT = `---\nname: big\ndescription: Use when testing patches.\n---\n\n# Big\n\nOpening.\n\n## Workflow\n\n${body('workflow', 30)}\n\n## Template\n\n${body('template', 30)}\n\n## Checklist\n\n${body('check', 30)}\n`;

function patchEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'captest-'));
  const r = makeCapRepo(root, {
    files: (repo) => {
      write(path.join(repo, 'skills/big/SKILL.md'), SKILL_TEXT);
      write(path.join(repo, 'skills/other/SKILL.md'), '---\nname: other\ndescription: Use when other.\n---\n\n# Other\n');
      write(path.join(repo, 'agents/konductor.agent-spec.json'), `${JSON.stringify(spec('konductor', { skills: ['big', 'other'], claudeSkills: ['big'] }), null, 2)}\n`);
    },
  });
  return { root, repo: r.repo, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function applyChecks(repo, patchText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captest-'));
  try {
    const arch = spawnSync('git', ['-C', repo, 'archive', 'HEAD'], { maxBuffer: 1 << 28 });
    spawnSync('tar', ['-x', '-C', dir], { input: arch.stdout });
    fs.writeFileSync(path.join(dir, 'p.patch'), patchText);
    const check = spawnSync('git', ['apply', '--check', 'p.patch'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
    const apply = check.status === 0 ? spawnSync('git', ['apply', 'p.patch'], { cwd: dir, encoding: 'utf8' }) : null;
    return { ok: check.status === 0, err: check.stderr, tree: dir, applied: apply && apply.status === 0 };
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}

test('treeDiff produces a unified diff with a/ and b/ paths that git apply accepts', () => {
  const e = patchEnv();
  try {
    const a = path.join(e.root, 'A');
    const b = path.join(e.root, 'B');
    write(path.join(a, 'skills/big/SKILL.md'), 'one\ntwo\n');
    write(path.join(b, 'skills/big/SKILL.md'), 'one\n2\n');
    write(path.join(b, 'skills/big/references/x.md'), 'new\n');
    const d = treeDiff(a, b, ['skills/big']);
    assert.match(d, /^diff --git a\/skills\/big\/SKILL\.md b\/skills\/big\/SKILL\.md$/m);
    assert.match(d, /^--- \/dev\/null$/m);
    assert.match(d, /^\+\+\+ b\/skills\/big\/references\/x\.md$/m);
    assert.doesNotMatch(d, /a\/a\/|b\/b\//);
  } finally { e.done(); }
});

test('a PRUNE patch removes and moves the decided sections and applies cleanly to the base tree', () => {
  const e = patchEnv();
  try {
    const parsed = parseSkill(SKILL_TEXT);
    const cands = candidateSections(parsed, { minBytes: 500 });
    const decision = {
      skill: 'skill:big', name: 'big', decision: 'PRUNE',
      sections: cands.map((s, i) => ({ id: s.id, title: s.title, startLine: s.startLine, endLine: s.endLine, kind: s.kind, estTokens: s.estTokens, action: i === 0 ? 'remove' : i === 1 ? 'move' : 'keep', openWhen: i === 1 ? 'you need the template' : undefined })),
    };
    const p = buildSkillPatch({ repo: e.repo, base: 'v0', decision });
    assert.match(p.patch, /^diff --git a\/skills\/big\/SKILL\.md b\/skills\/big\/SKILL\.md$/m);
    assert.match(p.patch, /^\+\+\+ b\/skills\/big\/references\/template\.md$/m);
    assert.match(p.patch, /^-## Workflow$/m);
    assert.match(p.patch, /when you need the template\./);
    assert.deepEqual(p.files.sort(), ['skills/big/SKILL.md', 'skills/big/references/template.md']);
    const c = applyChecks(e.repo, p.patch);
    assert.equal(c.ok, true, c.err);
    assert.equal(c.applied, true);
    const after = fs.readFileSync(path.join(c.tree, 'skills/big/SKILL.md'), 'utf8');
    assert.doesNotMatch(after, /workflow line 3 /);
    assert.match(after, /## Checklist/);
    assert.ok(fs.existsSync(path.join(c.tree, 'skills/big/references/template.md')));
    fs.rmSync(c.tree, { recursive: true, force: true });
  } finally { e.done(); }
});

test('a DELETE patch removes the skill directory and its name from every agent list, and applies cleanly', () => {
  const e = patchEnv();
  try {
    const p = buildSkillPatch({ repo: e.repo, base: 'v0', decision: { skill: 'skill:big', name: 'big', decision: 'DELETE', sections: [] } });
    assert.match(p.patch, /^deleted file mode/m);
    assert.match(p.patch, /^diff --git a\/agents\/konductor\.agent-spec\.json/m);
    const c = applyChecks(e.repo, p.patch);
    assert.equal(c.ok, true, c.err);
    assert.equal(fs.existsSync(path.join(c.tree, 'skills/big')), false);
    assert.doesNotMatch(fs.readFileSync(path.join(c.tree, 'agents/konductor.agent-spec.json'), 'utf8'), /"big"/);
    fs.rmSync(c.tree, { recursive: true, force: true });
  } finally { e.done(); }
});

test('no patch for KEEP or NEEDS DATA, and a changed skill file is refused rather than patched at the wrong lines', () => {
  const e = patchEnv();
  try {
    assert.equal(buildSkillPatch({ repo: e.repo, base: 'v0', decision: { skill: 'skill:big', name: 'big', decision: 'KEEP', sections: [] } }), null);
    const cands = candidateSections(parseSkill(SKILL_TEXT), { minBytes: 500 });
    const s = cands[0];
    const bad = { skill: 'skill:big', name: 'big', decision: 'PRUNE', sections: [{ id: s.id, title: s.title, startLine: s.startLine + 1, endLine: s.endLine, action: 'remove', kind: 'procedure', estTokens: 1 }] };
    assert.throws(() => buildSkillPatch({ repo: e.repo, base: 'v0', decision: bad }), /changed since the study/);
  } finally { e.done(); }
});

test('building a patch does not touch the repository', () => {
  const e = patchEnv();
  try {
    const cands = candidateSections(parseSkill(SKILL_TEXT), { minBytes: 500 });
    buildSkillPatch({ repo: e.repo, base: 'v0', decision: { skill: 'skill:big', name: 'big', decision: 'PRUNE', sections: cands.map((s) => ({ id: s.id, title: s.title, startLine: s.startLine, endLine: s.endLine, kind: s.kind, estTokens: s.estTokens, action: 'remove' })) } });
    assert.equal(execFileSync('git', ['-C', e.repo, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  } finally { e.done(); }
});
