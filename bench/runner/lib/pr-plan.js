// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js pr-plan`: prints the commands to benchmark one or more refs or working trees against a release. Runs nothing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArmSpec, runtimeOfSpec, CC_PREFIX } = require('./arms.js');
const { descriptorOf } = require('./harness/runtime.js');

// The two runtimes pr-plan plans: the default one (no arm prefix, Kiro CLI) and the one under the cc- prefix.
const KIRO = runtimeOfSpec('');
const CC = runtimeOfSpec(CC_PREFIX);
const { resolveRef } = require('./arm-source.js');
const { loadTasks, loadSuite, suiteExtraDirs, SUITE_NAMES, BENCH_DIR } = require('./tasks.js');

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

// Claude Code has no per-suite USD figure yet. The smoke runs (trivial tasks, claude-sonnet-5-5 on Bedrock) give a floor per
// run, not a forecast: real tasks cost more. So a Claude Code plan always needs the caller's own --budget-usd.
OBSERVED.claudeCode = {
  model: 'us.anthropic.claude-sonnet-5-5',
  perRunFloorUsd: { vanilla: 0.044, konductor: 0.185 },
  note: 'smoke runs on trivial tasks; the cost on the bench suites has not been measured',
};

const HEADROOM = 1.5;
const DEFAULT_BASE = 'v1.2.0';
// A new arm is a konductor arm; main is the closest observed stand-in for its cost.
const NEW_ARM_PROXY = 'main';
const CC_BASE = 'cc-vanilla';
const OUT_NAME_MAX = 60;

const quote = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');

function seedOf(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h % 2147483647;
}

/** One --ref: name=<git ref> or name=dir:<path>, optionally cc- prefixed for a Claude Code arm. */
function parseNewArm(ref) {
  if (!ref || ref === true) throw new Error('--ref is required: name=<git ref> or name=dir:<path> (cc-name=... for a Claude Code arm)');
  const parsed = parseArmSpec(ref);
  if (parsed.oc || parsed.st) throw new Error(`--ref ${ref}: pr-plan plans Kiro CLI and Claude Code (cc-) arms only`);
  const prefix = parsed.cc ? 'cc-' : '';
  if (parsed.bare || !ref.includes('=') || !['git', 'dir'].includes(parsed.kind)) {
    throw new Error(`--ref takes ${prefix}name=<git ref> or ${prefix}name=dir:<path> with a name of your own, got "${ref}"`);
  }
  const id = `${prefix}${parsed.name}`;
  const harness = runtimeOfSpec(ref);
  if (parsed.kind === 'dir') {
    if (parsed.path.includes(',')) throw new Error(`the directory path contains a comma, which --arms cannot carry: ${parsed.path}`);
    return { id, harness, spec: `${id}=dir:${path.resolve(parsed.path)}`, parsed };
  }
  return { id, harness, spec: ref, parsed };
}

function checkArmReachable(parsed, repo) {
  if (parsed.kind === 'dir') {
    const p = path.resolve(parsed.path);
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? null : `directory not found: ${p}`;
  }
  try { resolveRef(repo, parsed.ref); return null; } catch (e) { return e.message; }
}

function estimateFor({ suite, arms, newIds, replicates, taskCount }) {
  const obs = OBSERVED.suites[suite];
  if (!obs) return { missing: ['every arm (the suite has no observed table)'], reason: `no observed credits for ${suite} for: every arm (the suite has no observed table)` };
  const missing = [];
  const lines = [];
  let perPass = 0;
  let lowerBound = false;
  for (const id of arms) {
    const isNew = newIds.includes(id);
    const key = isNew ? NEW_ARM_PROXY : id;
    const credits = obs.credits[key];
    if (credits === undefined) { missing.push(isNew ? `${id} (new arm, stands in for ${NEW_ARM_PROXY})` : id); continue; }
    perPass += credits;
    const lb = obs.lowerBound.includes(key);
    lowerBound ||= lb;
    lines.push({ arm: id, basis: isNew ? `assumed like ${NEW_ARM_PROXY}` : 'observed', credits, lowerBound: lb });
  }
  if (missing.length) return { missing, reason: `no observed credits for ${suite} for: ${missing.join(', ')}` };
  const scale = taskCount / obs.tasks;
  const total = perPass * scale * replicates;
  return { total, lowerBound, scale, observedTasks: obs.tasks, taskCount, lines, replicates };
}

