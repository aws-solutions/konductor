// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads a finished wave directory into arm scores for `cap decide`, checks that a wave is complete, and writes the
// unified diff for a decision. Wave directories and the repository are only read; patches go to a caller-chosen place.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadRun } = require('../report/load.js');
const { analyze } = require('../report/generate.js');
const { qualityOfRun, loadScoring } = require('../report/scores.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { scanRunDirs } = require('./usage.js');
const { resolveBase } = require('./source.js');
const { buildVariant } = require('./variant.js');
const { parseSkill } = require('./sections.js');
const { applyCuts } = require('./ablate.js');

const FAILED_OUTCOMES = ['timeout', 'error'];

/** Quality per run on a 0..1 scale, by arm. Infra errors and model mismatches are left out; a timeout or error counts as 0. */
function armScoresFromRows(rows, weights) {
  const out = {};
  for (const r of rows) {
    const a = (out[r.arm] ??= { scores: [], credits: [], keys: [], excluded: { infraError: 0, modelMismatch: 0 }, failedAsZero: 0, unscored: 0 });
    if (r.outcome === 'infraError' || r.outcome === 'modelMismatch') { a.excluded[r.outcome]++; continue; }
    const q = qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights);
    if (q) a.scores.push(q.score / 100);
    else if (FAILED_OUTCOMES.includes(r.outcome)) { a.scores.push(0); a.failedAsZero++; } else { a.unscored++; continue; }
    a.keys.push({ task: r.task, rep: r.rep });
    if (typeof r.credits === 'number' && Number.isFinite(r.credits)) a.credits.push(r.credits);
  }
  return out;
}

/** { complete, state } for a wave directory, with the same checks the study scripts use. */
function waveComplete(dir, { arms, reps, tasks }) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { return { complete: false, state: 'no-summary' }; }
  if (s.interrupted) return { complete: false, state: `interrupted:${s.interrupted}` };
  if (!s.isolationGate || s.isolationGate.ok !== true) return { complete: false, state: 'isolation-gate-not-ok' };
  if ((s.armIds ?? []).length !== arms || s.replicates !== reps || (s.taskIds ?? []).length !== tasks) return { complete: false, state: 'config-mismatch' };
  const want = arms * reps * tasks;
  if (!Array.isArray(s.results) || s.results.length !== want) return { complete: false, state: `runs ${(s.results ?? []).length}/${want}` };
  if (s.results.some((r) => r.status === 'budget_skipped')) return { complete: false, state: 'budget-skipped' };
  return { complete: true, state: 'complete' };
}

const TOOL_CALL = /"sessionUpdate":"tool_call"/;

/**
 * Scores per arm for one wave directory plus, for each arm in `refPaths`, how many runs opened that reference file
 * (a tool call that names it; text that merely mentions it does not count).
 */
function readWave({ dir, benchDir, extraTasks = [], skill, refPaths = {}, baseline = 'ctl' }) {
  const run = loadRun(dir);
  const tasks = loadTasks(benchDir, { extraDirs: extraTasks });
  const base = run.runs.some((r) => r.armId === baseline) ? baseline : run.runs[0].armId;
  const { rows } = analyze({ run, tasks, baseline: base });
  const arms = armScoresFromRows(rows, loadScoring());
  const loadedAt = new Map(scanRunDirs([dir], { harnesses: ['kiro-cli'] }).runs.map((r) => [`${r.arm}\u0000${r.task}\u0000${r.replicate}`, Boolean(r.loads[String(skill).toLowerCase()])]));
  for (const [id, a] of Object.entries(arms)) a.loaded = a.keys.map((k) => loadedAt.get(`${id}\u0000${k.task}\u0000${k.rep}`) ?? false);
  const opened = {};
  for (const [armId, ref] of Object.entries(refPaths)) {
    let n = 0;
    for (const r of run.runs.filter((x) => x.armId === armId)) {
      let text = '';
      try { text = fs.readFileSync(path.join(r.dir, 'stream.jsonl'), 'utf8'); } catch { continue; }
      if (text.split('\n').some((l) => TOOL_CALL.test(l) && l.includes(ref))) n++;
    }
    opened[armId] = n;
  }
  return { arms, opened };
}

