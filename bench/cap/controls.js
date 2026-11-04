// SPDX-License-Identifier: Apache-2.0
'use strict';

// Known-answer controls for skill studies. A skill study is only worth reading if the pipeline finds a lift that was
// planted and finds none for a decoy. The keep control is a skill that holds a fact nobody can guess, with a task that
// needs it. The prune control is a skill about something else, added to an ordinary task. Everything here is free.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { qualityOfRun, loadScoring } = require('../report/scores.js');
const { variantPaths } = require('./variant.js');

const CODENAME = 'heron-4417';
// Neutral names: the agent sees skill names, and a name like "control" would tell it this is a test.
const KEEP_SKILL = 'release-codename';
const PRUNE_SKILL = 'starter-feeding';
const MIN_N = 3;
// The smallest quality band, in points, inside which a difference is called no effect even without an A/A arm.
const MIN_BAND = 10;
// The planted lift is close to the full range, so a keep control that cannot clear this is not working.
const KEEP_MIN_LIFT = 30;
const ACTING_AGENT = 'konductor';
const bench = 'node bench/runner/bench.js';

const KEEP_TEXT = `---
name: ${KEEP_SKILL}
description: Use when asked for this project's release codename or how its releases are named. Holds the codename.
---

# Release codename

The release codename for this project is \`${CODENAME}\`. Write it exactly like that: lower case, with the hyphen.
`;

const PRUNE_TEXT = `---
name: ${PRUNE_SKILL}
description: Use when asked about feeding or looking after a sourdough starter. Holds a feeding schedule.
---

# Sourdough starter feeding

Feed a starter equal weights of starter, flour and water every 12 hours at room temperature. In a cool kitchen,
feed once a day. A starter that smells of nail polish is hungry and wants a feed.
`;

const FIXTURE = { name: 'plain-project', files: { 'README.md': '# Plain project\n\nA small project with no notes about releases.\n' } };

const KEEP_TASK = {
  id: 'control-keep', class: 'simple', target: `skill:${KEEP_SKILL}`, control: 'positive',
  prompt: 'Create a file named CODENAME.txt in the project root. It must contain this project\'s release codename, exactly as the team defines it, and nothing else. Do not ask me questions; if something is unclear, make a reasonable assumption, say so in your final message, and finish the work.',
  fixture: FIXTURE.name, timeoutSec: 300,
  checks: [{ type: 'file_exists', path: 'CODENAME.txt' }, { type: 'contains', path: 'CODENAME.txt', pattern: CODENAME }],
  rubric: [], tiers: ['cap'],
};

const PRUNE_TASK = {
  id: 'control-prune', class: 'simple', target: `skill:${PRUNE_SKILL}`, control: 'negative',
  prompt: 'Create a file named GREETING.txt in the project root that contains the single word hello and nothing else. Do not ask me questions; finish the work.',
  fixture: FIXTURE.name, timeoutSec: 300,
  checks: [{ type: 'file_exists', path: 'GREETING.txt' }, { type: 'contains', path: 'GREETING.txt', pattern: 'hello' }],
  rubric: [], tiers: ['cap'],
};

function buildControls() {
  return {
    skills: [{ role: 'keep', name: KEEP_SKILL, text: KEEP_TEXT }, { role: 'prune', name: PRUNE_SKILL, text: PRUNE_TEXT }],
    tasks: [KEEP_TASK, PRUNE_TASK],
    fixtures: [FIXTURE],
  };
}

/** Writes <outDir>/controls/{skills,tasks}; tasks/ is a ready --extra-tasks directory with its fixtures beside the task files. */
function writeControls({ outDir }) {
  const c = buildControls();
  const root = path.join(path.resolve(outDir), 'controls');
  const skillsDir = path.join(root, 'skills');
  const tasksDir = path.join(root, 'tasks');
  for (const s of c.skills) {
    fs.mkdirSync(path.join(skillsDir, s.name), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, s.name, 'SKILL.md'), s.text);
  }
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const t of c.tasks) fs.writeFileSync(path.join(tasksDir, `${t.id}.json`), `${JSON.stringify(t, null, 2)}\n`);
  for (const f of c.fixtures) {
    for (const [file, text] of Object.entries(f.files)) {
      fs.mkdirSync(path.join(tasksDir, 'fixtures', f.name), { recursive: true });
      fs.writeFileSync(path.join(tasksDir, 'fixtures', f.name, file), text);
    }
  }
  return { root, skillsDir, tasksDir, keepFile: path.join(skillsDir, KEEP_SKILL, 'SKILL.md'), pruneFile: path.join(skillsDir, PRUNE_SKILL, 'SKILL.md') };
}

const quote = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/**
 * The exact arms and commands for the controls study: the base ref, its A/A repeat, and the base with each control
 * skill added. `writes` is the result of writeControls (the variant directory names depend on the skill files).
 */