/** The Claude Code floor: smoke cost per run times runs. Always a floor; never sets the budget. */
function ccFloorFor({ arms, replicates, taskCount }) {
  const f = OBSERVED.claudeCode.perRunFloorUsd;
  const lines = arms.map((id) => {
    const perRun = id === CC_BASE ? f.vanilla : f.konductor;
    return { arm: id, perRun, usd: perRun * taskCount * replicates, basis: id === CC_BASE ? 'smoke, vanilla' : 'smoke, konductor' };
  });
  return { total: lines.reduce((n, l) => n + l.usd, 0), lines, replicates, taskCount, floor: true };
}

function outNameOf(ids, suite, now) {
  let name = ids.join('_');
  if (name.length > OUT_NAME_MAX) name = `${name.slice(0, OUT_NAME_MAX).replace(/[_.-]+$/, '')}-and-more`;
  return `${name}-${suite}-${stamp(now)}`;
}

/**
 * The plan for benchmarking one or more refs (each name=ref or name=dir:path; cc-name=... for Claude Code) against
 * `base`, as data plus printable text. Kiro CLI arms and Claude Code arms run as separate `bench.js run`s, since one run
 * holds one harness. Throws when an arm spec is wrong, when the suite has no observed credits for a Kiro arm and the
 * caller gave no --budget-credits, and when there are Claude Code arms and no --budget-usd: a budget cap is the only
 * bound on spend, so it is not guessed.
 */
