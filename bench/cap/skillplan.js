// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap skill-plan`: which skills get which study, on which tasks, with how many runs and an estimate from observed
// per-run credits. Free: it reads the base ref and finished run directories and runs nothing.
//
// Tiers, in priority order. loaded: the skill loaded in a finished run. large: the named large skills and the biggest
// by size. duplicates: near-duplicate and named pairs. triage: the rest, which get free checks only, because a lift
// study needs the skill to load and a skill nobody loads cannot show lift.

const { buildPruneReport } = require('./prune.js');
const { scanRunDirs } = require('./usage.js');
const { resolveBase } = require('./source.js');
const { scanRepo, loadAgentSpecs } = require('./scan.js');
const { kiroReachers } = require('./reach.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { scoringOf } = require('./captasks.js');
const { loadProfile } = require('../runner/lib/profiles.js');
const { ablationFor } = require('./ablate.js');

const TOOL_VERSION = 'cap-skill-plan/1';
const TIERS = ['loaded', 'large', 'duplicates', 'triage'];
const NEAR_DUPLICATE_MIN = 0.6;
const LARGE_DEFAULT = [
  'dynamodb-design', 'test-coverage-analysis', 'dynamodb-validation', 'cypress-test-implementation', 'infra-validation', 'e2e-test-strategy',
  'iam-policy-design', 'humanize-writing', 'policy-validation', 'delegation-protocol', 'legacy-to-agentic-estimate', 'progress-tracking',
];
const DUPLICATE_PAIRS_DEFAULT = [['cmux-dispatch', 'mux-dispatch'], ['asana-sprint-planning', 'sprint-planning'], ['backend-review', 'frontend-review']];
// Our own figures, printed in the plan: the share of skills whose delete screen says "needed" (so sections are tested),
// and the share of those where a section removal lost quality (so moves are tested). Replace them with measured shares.
const WAVE2_SHARE = 0.7;
const WAVE3_SHARE = 0.35;
// From the judging runbook's per-cell estimate (about USD 7 for 125 runs), an inferred figure.
const JUDGE_USD_PER_RUN = 0.056;

const pctile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Credits and wall clock per run from finished non-vanilla runs. A run without credits (a timeout) is counted as censored and left out. */
function observedCosts(runs, { model = null, coordinator = false } = {}) {
  let rs = runs;
  if (model) rs = rs.filter((r) => r.model === model);
  const censored = rs.filter((r) => r.credits === null).length;
  let pool = rs.filter((r) => r.credits !== null);
  if (coordinator) {
    const c = pool.filter((r) => r.armConfig?.orchestration?.mode === 'coordinator');
    if (c.length) pool = c;
  }
  if (!pool.length) return { n: 0, censored, credits: null, secMid: null };
  const sorted = pool.map((r) => r.credits).sort((a, b) => a - b);
  const walls = pool.filter((r) => r.wallClockMs !== null).map((r) => r.wallClockMs / 1000);
  return { n: pool.length, censored, credits: { low: pctile(sorted, 0.25), mid: mean(sorted), high: pctile(sorted, 0.9) }, secMid: walls.length ? mean(walls) : null };
}

/** Adds { tier, also, reasons } to each { id, name, bytes, loaded, neighbours }. A skill keeps the first tier it qualifies for. */
function assignTiers(skills, { largeNames = LARGE_DEFAULT, largeTop = 12, duplicatePairs = DUPLICATE_PAIRS_DEFAULT } = {}) {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const large = new Set(largeNames.filter((n) => byName.has(n)));
  [...skills].sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1)).slice(0, largeTop).forEach((s) => large.add(s.name));
  const dup = new Set();
  for (const [a, b] of duplicatePairs) { if (byName.has(a) && byName.has(b)) { dup.add(a); dup.add(b); } }
  const ids = new Set(skills.map((s) => s.id));
  for (const s of skills) {
    const near = (s.neighbours ?? [])[0];
    if (near && near.score > NEAR_DUPLICATE_MIN && ids.has(near.id)) { dup.add(s.name); dup.add(near.id.slice(near.id.indexOf(':') + 1)); }
  }
  return skills.map((s) => {
    const member = { loaded: s.loaded > 0, large: large.has(s.name), duplicates: dup.has(s.name) };
    const tier = TIERS.find((t) => member[t]) ?? 'triage';
    const reasons = { loaded: `loaded in ${s.loaded} finished run(s)`, large: 'a named large skill or among the largest by size', duplicates: 'a near-duplicate or named pair candidate', triage: 'not loaded, not large, not a duplicate candidate' };
    return { id: s.id, name: s.name, tier, also: TIERS.filter((t) => t !== tier && member[t]), reasons: [reasons[tier]] };
  });
}

