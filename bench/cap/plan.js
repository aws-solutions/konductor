// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap plan`: prints the commands to measure one capability and an estimate from the observed credit table. Runs nothing.

const os = require('node:os');
const path = require('node:path');
const { OBSERVED, HEADROOM, quote, stamp, seedOf } = require('../runner/lib/pr-plan.js');
const { SUITE_NAMES, loadTasks } = require('../runner/lib/tasks.js');
const { resolveBase } = require('./source.js');
const { scanRepo, loadAgentSpecs } = require('./scan.js');
const { loadRegistry } = require('./registry.js');
const { variantPaths, reachWarning } = require('./variant.js');
const { scoringOf } = require('./captasks.js');
const { split } = require('./reach.js');

const MODES = ['lift', 'trigger', 'improve'];
const OBSERVED_SUITES = ['lite', 'real', 'hard'];
const CEILING = 0.8;
const DEFAULT_ACTING = ['konductor'];

const bench = 'node bench/runner/bench.js';

// The first observed suite a task belongs to; the observed table has credits per suite, not per task.
function observedSuiteOf(task) {
  return OBSERVED_SUITES.find((s) => task.tiers.includes(s)) ?? null;
}

// Prefer the suite whose judges and defaults fit the tasks: one tier they all share, in a fixed order.
function suiteFor(tasks) {
  const order = ['lite', 'hard', 'real', 'autonomy', 'full', 'pilot'];
  const shared = order.filter((s) => SUITE_NAMES.includes(s) && tasks.every((t) => t.tiers.includes(s)));
  return shared[0] ?? tasks[0].tiers.find((s) => SUITE_NAMES.includes(s));
}

function estimate({ tasks, arms, reps }) {
  const missing = [];
  const perArm = [];
  for (const a of arms) {
    let credits = 0;
    let lowerBound = false;
    for (const t of tasks) {
      const suite = observedSuiteOf(t);
      const obs = suite ? OBSERVED.suites[suite] : null;
      const per = obs?.credits[a.key];
      if (per === undefined) { missing.push(`${a.key} in ${suite ? `the ${suite} suite` : `no observed suite (task ${t.id})`}`); continue; }
      credits += per / obs.tasks;
      lowerBound ||= obs.lowerBound.includes(a.key);
    }
    perArm.push({ arm: a.name, basis: a.basis, credits, lowerBound });
  }
  if (missing.length) return { missing, reason: `no observed credits for ${[...new Set(missing)].join(', ')}` };
  return { total: perArm.reduce((n, a) => n + a.credits, 0) * reps, lowerBound: perArm.some((a) => a.lowerBound), lines: perArm, reps };
}

/**
 * The plan as data plus printable text. Throws (the CLI exits 2) for: an unknown capability, mode or task; no tasks;
 * a lift task scored by checks alone (unless allowRegex); a capability the acting agent cannot reach (unless force);
 * and a missing observed figure when the caller gave no budget.
 */