function planPr({
  ref, base = DEFAULT_BASE, suite = 'lite', replicates, noVanilla = false, budgetCredits = null, budgetUsd = null, out = null, seed, benchDir = BENCH_DIR, repoRoot = null, now = new Date(), tmpRoot = os.tmpdir(),
}) {
  if (!SUITE_NAMES.includes(suite)) throw new Error(`--suite ${SUITE_NAMES.join('|')}`);
  const refs = ref === undefined || ref === null ? [] : [].concat(ref);
  if (!refs.length) parseNewArm(undefined);
  const added = refs.map(parseNewArm);
  const ids = added.map((a) => a.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`two --ref arms are named "${dup}"`);
  const baseParsed = parseArmSpec(base);
  if (baseParsed.cc || baseParsed.oc || baseParsed.st) throw new Error(`--base names the Kiro CLI base arm (vanilla, main or a release tag such as ${DEFAULT_BASE}); Claude Code arms are compared with ${CC_BASE}`);
  if (baseParsed.kind === 'dir' || (baseParsed.kind === 'git' && !baseParsed.bare)) throw new Error(`--base takes vanilla, main or a release tag such as ${DEFAULT_BASE}`);
  const kiroNew = added.filter((a) => a.harness === KIRO);
  const ccNew = added.filter((a) => a.harness === CC);
  for (const a of kiroNew) if (a.id === baseParsed.name) throw new Error(`the new arm is named "${a.id}", the same as the base arm`);
  for (const a of ccNew) if (a.id === CC_BASE) throw new Error(`the new arm is named "${a.id}", the same as the Claude Code base arm`);
  if (budgetCredits !== null && !kiroNew.length) throw new Error('--budget-credits applies to Kiro CLI arms, and this plan has none; Claude Code runs take --budget-usd');
  if (budgetUsd !== null && !ccNew.length) throw new Error('--budget-usd applies to Claude Code (cc-) arms, and this plan has none; Kiro CLI runs take --budget-credits');
  if (budgetUsd !== null && !(Number(budgetUsd) > 0)) throw new Error('--budget-usd must be a positive number');
  if (ccNew.length && budgetUsd === null) {
    throw new Error(`there is no measured USD cost for Claude Code on the ${suite} suite, so the cap is not guessed: pass --budget-usd X for the cc- arms (smoke runs on trivial tasks cost about USD ${OBSERVED.claudeCode.perRunFloorUsd.vanilla} vanilla and USD ${OBSERVED.claudeCode.perRunFloorUsd.konductor} with konductor per run, a floor only)`);
  }

  const tasks = loadTasks(benchDir, { extraDirs: suiteExtraDirs(suite, benchDir) });
  const s = loadSuite(suite, tasks, benchDir);
  const reps = replicates === undefined ? s.replicates : Number(replicates);
  if (!Number.isInteger(reps) || reps < 1) throw new Error('--replicates must be an integer >= 1');
  if (baseParsed.name === 'vanilla' && noVanilla) throw new Error('--no-vanilla and --base vanilla contradict each other');
  const taskCount = s.taskIds.length;

  const outName = outNameOf(ids, suite, now);
  const outRoot = out ? path.resolve(out) : path.join(tmpRoot, 'konductor-bench', 'runs', outName);
  const both = kiroNew.length > 0 && ccNew.length > 0;
  const outFor = (h) => (both ? path.join(outRoot, h) : outRoot);
  const seedValue = seed === undefined ? seedOf(added.map((a) => a.spec).join(',')) : Number(seed);
  const repoFlag = repoRoot ? ` --repo-root ${quote(path.resolve(repoRoot))}` : '';
  const bench = 'node bench/runner/bench.js';
  const commandsFor = (specs, dir, budgetFlag, budget, baseId) => ({
    run: `${bench} run --suite ${suite} --arms ${quote(specs.join(','))} --replicates ${reps} --parallel 1 --seed ${seedValue} --${budgetFlag} ${budget} --out ${quote(dir)}${repoFlag}`,
    contrast: `${bench} contrast --run ${quote(dir)} --base ${baseId}`,
    judge: `${bench} judge --run ${quote(dir)} --baseline ${baseId}`,
    report: `${bench} report --run ${quote(dir)} --baseline ${baseId}`,
  });

  const groups = [];
  if (kiroNew.length) {
    const armIds = [...(noVanilla || baseParsed.name === 'vanilla' ? [] : ['vanilla']), baseParsed.name];
    const est = estimateFor({ suite, arms: [...armIds, ...kiroNew.map((a) => a.id)], newIds: kiroNew.map((a) => a.id), replicates: reps, taskCount });
    if (est.missing && budgetCredits === null) {
      throw new Error(`${est.reason}. The runs are not guessed at: pass --budget-credits X to set your own cap, or use a suite with figures for these arms (lite, real).`);
    }
    const estimate = est.missing ? null : est;
    const budget = budgetCredits !== null ? Number(budgetCredits) : Math.ceil(estimate.total * HEADROOM);
    const specs = [...armIds, ...kiroNew.map((a) => a.spec)];
    const dir = outFor(KIRO);
    groups.push({ harness: KIRO, unit: 'credits', base: baseParsed.name, newArms: kiroNew, arms: specs, out: dir, estimate, est, budget, budgetGiven: budgetCredits, commands: commandsFor(specs, dir, 'budget-credits', budget, baseParsed.name) });
  }
  if (ccNew.length) {
    const specs = [CC_BASE, ...ccNew.map((a) => a.spec)];
    const floor = ccFloorFor({ arms: [CC_BASE, ...ccNew.map((a) => a.id)], replicates: reps, taskCount });
    const budget = Number(budgetUsd);
    const dir = outFor(CC);
    groups.push({ harness: CC, unit: 'USD', base: CC_BASE, newArms: ccNew, arms: specs, out: dir, estimate: floor, est: floor, budget, budgetGiven: budget, commands: commandsFor(specs, dir, 'budget-usd', budget, CC_BASE) });
  }

  const warnings = [];
  if (repoRoot) {
    for (const a of added) {
      const problem = checkArmReachable(a.parsed, path.resolve(repoRoot));
      if (problem) warnings.push(`${a.id}: ${problem}`);
    }
  }
  if (noVanilla && ccNew.length) warnings.push(`--no-vanilla drops vanilla from the Kiro CLI run only; the Claude Code run keeps ${CC_BASE} as its base`);
  if (ccNew.length && budgetUsd !== null && Number(budgetUsd) < groups.find((g) => g.harness === CC).estimate.total) {
    warnings.push(`--budget-usd ${budgetUsd} is below the Claude Code floor from the smoke runs; some cells will be skipped`);
  }

  const text = renderPlan({ suite, reps, groups, base: baseParsed.name, warnings, taskCount });
  const first = groups[0];
  return { arms: first.arms, out: first.out, outRoot, seed: seedValue, estimate: first.estimate, budget: first.budget, commands: first.commands, groups: groups.map(({ est, newArms, ...g }) => ({ ...g, newArms: newArms.map((a) => a.id) })), warnings, text };
}