// ---- patches ----

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_DIFF_OPTS: '' };

function copyRel(from, to, rels) {
  for (const rel of rels) {
    const src = path.join(from, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(to, rel), { recursive: true });
  }
}

/** Unified diff between two trees limited to relPaths, with a/ and b/ prefixes that `git apply` takes from the tree root. */
function treeDiff(aDir, bDir, relPaths) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skilldiff-'));
  try {
    fs.mkdirSync(path.join(tmp, 'a'));
    fs.mkdirSync(path.join(tmp, 'b'));
    copyRel(aDir, path.join(tmp, 'a'), relPaths);
    copyRel(bDir, path.join(tmp, 'b'), relPaths);
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', 'a', 'b'], { cwd: tmp, encoding: 'utf8', env: GIT_ENV, maxBuffer: 1 << 28 });
    if (r.status !== 0 && r.status !== 1) throw new Error(`git diff failed: ${r.stderr}`);
    let header = false;
    return r.stdout.split('\n').map((l) => {
      if (l.startsWith('diff --git ')) { header = true; return l.replace(/^diff --git a\/[ab]\/(.*) b\/[ab]\/(.*)$/, 'diff --git a/$1 b/$2'); }
      if (l.startsWith('@@')) header = false;
      if (!header) return l;
      return l.replace(/^--- [ab]\/[ab]\//, '--- a/').replace(/^\+\+\+ [ab]\/[ab]\//, '+++ b/');
    }).join('\n');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const filesOf = (patch) => [...new Set([...patch.matchAll(/^diff --git a\/(.*) b\/.*$/gm)].map((m) => m[1]))];

/**
 * { patch, files } for a DELETE or PRUNE decision, or null for any other call. The patch is against `base`; nothing is
 * applied. A PRUNE decision names sections by id and line range, and a range that no longer matches is an error.
 */
function buildSkillPatch({ repo, base, decision }) {
  if (!['DELETE', 'PRUNE'].includes(decision.decision)) return null;
  const b = resolveBase(base, repo);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skillpatch-'));
  try {
    if (decision.decision === 'DELETE') {
      const v = buildVariant({ repo, base, drop: [decision.skill], scratch: path.join(work, 'v') });
      const patch = treeDiff(b.dir, v.dir, [`skills/${decision.name}`, 'agents']);
      return { patch, files: filesOf(patch) };
    }
    const rel = `skills/${decision.name}/SKILL.md`;
    const text = fs.readFileSync(path.join(b.dir, rel), 'utf8');
    const parsed = parseSkill(text);
    const edits = decision.sections.filter((s) => s.action === 'remove' || s.action === 'move').map((s) => {
      const cur = parsed.sections.find((x) => x.id === s.id);
      if (!cur || cur.startLine !== s.startLine || cur.endLine !== s.endLine) throw new Error(`${rel} changed since the study: section "${s.id}" was lines ${s.startLine}-${s.endLine} and is ${cur ? `${cur.startLine}-${cur.endLine}` : 'gone'}`);
      return { section: cur, action: s.action, openWhen: s.openWhen };
    });
    const cut = applyCuts(text, edits);
    const dest = path.join(work, 'B');
    copyRel(b.dir, dest, [`skills/${decision.name}`]);
    fs.writeFileSync(path.join(dest, rel), cut.text);
    for (const [refRel, refText] of Object.entries(cut.files)) {
      const file = path.join(dest, `skills/${decision.name}`, refRel);
      if (fs.existsSync(file)) throw new Error(`skills/${decision.name}/${refRel} already exists at the base ref`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, refText);
    }
    const patch = treeDiff(b.dir, dest, [`skills/${decision.name}`]);
    return { patch, files: filesOf(patch) };
  } finally {
    b.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { armScoresFromRows, waveComplete, readWave, treeDiff, buildSkillPatch };