const addCosts = (parts) => {
  if (parts.some((p) => p.credits.mid === null)) {
    return { runs: parts.reduce((n, p) => n + p.runs, 0), credits: { low: null, mid: null, high: null }, judgeUsd: parts.reduce((n, p) => n + p.judgeUsd, 0), wallHours: null };
  }
  const sum = (f) => parts.reduce((n, p) => n + f(p), 0);
  return {
    runs: sum((p) => p.runs), credits: { low: sum((p) => p.credits.low), mid: sum((p) => p.credits.mid), high: sum((p) => p.credits.high) },
    judgeUsd: sum((p) => p.judgeUsd), wallHours: parts.some((p) => p.wallHours === null) ? null : sum((p) => p.wallHours),
  };
};
const weighted = (c, w) => ({ runs: c.runs * w, credits: { low: c.credits.low === null ? null : c.credits.low * w, mid: c.credits.mid === null ? null : c.credits.mid * w, high: c.credits.high === null ? null : c.credits.high * w }, judgeUsd: c.judgeUsd * w, wallHours: c.wallHours === null ? null : c.wallHours * w });
const zeroCost = () => ({ runs: 0, credits: { low: 0, mid: 0, high: 0 }, judgeUsd: 0, wallHours: 0 });

function pickTasks({ name, linked, tasks, tasksLoaded, target, allowRegex }) {
  const byTarget = [...tasks.values()].filter((t) => t.target === name).map((t) => t.id).sort();
  const loaded = Object.entries(tasksLoaded).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
  const sources = { linked: [], target: [], loaded: [] };
  const chosen = [];
  const skippedRegexOnly = [];
  const skippedReal = [];
  const take = (ids, key) => {
    for (const id of ids) {
      const t = tasks.get(id);
      if (!t || chosen.includes(id)) continue;
      if (t.real) { if (!skippedReal.includes(id)) skippedReal.push(id); continue; }
      if (scoringOf(t) === 'regex-only' && !allowRegex) { if (!skippedRegexOnly.includes(id)) skippedRegexOnly.push(id); continue; }
      sources[key].push(id);
      if (chosen.length < target) chosen.push(id);
    }
  };
  take(linked, 'linked');
  take(byTarget, 'target');
  take(loaded, 'loaded');
  return { chosen, sources, skippedRegexOnly, skippedReal };
}

const slugId = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

/**
 * Skills that enter through the same agent and config share one run: a control, its A/A repeat and one delete arm per skill.
 * The tasks are the most common ones across the members, at most `screenTasks`. A skill alone at its entry is not screened.
 */
function buildScreens({ recs, tasks, repsN, scale, screenTasks }) {
  const groups = new Map();
  for (const r of recs) {
    if (!r.lift || !r.tasks?.chosen.length) continue;
    const key = `${r.reach.armAgent ?? 'konductor'}|${r.reach.armConfig ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const freq = new Map();
    for (const m of members) for (const t of m.tasks.chosen) freq.set(t, (freq.get(t) ?? 0) + 1);
    const ids = [...freq].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, screenTasks).map(([t]) => t);
    const arms = ['ctl', 'ctl-b', ...members.map((m) => `del-${m.name}`)];
    const judged = ids.filter((t) => tasks.has(t) && scoringOf(tasks.get(t)) !== 'hidden').length / Math.max(1, ids.length);
    const sc = { id: `screen-${slugId(key.split('|')[0])}`, entry: { armAgent: members[0].reach.armAgent, armConfig: members[0].reach.armConfig }, skills: members.map((m) => m.name), tasks: ids, arms, ...scale(arms.length * ids.length * repsN, judged), judged };
    for (const m of members) { m.screen = sc.id; m.warnings.push(`wave 1 is the shared ${sc.id} run on ${ids.join(', ')}; the skill's own tasks are used from wave 2 on`); }
    out.push(sc);
  }
  return out;
}

/**
 * The plan as data. Throws for an unknown tier or skill. `runDirs` are finished run directories (read only).
 * Cost: `creditsPerRun` ({low,mid,high}) wins over the observed figures; with neither, credits are null.
 */