function renderPlan({ suite, reps, groups, base, warnings, taskCount }) {
  const L = [];
  const newIds = groups.flatMap((g) => g.newArms.map((a) => a.id));
  const against = groups.map((g) => g.base).join(' and ');
  L.push(`Plan: ${newIds.join(', ')} against ${against} on the ${suite} suite (${taskCount} task(s), ${reps} replicate${reps === 1 ? '' : 's'}). This prints the plan and runs nothing.`);
  if (groups.length > 1) L.push('Kiro CLI and Claude Code arms run as two separate runs: one run holds one harness, and credits and USD are never added.');
  for (const w of warnings) L.push('', `WARNING: ${w}`);
  let step = 1;
  for (const g of groups) {
    const name = descriptorOf(g.harness).label;
    L.push('', `${name} arms: ${g.arms.join(', ')}`);
    if (g.harness === KIRO) {
      const e = g.estimate;
      if (e) {
        L.push(`Estimate (credits per arm for one pass over the suite, observed on ${OBSERVED.model}, n=1, so a rough guide only):`);
        for (const l of e.lines) L.push(`  ${l.arm.padEnd(10)} ${l.lowerBound ? 'at least ' : ''}${l.credits.toFixed(2)}  (${l.basis})`);
        if (e.scale !== 1) L.push(`  figures were observed on ${e.observedTasks} tasks and the suite has ${e.taskCount}; scaled from ${e.observedTasks} to ${e.taskCount}`);
        L.push(`  total for ${reps} replicate${reps === 1 ? '' : 's'}: ${e.lowerBound ? 'at least ' : ''}${e.total.toFixed(2)} credits; cap ${g.budget} (${HEADROOM}x, rounded up). Judge credits are not included.`);
      } else {
        L.push(`No estimate: ${g.est.reason}. The cap below is the one you gave (${g.budgetGiven}). Judge credits are not included.`);
      }
    } else {
      const e = g.estimate;
      L.push(`Floor (USD, from ${OBSERVED.claudeCode.note}; not a forecast, real tasks cost more):`);
      for (const l of e.lines) L.push(`  ${l.arm.padEnd(10)} at least ${l.usd.toFixed(2)}  (${l.perRun.toFixed(3)} per run, ${l.basis})`);
      L.push(`  floor for ${reps} replicate${reps === 1 ? '' : 's'}: at least ${e.total.toFixed(2)} USD; cap ${g.budget} (the one you gave). Judge cost is not included.`);
      L.push('  Claude Code runs need AWS credentials in the environment and the claude binary (--claude-bin or --claude-tools-dir).');
    }
    L.push('', `${step++}. Run (stops launching new runs at the cap):`, `   ${g.commands.run}`);
    L.push('', `${step++}. Contrast, no ${g.unit === 'USD' ? 'cost' : 'credits'}:`, `   ${g.commands.contrast}`);
    L.push('', `${step++}. Judge (spends ${g.unit === 'USD' ? 'judge cost' : 'credits'}; rubric and pairwise against the base arm):`, `   ${g.commands.judge}`);
    L.push('', `${step++}. Report, no ${g.unit === 'USD' ? 'cost' : 'credits'}:`, `   ${g.commands.report}`);
  }
  L.push('', 'The runner never fetches. If the ref is not local yet, fetch it yourself first, for example: git fetch origin pull/<n>/head:pr-<n>');
  return L.join('\n');
}

module.exports = { planPr, OBSERVED, HEADROOM, quote, stamp, seedOf };
