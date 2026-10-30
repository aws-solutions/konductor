// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js pr-plan`: prints the commands to benchmark one ref or working tree against a release. Runs nothing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArmSpec } = require('./arms.js');
const { resolveRef } = require('./arm-source.js');
const { loadTasks, loadSuite, SUITE_NAMES, BENCH_DIR } = require('./tasks.js');

// Credits per arm for one pass over the suite, as measured: claude-sonnet-5.5, one replicate, one run per cell.
// `lowerBound` arms had runs that ended before their final metering event.
const OBSERVED = {
  model: 'claude-sonnet-5.5',
  replicates: 1,
  suites: {
    lite: { tasks: 5, credits: { vanilla: 6.78, 'v1.2.0': 23.31, main: 31.01 }, lowerBound: [] },
    real: { tasks: 7, credits: { vanilla: 14.22, 'v1.2.0': 61.32, main: 45.33 }, lowerBound: ['main'] },
    hard: { tasks: 6, credits: { vanilla: 20.06 }, lowerBound: [] },
  },
};

// The most credits one run cost in the first paired experiment (a konductor arm that ran a second delegation); a
// budget has to leave room for one run this size or the headroom rule skips a cell.
OBSERVED.tail = { credits: 11.07, note: 'largest single run observed, claude-sonnet-5.5, v1.2.0, design task' };

const HEADROOM = 1.5;
const DEFAULT_BASE = 'v1.2.0';
// A new arm is a konductor arm; main is the closest observed stand-in for its cost.
const NEW_ARM_PROXY = 'main';

const quote = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');

function seedOf(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h % 2147483647;
}

function parseNewArm(ref) {
  if (!ref || ref === true) throw new Error('--ref is required: name=<git ref> or name=dir:<path>');
  const parsed = parseArmSpec(ref);
  if (parsed.bare || !ref.includes('=') || !['git', 'dir'].includes(parsed.kind)) {
    throw new Error(`--ref takes name=<git ref> or name=dir:<path> with a name of your own, got "${ref}"`);
  }
  if (parsed.kind === 'dir') {
    if (parsed.path.includes(',')) throw new Error(`the directory path contains a comma, which --arms cannot carry: ${parsed.path}`);
    return { id: parsed.name, spec: `${parsed.name}=dir:${path.resolve(parsed.path)}`, parsed };
  }
  return { id: parsed.name, spec: ref, parsed };
}

function checkArmReachable(parsed, repo) {
  if (parsed.kind === 'dir') {
    const p = path.resolve(parsed.path);
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? null : `directory not found: ${p}`;
  }
  try { resolveRef(repo, parsed.ref); return null; } catch (e) { return e.message; }
}

function estimateFor({ suite, arms, newId, replicates, taskCount }) {
  const obs = OBSERVED.suites[suite];
  if (!obs) return { missing: ['every arm (the suite has no observed table)'], reason: `no observed credits for ${suite} for: every arm (the suite has no observed table)` };
  const missing = [];
  const lines = [];
  let perPass = 0;
  let lowerBound = false;
  for (const id of arms) {
    const key = id === newId ? NEW_ARM_PROXY : id;
    const credits = obs.credits[key];
    if (credits === undefined) { missing.push(id === newId ? `${id} (new arm, stands in for ${NEW_ARM_PROXY})` : id); continue; }
    perPass += credits;
    const lb = obs.lowerBound.includes(key);
    lowerBound ||= lb;
    lines.push({ arm: id, basis: id === newId ? `assumed like ${NEW_ARM_PROXY}` : 'observed', credits, lowerBound: lb });
  }
  if (missing.length) return { missing, reason: `no observed credits for ${suite} for: ${missing.join(', ')}` };
  const scale = taskCount / obs.tasks;
  const total = perPass * scale * replicates;
  return { total, lowerBound, scale, observedTasks: obs.tasks, taskCount, lines, replicates };
}

/**
 * The plan for benchmarking `ref` (name=ref or name=dir:path) against `base`, as data plus printable text.
 * Throws when the arm specs are wrong, or when the suite has no observed credits for an arm and the caller
 * gave no budget of their own: the budget cap is the only bound on spend, so it is not guessed.
 */