function planSkillStudy({
  repo, base = 'v1.2.0', benchDir, runDirs = [], extraTasks = [], tiers = ['all'], skills = null, profile = null, tasksPerSkill, reps, maxSections = 3,
  largeNames = LARGE_DEFAULT, largeTop = 12, duplicatePairs = DUPLICATE_PAIRS_DEFAULT, model = 'claude-sonnet-5.5', agentEngine = 'v3',
  armConfig = null, creditsPerRun = null, secPerRun = null, judgeUsdPerRun = JUDGE_USD_PER_RUN, wave2Share = WAVE2_SHARE, wave3Share = WAVE3_SHARE,
  allowRegex = false, budgetCredits = null, minSectionBytes, screen = false, screenTasks = 5, now = new Date(),
}) {
  for (const t of tiers) if (t !== 'all' && !TIERS.includes(t)) throw new Error(`--tier takes ${TIERS.join(', ')} or all (got "${t}")`);
  const prof = profile ?? loadProfile('detailed');
  const target = tasksPerSkill ?? prof.scenariosPerSkill.min;
  const repsN = reps ?? prof.replicates.default;
  const wanted = tiers.includes('all') ? TIERS : tiers;

  const report = buildPruneReport({ repo, base, harness: 'kiro-cli', benchDir, runDirs, evidence: null, now });
  const scan = scanRunDirs(runDirs, { harnesses: ['kiro-cli'] });
  const obs = observedCosts(scan.runs, { model, coordinator: Boolean(armConfig) });
  const tasks = loadTasks(benchDir, { extraDirs: extraTasks });

  const b = resolveBase(base, repo);
  let texts;
  let specs;
  try {
    const sc = scanRepo(b.dir);
    texts = new Map([...sc.values()].filter((c) => c.kind === 'skill').map((c) => [c.name, c.text]));
    specs = loadAgentSpecs(b.dir);
  } finally { b.cleanup(); }

  const caps = report.capabilities;
  const names = new Set(caps.map((c) => c.name));
  for (const n of skills ?? []) if (!names.has(n.replace(/^skill:/, ''))) throw new Error(`unknown skill "${n}" at ${report.base.label}`);

  const tasksLoadedBy = new Map();
  for (const run of scan.runs) {
    for (const l of Object.values(run.loads)) {
      const m = tasksLoadedBy.get(l.name.toLowerCase()) ?? {};
      m[run.task] = (m[run.task] ?? 0) + 1;
      tasksLoadedBy.set(l.name.toLowerCase(), m);
    }
  }

  const per = (c) => c.harnesses['kiro-cli'];
  const tiering = assignTiers(caps.map((c) => ({ id: c.id, name: c.name, bytes: c.bytes, loaded: per(c).loads.runsLoaded, neighbours: c.neighbours })), { largeNames, largeTop, duplicatePairs });
  const tierOf = new Map(tiering.map((t) => [t.id, t]));

  const credits = creditsPerRun ?? obs.credits;
  const sec = secPerRun ?? obs.secMid;
  const scale = (runs, judged) => ({
    runs, credits: credits ? { low: runs * credits.low, mid: runs * credits.mid, high: runs * credits.high } : { low: null, mid: null, high: null },
    judgeUsd: runs * judged * judgeUsdPerRun, wallHours: sec === null || sec === undefined ? null : (runs * sec) / 3600,
  });

  const picked = new Set((skills ?? []).map((n) => n.replace(/^skill:/, '')));
  const out = [];
  for (const cap of caps) {
    if (picked.size && !picked.has(cap.name)) continue;
    const t = tierOf.get(cap.id);
    if (!wanted.includes(t.tier)) continue;
    const u = per(cap);
    const agents = kiroReachers(cap.id, specs);
    const acting = agents.includes('konductor') ? 'konductor' : agents[0] ?? null;
    const armAgent = acting && acting !== 'konductor' ? acting : null;
    const rec = {
      id: cap.id, name: cap.name, tier: t.tier, also: t.also, reasons: t.reasons, bytes: cap.bytes, estTokens: cap.estTokens, staticClass: u.classification.class,
      exposure: { exposed: u.exposure.runs, runsLoaded: u.loads.runsLoaded, loads: u.loads.total, rate: u.loads.rate },
      tasksLoaded: tasksLoadedBy.get(cap.name.toLowerCase()) ?? {},
      reach: { agents, acting, armAgent, armConfig: armAgent ? null : armConfig },
      lift: false, why: '', tasks: null, sections: [], variants: [], waves: [], steps: [], warnings: [],
      cost: { expected: zeroCost(), worst: zeroCost() },
    };
    out.push(rec);

    if (!acting) { rec.why = `no kiro agent lists it, so the harness cannot load it (prune-report class ${rec.staticClass}); a lift study has nothing to measure`; continue; }
    if (t.tier === 'triage') {
      rec.why = 'triage tier: not loaded in the supplied runs, not among the largest skills and not a duplicate candidate. It gets the free audit and a trigger check, not a lift run: a lift study needs the skill to load, and a skill nobody loads cannot show lift';
      rec.steps = [
        `node bench/runner/bench.js cap audit --cap ${cap.id} --base ${base}`,
        `node bench/runner/bench.js cap trigger --cap ${cap.id} --mode proxy --base ${base}   (needs queries: cap draft first; about 0.8 credits to draft, about 0.09 per proxy call)`,
        `node bench/runner/bench.js cap scenarios --cap ${cap.id} --mode trigger --base ${base} --dry-run   (tasks that should load it and near misses that should not; review them, then drop --dry-run for one model call)`,
      ];
      continue;
    }

    rec.lift = true;
    const pk = pickTasks({ name: cap.name, linked: cap.linkedTasks ?? [], tasks, tasksLoaded: rec.tasksLoaded, target, allowRegex });
    const shortfall = Math.max(0, target - pk.chosen.length);
    rec.tasks = {
      chosen: pk.chosen, target, shortfall, sources: pk.sources, skippedRegexOnly: pk.skippedRegexOnly, skippedReal: pk.skippedReal,
      scenarioCommand: shortfall ? `node bench/runner/bench.js cap scenarios --cap ${cap.id} --n ${shortfall} --base ${base}` : null,
    };
    if (shortfall) rec.warnings.push(`${shortfall} more scenario${shortfall === 1 ? '' : 's'} needed (profile ${prof.name} wants ${target} per skill): draft them with cap scenarios, review, add them as tasks`);
    if (pk.skippedRegexOnly.length) rec.warnings.push(`left out regex-only tasks: ${pk.skippedRegexOnly.join(', ')}`);
    if (pk.skippedReal.length) rec.warnings.push(`left out real-repo tasks (they need a repo cache the study does not pass): ${pk.skippedReal.join(', ')}`);
    if (!rec.exposure.runsLoaded) rec.warnings.push('never loaded in the supplied runs: if the study tasks do not make the agent load it, the result is NEEDS DATA, not a delete; draft tasks that should load it with cap scenarios --mode trigger, and add --forced-load low-load to the study to see what it does once loaded (reported apart, never a call)');
    const judged = (pk.chosen.filter((id) => scoringOf(tasks.get(id)) !== 'hidden').length + shortfall) / Math.max(1, target);

    const text = texts.get(cap.name) ?? '';
    const ablation = t.tier === 'duplicates' ? { candidates: [], variants: [] } : ablationFor({ name: cap.name, text, max: maxSections, minBytes: minSectionBytes });
    rec.sections = ablation.candidates.map((s) => ({ id: s.id, title: s.title, level: s.level, kind: s.kind, startLine: s.startLine, endLine: s.endLine, bytes: s.bytes, estTokens: s.estTokens }));
    rec.variants = ablation.variants.filter((v) => v.kind !== 'control').map((v) => ({ id: v.id, kind: v.kind, section: v.section?.id ?? null, range: v.range ?? null, tokensSaved: v.tokensSaved ?? cap.estTokens }));

    const wave = (n, arms, conditional, condition, share) => {
      const runs = arms.length * target * repsN;
      return { wave: n, arms, conditional, condition, share, ...scale(runs, judged), judged: judged };
    };
    rec.waves.push(wave(1, ['ctl', 'ctl-b', 'del'], false, null, 1));
    if (rec.sections.length) {
      const k = rec.sections.length;
      rec.waves.push(wave(2, ['ctl', 'ctl-b', ...rec.sections.map((_, i) => `rm${i + 1}`)], true, 'runs only if the delete variant lost quality (the skill is needed); this wave then tests each section removal', wave2Share));
      rec.waves.push(wave(3, ['ctl', 'ctl-b', ...Array.from({ length: k }, (_, i) => `mv${i + 1}`)], true, 'runs only for sections whose removal lost quality; the move arms are narrowed to those at run time', wave3Share));
    }
    const part = (w) => ({ runs: w.runs, credits: w.credits, judgeUsd: w.judgeUsd, wallHours: w.wallHours });
    rec.cost.worst = addCosts(rec.waves.map(part));
    rec.cost.expected = addCosts(rec.waves.map((w) => weighted(part(w), w.share)));
  }

  const screens = screen ? buildScreens({ recs: out, tasks, repsN, scale, screenTasks }) : [];
  const part = (w) => ({ runs: w.runs, credits: w.credits, judgeUsd: w.judgeUsd, wallHours: w.wallHours });
  for (const sc of screens) {
    for (const m of out.filter((x) => x.screen === sc.id)) {
      m.waves[0] = { wave: 1, shared: sc.id, arms: ['ctl', 'ctl-b', 'del'], conditional: false, condition: null, share: 1, ...scale(0, 0) };
      m.cost.worst = addCosts(m.waves.map(part));
      m.cost.expected = addCosts(m.waves.map((w) => weighted(part(w), w.share)));
    }
  }

  const order = (a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.exposure.runsLoaded - a.exposure.runsLoaded || b.bytes - a.bytes || (a.name < b.name ? -1 : 1);
  out.sort(order);
  const fitted = budgetCredits === null ? out.map((s) => ({ ...s, inBudget: true })) : fitBudget(out, budgetCredits);

  const tierSummary = Object.fromEntries(TIERS.map((tn) => {
    const members = fitted.filter((s) => s.tier === tn);
    const waveParts = (n) => members.flatMap((s) => s.waves.filter((w) => w.wave === n).map((w) => ({ runs: w.runs, credits: w.credits, judgeUsd: w.judgeUsd, wallHours: w.wallHours })));
    const waves = Object.fromEntries([1, 2, 3].map((n) => [n, addCosts(waveParts(n))]));
    return [tn, { skills: members.map((s) => s.id), expected: addCosts(members.map((s) => s.cost.expected)), worst: addCosts(members.map((s) => s.cost.worst)), waves }];
  }));
  const lift = fitted.filter((s) => s.lift);
  const totals = {
    liftSkills: lift.length, triageSkills: fitted.filter((s) => !s.lift).length,
    expected: addCosts([...fitted.map((s) => s.cost.expected), ...screens.map(part)]), worst: addCosts([...fitted.map((s) => s.cost.worst), ...screens.map(part)]),
    inBudget: budgetCredits === null ? null : addCosts(fitted.filter((s) => s.inBudget).map((s) => s.cost.expected)),
  };

  const assumptions = [
    credits ? (creditsPerRun ? `credits per run given: low ${credits.low}, mid ${credits.mid}, high ${credits.high}` : `credits per run observed in ${obs.n} finished runs (model ${model}${armConfig ? ', coordinator mode where present' : ''}): low ${credits.low.toFixed(2)} (p25), mid ${credits.mid.toFixed(2)} (mean), high ${credits.high.toFixed(2)} (p90); ${obs.censored} timed-out run(s) had no credits and are left out, so the figures lean low`)
      : 'no observed runs and no --credits-per-run: credits are not estimated',
    `${target} tasks per skill, ${repsN} replicates per cell, parallel 1; waves rerun ctl and ctl-b so drift between waves is measured`,
    `wave 2 runs for ${Math.round(wave2Share * 100)}% of skills and wave 3 for ${Math.round(wave3Share * 100)}% (our own assumptions, replace them with measured shares); the worst case runs every wave`,
    `judge cost USD ${judgeUsdPerRun} per judged run (inferred from the judging runbook estimate), applied to the share of runs on rubric-scored tasks`,
    sec ? `wall clock ${Math.round(sec)} s per run (observed mean), sequential` : 'wall clock not estimated (no observed runs)',
  ];

  return {
    schemaVersion: 1, toolVersion: TOOL_VERSION, createdAt: now.toISOString(), base: report.base, engine: agentEngine, model, armConfig,
    profile: { name: prof.name, reps: repsN, tasksPerSkill: target, maxSections, minSectionBytes: minSectionBytes ?? null }, assumptions,
    observed: { n: obs.n, censored: obs.censored, credits: obs.credits, secMid: obs.secMid, runDirs: report.inputs.runDirs.map((d) => d.dir) },
    tiers: tierSummary, screens, skills: fitted, totals, budgetCredits,
  };
}

/** Marks each skill inBudget in the given order: a lift skill fits if the running expected credits stay within the budget. Skills with no cost always fit. */
function fitBudget(skills, budget) {
  let used = 0;
  return skills.map((s) => {
    const c = s.cost.expected.credits.mid;
    if (!s.lift || c === 0) return { ...s, inBudget: true };
    if (c === null) return { ...s, inBudget: false };
    if (used + c <= budget) { used += c; return { ...s, inBudget: true }; }
    return { ...s, inBudget: false };
  });
}

// ---- markdown ----

const num = (v, d = 0) => (v === null || v === undefined ? 'n/a' : Number(v).toFixed(d));
const range = (c) => (c.mid === null ? 'n/a' : `${num(c.low)} to ${num(c.high)} (mid ${num(c.mid)})`);
const cellText = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const tableMd = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cellText).join(' | ')} |`)].join('\n');

/** The plan as markdown. Every cost figure is an estimate and says so. */
function renderPlan(plan) {
  const L = ['# Per-skill study plan', ''];
  L.push(`Base ${plan.base.label}; profile ${plan.profile.name} (${plan.profile.reps} replicates, ${plan.profile.tasksPerSkill} tasks per skill); model ${plan.model}; engine ${plan.engine}${plan.armConfig ? `; arm config ${plan.armConfig}` : ''}; created ${plan.createdAt}.`, '');
  L.push('All credit, wall-clock and judge figures below are estimates from observed per-run figures and the stated assumptions. Nothing has been run.', '');
  L.push('## Tiers', '');
  L.push(tableMd(['tier', 'skills', 'wave 1 runs', 'expected runs', 'expected credits (estimate)', 'worst case credits (estimate)', 'judge USD (estimate)', 'wall hours (estimate)'],
    TIERS.map((t) => { const x = plan.tiers[t]; return [t, x.skills.length, x.waves[1].runs, x.expected.runs, range(x.expected.credits), range(x.worst.credits), num(x.expected.judgeUsd, 1), num(x.expected.wallHours, 1)]; })), '');
  L.push(`Total expected: ${plan.totals.expected.runs} runs, ${range(plan.totals.expected.credits)} credits, judge USD ${num(plan.totals.expected.judgeUsd, 1)}, ${num(plan.totals.expected.wallHours, 1)} hours. Worst case (every wave for every skill): ${plan.totals.worst.runs} runs, ${range(plan.totals.worst.credits)} credits.`);
  if (plan.totals.inBudget) L.push(`Within the ${plan.budgetCredits} credit budget (skills taken in tier order): ${range(plan.totals.inBudget.credits)} credits expected; ${plan.skills.filter((s) => s.lift && !s.inBudget).length} lift skills deferred.`);
  L.push('', '## Why not every skill gets a lift study', '');
  L.push('A lift study needs the skill to load and tasks that need it. Most skills never load in the runs on file, so a with-versus-without comparison would measure nothing, and each skill study costs hundreds of credits at the detailed profile (control, A/A and several variants over the profile minimum of tasks and replicates). The triage tier therefore gets the free audit, the load data and, where queries exist, a trigger check; a skill moves up a tier when it loads or when a task is written that needs it.', '');
  L.push('## Skills with a lift study', '');
  const lift = plan.skills.filter((s) => s.lift);
  L.push(lift.length ? tableMd(['skill', 'tier', 'KB', 'loaded / exposed runs', 'tasks (have/target)', 'sections', 'entry', 'expected credits (estimate)', 'worst case', 'in budget'],
    lift.map((s) => [s.name, s.tier, (s.bytes / 1024).toFixed(1), `${s.exposure.runsLoaded} / ${s.exposure.exposed}`, `${s.tasks.chosen.length}/${s.tasks.target}`, s.sections.map((x) => x.id).join(', ') || '-', s.reach.armAgent ?? s.reach.acting, range(s.cost.expected.credits), range(s.cost.worst.credits), s.inBudget === false ? 'no' : 'yes'])) : 'none.', '');
  const warn = lift.filter((s) => s.warnings.length);
  if (warn.length) { L.push('Warnings:', ''); for (const s of warn) L.push(`- ${s.name}: ${s.warnings.join('; ')}`); L.push(''); }
  const triage = plan.skills.filter((s) => !s.lift);
  L.push('## Triage (free checks only)', '', `${triage.length} skills: ${triage.map((s) => s.name).join(', ') || 'none'}.`, '');
  L.push('## Assumptions', '', ...plan.assumptions.map((a) => `- ${a}`), '');
  return L.join('\n');
}

module.exports = { planSkillStudy, renderPlan, pickTasks, observedCosts, assignTiers, fitBudget, TIERS, LARGE_DEFAULT, DUPLICATE_PAIRS_DEFAULT, WAVE2_SHARE, WAVE3_SHARE, JUDGE_USD_PER_RUN, TOOL_VERSION };