function controlPlan({ repo, base = 'v1.2.0', writes, scratch, replicates = 5, agentEngine = 'v2', tmpRoot }) {
  const add = (file, id) => variantPaths({ repo, base, add: [`${id}=${file}`], toAgent: [ACTING_AGENT], scratch, agentEngine });
  const keep = add(writes.keepFile, `skill:${KEEP_SKILL}`);
  const prune = add(writes.pruneFile, `skill:${PRUNE_SKILL}`);
  const arms = [`base=${base}`, `base-b=${base}`, `ctl-keep=dir:${keep.dir}`, `ctl-prune=dir:${prune.dir}`];
  const runDir = path.join(tmpRoot ?? os.tmpdir(), 'konductor-bench', 'runs', 'controls');
  const variant = (id, file) => `${bench} cap variant --base ${base} --add ${id}=${quote(file)} --to-agent ${ACTING_AGENT} --scratch ${quote(scratch)}`;
  const commands = {
    variantKeep: variant(`skill:${KEEP_SKILL}`, writes.keepFile),
    variantPrune: variant(`skill:${PRUNE_SKILL}`, writes.pruneFile),
    run: `${bench} run --suite cap --arms '${arms.join(',')}' --tasks control-keep,control-prune --replicates ${replicates} --parallel 1 --extra-tasks ${quote(writes.tasksDir)} --out ${quote(runDir)}`,
    check: `${bench} cap controls --check ${quote(runDir)} --base-arm base --aa base-b --keep ctl-keep --prune ctl-prune --extra-tasks ${quote(writes.tasksDir)}`,
  };
  return { arms, runs: 2 * arms.length * replicates, runDir, commands };
}

// ---- evaluation ----

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Quality of one arm on one task: failed runs count as 0, infra errors and model mismatches are left out and listed. */
function qualityOf(rows, arm, task, weights) {
  const mine = rows.filter((r) => r.arm === arm && r.task === task);
  const excluded = { infraError: 0, modelMismatch: 0 };
  const scores = [];
  let failedAsZero = 0;
  let unscored = 0;
  for (const r of mine) {
    if (r.outcome === 'infraError' || r.outcome === 'modelMismatch') { excluded[r.outcome]++; continue; }
    const q = qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights);
    if (q) scores.push(q.score);
    else if (r.outcome === 'timeout' || r.outcome === 'error') { scores.push(0); failedAsZero++; } else unscored++;
  }
  return { n: scores.length, mean: mean(scores), excluded, failedAsZero, unscored };
}

function judgeControl(kind, head, base, band) {
  const delta = head.mean !== null && base.mean !== null ? head.mean - base.mean : null;
  const out = { delta, nHead: head.n, nBase: base.n, excluded: head.excluded, failedAsZero: head.failedAsZero, unscored: head.unscored, status: 'INCONCLUSIVE' };
  if (delta === null || head.n < MIN_N || base.n < MIN_N) return { ...out, reason: `fewer than ${MIN_N} runs on a side (${head.n} and ${base.n})` };
  if (kind === 'keep') {
    const ok = delta > band && delta >= KEEP_MIN_LIFT;
    return { ...out, status: ok ? 'PASS' : 'FAIL', reason: ok ? `lift of ${delta.toFixed(0)} points clears the ${band.toFixed(0)}-point band` : `lift of ${delta.toFixed(0)} points does not clear the ${band.toFixed(0)}-point band and ${KEEP_MIN_LIFT} points` };
  }
  const ok = Math.abs(delta) <= band;
  return { ...out, status: ok ? 'PASS' : 'FAIL', reason: ok ? `difference of ${delta.toFixed(0)} points is inside the ${band.toFixed(0)}-point band` : `difference of ${delta.toFixed(0)} points is outside the ${band.toFixed(0)}-point band for a skill that should do nothing` };
}

/**
 * rows: report rows (arm, task, hidden, checks, rubric, outcome). `aa` is an optional repeat of the base arm; its
 * quality gap to the base on the control tasks widens the band. Returns { keep, prune, band, aaSpread, aaGiven, trusted, summary }.
 */
function evaluateControls({ rows, base, keep, prune, aa = null, weights = loadScoring() }) {
  let spread = 0;
  if (aa) {
    const gaps = ['control-keep', 'control-prune'].map((t) => {
      const a = qualityOf(rows, base, t, weights);
      const b = qualityOf(rows, aa, t, weights);
      return a.mean !== null && b.mean !== null ? Math.abs(a.mean - b.mean) : 0;
    });
    spread = Math.max(...gaps);
  }
  const band = Math.max(MIN_BAND, spread);
  const k = judgeControl('keep', qualityOf(rows, keep, 'control-keep', weights), qualityOf(rows, base, 'control-keep', weights), band);
  const p = judgeControl('prune', qualityOf(rows, prune, 'control-prune', weights), qualityOf(rows, base, 'control-prune', weights), band);
  const trusted = k.status === 'PASS' && p.status === 'PASS';
  const summary = trusted
    ? 'The planted lift was found and the decoy showed no effect, so the skill verdicts from this study can be trusted.'
    : `Do not trust the skill verdicts from this study: keep control ${k.status}${k.reason ? ` (${k.reason})` : ''}, prune control ${p.status}${p.reason ? ` (${p.reason})` : ''}.`;
  return { keep: k, prune: p, band, aaSpread: spread, aaGiven: Boolean(aa), trusted, summary };
}

module.exports = {
  buildControls, writeControls, controlPlan, evaluateControls, CODENAME, KEEP_SKILL, PRUNE_SKILL, MIN_N, MIN_BAND, KEEP_MIN_LIFT,
};