function planCap({
  mode, cap, base = 'v1.2.0', reps, tasks: taskIds = [], budgetCredits = null, repoRoot, benchDir, extraTasks = [], vanilla = false,
  allowRegex = false, force = false, candidate = null, actingAgents = null, agentEngine = 'v2', scratch, seed, now = new Date(), tmpRoot = os.tmpdir(),
}) {
  if (!MODES.includes(mode)) throw new Error('--mode takes lift, trigger or improve');
  if (!cap) throw new Error('--cap is required (for example skill:backend-review)');
  if (mode === 'improve' && !candidate) throw new Error('improve needs --candidate FILE (the edited capability text to measure against the current one)');
  const replicates = reps === undefined ? 3 : Number(reps);
  if (!Number.isInteger(replicates) || replicates < 1) throw new Error('--reps must be an integer >= 1');

  const b = resolveBase(base, repoRoot);
  let reg;
  let acting;
  let specs;
  let tasks;
  try {
    const scan = scanRepo(b.dir);
    if (!scan.has(cap)) throw new Error(`${cap} does not exist at the base ref ${b.label}`);
    specs = loadAgentSpecs(b.dir);
    reg = loadRegistry(benchDir).entries.find((e) => e.data?.id === cap)?.data ?? null;
    tasks = loadTasks(benchDir, { extraDirs: extraTasks });
    acting = actingAgents && actingAgents.length ? actingAgents : reg?.expect?.['kiro-cli']?.actingAgents?.length ? reg.expect['kiro-cli'].actingAgents : DEFAULT_ACTING;
  } finally { b.cleanup(); }
  if (b.kind !== 'git') throw new Error('cap plan needs a git ref as --base (variants are built from git archive)');

  const ids = taskIds.length ? taskIds : mode === 'trigger' ? reg?.tasks.trigger ?? [] : reg?.tasks.lift ?? [];
  if (!ids.length) throw new Error(`no tasks for ${cap}: link them in the registry (tasks.${mode === 'trigger' ? 'trigger' : 'lift'}) or pass --tasks id,id`);
  const picked = ids.map((id) => { const t = tasks.get(id); if (!t) throw new Error(`unknown task "${id}"`); return t; });

  const warnings = [];
  if (mode !== 'trigger') {
    for (const t of picked) {
      if (scoringOf(t) === 'regex-only') {
        if (!allowRegex) throw new Error(`task ${t.id} is scored by checks alone (no hidden tests, no rubric). Regex-only tasks are not accepted for lift (design D5b); pass --allow-regex to override`);
        warnings.push(`task ${t.id} is regex-only (--allow-regex); read its lift with caution and run recheck first`);
      } else if (scoringOf(t) === 'rubric') warnings.push(`task ${t.id} is scored by a judged rubric: run the judge step before reading lift`);
      const h = reg?.tasks.headroom?.[t.id];
      if (!h) warnings.push(`no recorded headroom for ${t.id}: run a calibration pass (the without arm, 3 reps) first, or lift may sit at the ceiling`);
      else if (h.vanillaPass > CEILING) warnings.push(`${t.id} is at the ceiling (vanilla pass ${h.vanillaPass} > ${CEILING}): exclude it from lift, use it for non-inferiority only`);
    }
  }

  const refName = base === 'main' ? 'origin/main' : b.ref;
  const variantOps = mode === 'improve'
    ? { replace: [`${cap}=${path.resolve(candidate)}`] }
    : mode === 'lift' ? { drop: [cap] } : null;
  if (variantOps) {
    const ops = variantOps.drop ? [{ op: 'drop', id: cap }] : [{ op: 'replace', id: cap }];
    const w = reachWarning({ ops, specs, actingAgents: acting });
    if (w) {
      if (!force) throw new Error(`${w}. Pass --force to plan it anyway`);
      warnings.push(`${w} (--force)`);
    }
  }

  const scratchDir = scratch ?? path.join(tmpRoot, 'konductor-bench');
  const vp = variantOps ? variantPaths({ repo: repoRoot, base, ...variantOps, scratch: scratchDir, agentEngine }) : null;

  const arms = [
    ...(vanilla ? [{ name: 'vanilla', spec: 'vanilla', key: 'vanilla', basis: 'observed' }] : []),
    { name: 'base', spec: `base=${refName}`, key: base, basis: 'observed' },
    ...(variantOps ? [{ name: 'base-b', spec: `base-b=${refName}`, key: base, basis: 'A/A sentinel, same ref' }, { name: vp.armName, spec: vp.armSpec, key: base, basis: `assumed like ${base}` }] : []),
  ];
  const est = estimate({ tasks: picked, arms, reps: replicates });
  if (est.missing && budgetCredits === null) {
    throw new Error(`${est.reason}. The runs are not guessed at: pass --budget-credits X to set your own cap`);
  }
  const estimateOut = est.missing ? null : est;
  const budget = budgetCredits !== null ? Number(budgetCredits) : Math.ceil(est.total * HEADROOM);

  const suite = suiteFor(picked);
  const stampName = `cap-${mode}-${split(cap)[1]}-${stamp(now)}`;
  const out = path.join(tmpRoot, 'konductor-bench', 'runs', stampName);
  const seedValue = seed === undefined ? seedOf(`${cap}:${mode}`) : Number(seed);
  const extraFlag = extraTasks.length ? ` --extra-tasks ${quote(extraTasks.map((d) => path.resolve(d)).join(','))}` : '';
  const benchFlag = ` --bench-dir ${quote(path.resolve(benchDir))}`;
  const repoFlag = ` --repo-root ${quote(path.resolve(repoRoot))}`;
  const engineFlag = agentEngine === 'v2' ? '' : ` --agent-engine ${agentEngine}`;
  const commands = {};
  if (vp) {
    const opFlags = variantOps.drop ? `--drop ${cap}` : `--replace ${cap}=${quote(path.resolve(candidate))}`;
    commands.variant = `${bench} cap variant --base ${base} ${opFlags} --scratch ${quote(scratchDir)}${engineFlag}${repoFlag}${benchFlag}`;
  }
  commands.run = `${bench} run --suite ${suite} --arms '${arms.map((a) => a.spec).join(',')}' --tasks ${picked.map((t) => t.id).join(',')} --replicates ${replicates} --parallel 1 --seed ${seedValue} --budget-credits ${budget}${engineFlag} --out ${quote(out)}${repoFlag}${benchFlag}${extraFlag}`;
  if (mode === 'trigger') {
    commands.skills = `${bench} skills --run ${quote(out)}${benchFlag}${repoFlag}`;
  } else {
    commands.contrast = `${bench} contrast --run ${quote(out)} --base base --head ${[vp.armName, 'base-b'].join(',')} --by task${benchFlag}${extraFlag}`;
    commands.judge = `${bench} judge --run ${quote(out)} --baseline base${benchFlag}${extraFlag}`;
    commands.report = `${bench} report --run ${quote(out)} --baseline base${benchFlag}${extraFlag}`;
  }

  const text = render({ mode, cap, base, picked, replicates, arms, warnings, estimateOut, est, budget, budgetCredits, commands, acting, suite });
  return { arms: arms.map((a) => a.spec), out, seed: seedValue, suite, tasks: picked.map((t) => t.id), estimate: estimateOut, budget, commands, warnings, actingAgents: acting, text };
}