function planPr({
  ref, base = DEFAULT_BASE, suite = 'lite', replicates, noVanilla = false, budgetCredits = null, seed, benchDir = BENCH_DIR, repoRoot = null, now = new Date(), tmpRoot = os.tmpdir(),
}) {
  if (!SUITE_NAMES.includes(suite)) throw new Error(`--suite ${SUITE_NAMES.join('|')}`);
  const added = parseNewArm(ref);
  const baseParsed = parseArmSpec(base);
  if (baseParsed.kind === 'dir' || (baseParsed.kind === 'git' && !baseParsed.bare)) throw new Error(`--base takes vanilla, main or a release tag such as ${DEFAULT_BASE}`);
  if (added.id === baseParsed.name) throw new Error(`the new arm is named "${added.id}", the same as the base arm`);

  const tasks = loadTasks(benchDir);
  const s = loadSuite(suite, tasks, benchDir);
  const reps = replicates === undefined ? s.replicates : Number(replicates);
  if (!Number.isInteger(reps) || reps < 1) throw new Error('--replicates must be an integer >= 1');

  const armIds = [...(noVanilla || baseParsed.name === 'vanilla' ? [] : ['vanilla']), baseParsed.name];
  if (baseParsed.name === 'vanilla' && noVanilla) throw new Error('--no-vanilla and --base vanilla contradict each other');
  const specs = [...armIds, added.spec];
  const est = estimateFor({ suite, arms: [...armIds, added.id], newId: added.id, replicates: reps, taskCount: s.taskIds.length });
  if (est.missing && budgetCredits === null) {
    throw new Error(`${est.reason}. The runs are not guessed at: pass --budget-credits X to set your own cap, or use a suite with figures for these arms (lite, real).`);
  }
  const estimate = est.missing ? null : est;
  const budget = budgetCredits !== null ? Number(budgetCredits) : Math.ceil(estimate.total * HEADROOM);

  const outName = `${added.id}-${suite}-${stamp(now)}`;
  const out = path.join(tmpRoot, 'konductor-bench', 'runs', outName);
  const seedValue = seed === undefined ? seedOf(added.spec) : Number(seed);
  const repoFlag = repoRoot ? ` --repo-root ${quote(path.resolve(repoRoot))}` : '';
  const bench = 'node bench/runner/bench.js';
  const commands = {
    run: `${bench} run --suite ${suite} --arms ${quote(specs.join(','))} --replicates ${reps} --parallel 1 --seed ${seedValue} --budget-credits ${budget} --out ${quote(out)}${repoFlag}`,
    contrast: `${bench} contrast --run ${quote(out)} --base ${baseParsed.name}`,
    judge: `${bench} judge --run ${quote(out)} --baseline ${baseParsed.name}`,
    report: `${bench} report --run ${quote(out)} --baseline ${baseParsed.name}`,
  };

  const warnings = [];
  if (repoRoot) {
    const problem = checkArmReachable(added.parsed, path.resolve(repoRoot));
    if (problem) warnings.push(problem);
  }

  const text = renderPlan({ suite, reps, specs, added, baseParsed, estimate, est, budget, budgetCredits, commands, warnings, taskCount: s.taskIds.length });
  return { arms: specs, out, seed: seedValue, estimate, budget, commands, warnings, text };
}

function renderPlan({ suite, reps, specs, added, baseParsed, estimate, est, budget, budgetCredits, commands, warnings, taskCount }) {
  const L = [];
  L.push(`Plan: ${added.id} against ${baseParsed.name} on the ${suite} suite (${taskCount} task(s), ${reps} replicate${reps === 1 ? '' : 's'}). This prints the plan and runs nothing.`);
  L.push(`Arms: ${specs.join(', ')}`);
  for (const w of warnings) L.push('', `WARNING: ${w}`);
  L.push('');
  if (estimate) {
    L.push(`Estimate (credits per arm for one pass over the suite, observed on ${OBSERVED.model}, n=1, so a rough guide only):`);
    for (const l of estimate.lines) L.push(`  ${l.arm.padEnd(10)} ${l.lowerBound ? 'at least ' : ''}${l.credits.toFixed(2)}  (${l.basis})`);
    if (estimate.scale !== 1) L.push(`  figures were observed on ${estimate.observedTasks} tasks and the suite has ${estimate.taskCount}; scaled from ${estimate.observedTasks} to ${estimate.taskCount}`);
    L.push(`  total for ${reps} replicate${reps === 1 ? '' : 's'}: ${estimate.lowerBound ? 'at least ' : ''}${estimate.total.toFixed(2)} credits; cap ${budget} (${HEADROOM}x, rounded up). Judge credits are not included.`);
  } else {
    L.push(`No estimate: ${est.reason}. The cap below is the one you gave (${budgetCredits}). Judge credits are not included.`);
  }
  L.push('', '1. Run (stops launching new runs at the cap):', `   ${commands.run}`);
  L.push('', '2. Contrast, no credits:', `   ${commands.contrast}`);
  L.push('', '3. Judge (spends credits; rubric and pairwise against the base arm):', `   ${commands.judge}`);
  L.push('', '4. Report, no credits:', `   ${commands.report}`);
  L.push('', 'The runner never fetches. If the ref is not local yet, fetch it yourself first, for example: git fetch origin pull/<n>/head:pr-<n>');
  return L.join('\n');
}

module.exports = { planPr, OBSERVED, HEADROOM, quote, stamp, seedOf };