function render({ mode, cap, base, picked, replicates, arms, warnings, estimateOut, est, budget, budgetCredits, commands, acting, suite }) {
  const L = [];
  L.push(`Plan: ${mode} of ${cap} against base ${base} on ${picked.length} task(s) (${picked.map((t) => t.id).join(', ')}), ${replicates} replicate${replicates === 1 ? '' : 's'}, acting agent ${acting.join(', ')}, suite ${suite}. This prints the plan and runs nothing.`);
  L.push(`Arms: ${arms.map((a) => a.name).join(', ')}`);
  for (const w of warnings) L.push('', `WARNING: ${w}`);
  L.push('');
  if (estimateOut) {
    L.push(`Estimate (credits per task, scaled from observed per-suite figures on ${OBSERVED.model}, n=1, a rough guide only):`);
    for (const l of estimateOut.lines) L.push(`  ${l.arm.padEnd(10)} ${l.lowerBound ? 'at least ' : ''}${l.credits.toFixed(2)} per replicate  (${l.basis})`);
    L.push(`  total for ${replicates} replicate${replicates === 1 ? '' : 's'}: ${estimateOut.lowerBound ? 'at least ' : ''}${estimateOut.total.toFixed(2)} credits; cap ${budget} (${HEADROOM}x, rounded up). Judge credits are not included.`);
  } else {
    L.push(`No estimate: ${est.reason}. The cap below is the one you gave (${budgetCredits}). Judge credits are not included.`);
  }
  let n = 1;
  const step = (title, cmd) => { if (cmd) L.push('', `${n++}. ${title}`, `   ${cmd}`); };
  step('Build the variant (no credits; a scratch HOME is used for every konductor call):', commands.variant);
  step('Run (stops launching new runs at the cap):', commands.run);
  step('Skill loads, no credits:', commands.skills);
  step('Contrast per task, no credits (x-minus vs base, and the A/A sentinel base-b vs base):', commands.contrast);
  step('Judge (spends credits; rubric scoring):', commands.judge);
  step('Report, no credits:', commands.report);
  L.push('', 'A lift or cost difference counts only if it exceeds the base-b vs base spread on the same tasks.');
  return L.join('\n');
}

module.exports = { planCap, MODES };
