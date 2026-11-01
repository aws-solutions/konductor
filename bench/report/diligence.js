// SPDX-License-Identifier: Apache-2.0
'use strict';

// The diligence scorecard: one row per criterion with PASS, WARN, FAIL or N/A, the measured value and the threshold,
// and an overall rating. Unknown data is WARN ("not recorded"), never PASS. `collectFacts` reads a run; `evaluate`
// turns plain facts into criteria, so every rule can be tested at its boundary without a run on disk.

const { modelFamily } = require('../judge/config.js');
const { MIN_RECALL } = require('../runner/lib/contamination.js');
const { qualityOfRun, DEFAULT_WEIGHTS } = require('./scores.js');
const { checksRevision } = require('../runner/lib/recheck.js');

const THRESHOLDS = {
  replicatesPass: 3, replicatesFail: 2,
  familiesMin: 3,
  withinOneMin: 0.9, exactMin: 0.6, withinOneFail: 0.75,
  kappaMin: 0.6,
  headroomShare: 0.25, ceiling: 95,
  failureShareFail: 0.2,
  coverageFail: 0.9,
  aaCostRel: 0.15, aaQualityPts: 5, sameDayHours: 24,
};

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v) => `${Math.round(v * 100)}%`;
const ORDINAL = { pass: 2, partial: 1, fail: 0 };

const C = (id, label, key, status, value, threshold, note = '') => ({ id, label, key, status, value, threshold, note });
const unknown = (id, label, key, threshold, what = 'not recorded') => C(id, label, key, 'WARN', what, threshold);

// ---- facts from a loaded run ----

function agreementOf(records) {
  const by = new Map();
  for (const r of records) {
    if (r.judgeError || !Array.isArray(r.criteria)) continue;
    const k = `${r.armId}|${r.taskId}|${r.replicate}`;
    by.set(k, [...(by.get(k) || []), r]);
  }
  let total = 0; let exact = 0; let within = 0;
  for (const recs of by.values()) {
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const b = new Map(recs[j].criteria.map((c) => [c.id, ORDINAL[c.verdictRaw ?? c.verdict]]));
        for (const c of recs[i].criteria) {
          const x = ORDINAL[c.verdictRaw ?? c.verdict];
          const y = b.get(c.id);
          if (x === undefined || y === undefined) continue;
          total++;
          if (x === y) exact++;
          if (Math.abs(x - y) <= 1) within++;
        }
      }
    }
  }
  return total ? { pairs: total, exact: exact / total, withinOne: within / total } : null;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function armQuality(rows, weights) {
  const s = rows.filter((r) => r.outcome !== 'infraError' && r.outcome !== 'modelMismatch').map((r) => qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights)).filter(Boolean).map((q) => q.score);
  return mean(s);
}

/** Everything `evaluate` needs, read from a loaded run, its rows and tasks. calibration: { kappa } or null. */
function collectFacts({ run, tasks, rows, ctx, report, skipped = 0, baseline, weights = DEFAULT_WEIGHTS, calibration = null }) {
  const arms = [...new Set(rows.map((r) => r.arm))];
  const cfgs = (run.configs || [{ dir: run.dir, config: run.config }]).map((x) => x.config || {});
  const cfg = cfgs[0] || {};
  const j = run.judgments;
  const judges = j?.judges || [];
  const taskIds = [...new Set(rows.map((r) => r.task))];

  const cells = new Map();
  for (const r of rows) cells.set(`${r.arm}/${r.task}`, (cells.get(`${r.arm}/${r.task}`) || 0) + 1);
  const minCell = [...cells.entries()].sort((a, b) => a[1] - b[1])[0];

  const identity = new Map();
  for (const r of rows) if (r.commitSha || r.contentHash) identity.set(r.arm, `${r.commitSha}|${r.contentHash}|${JSON.stringify(r.armConfig ?? null)}`);
  const groups = new Map();
  for (const [arm, id] of identity) groups.set(id, [...(groups.get(id) || []), arm]);
  const aaPairs = [...groups.values()].filter((g) => g.length > 1);
  const sameRefRepeat = Boolean(run.merged) && run.runs.some((e) => e.sourceReplicate !== undefined && e.sourceReplicate !== e.replicate);
  let aa = null;
  if (aaPairs.length) {
    const [a, b] = aaPairs[0];
    const ra = rows.filter((r) => r.arm === a); const rb = rows.filter((r) => r.arm === b);
    const qa = armQuality(ra, weights); const qb = armQuality(rb, weights);
    const per = (rs) => { const g = rs.filter((r) => r.outcome === 'good').length; return g ? rs.reduce((n, r) => n + (finite(r.credits) ? r.credits : 0), 0) / g : null; };
    const ca = per(ra); const cb = per(rb);
    const others = arms.filter((x) => x !== baseline && !aaPairs[0].includes(x));
    const baseRows = rows.filter((r) => r.arm === baseline);
    const deltas = others.map((x) => {
      const rx = rows.filter((r) => r.arm === x);
      const cq = armQuality(rx, weights); const bq = armQuality(baseRows, weights); const cc = per(rx); const bc = per(baseRows);
      return { arm: x, quality: cq !== null && bq !== null ? Math.abs(cq - bq) : null, cost: cc !== null && bc ? Math.abs(cc - bc) / bc : null };
    });
    const t = rows.filter((r) => [a, b].includes(r.arm) && finite(r.startedAt)).map((r) => r.startedAt);
    aa = {
      pair: [a, b], qualitySpread: qa !== null && qb !== null ? Math.abs(qa - qb) : null, costSpread: ca !== null && cb !== null && (ca + cb) > 0 ? Math.abs(ca - cb) / ((ca + cb) / 2) : null,
      largestDelta: { quality: Math.max(0, ...deltas.map((d) => d.quality ?? 0)), cost: Math.max(0, ...deltas.map((d) => d.cost ?? 0)), arms: deltas.length },
      spanHours: t.length > 1 ? (Math.max(...t) - Math.min(...t)) / 3600000 : null,
    };
  }

  const stale = report?.judging?.stale?.length ?? 0;
  const rubricRecs = j ? j.rubric.filter((r) => !ctx.isStale(r)) : [];
  const pairRecs = j ? j.pairwise.filter((r) => !ctx.isStale(r)) : [];
  const needsRubric = (id) => (tasks.get(id)?.rubric || []).length > 0;
  const expected = rows.filter((r) => needsRubric(r.task) && r.outcome !== 'infraError');
  const unjudged = judges.length ? expected.filter((r) => r.judgesUsed < judges.length).map((r) => `${r.arm}/${r.task}#${r.rep}`) : expected.map((r) => `${r.arm}/${r.task}#${r.rep}`);

  const base = rows.filter((r) => r.arm === baseline);
  const ceilingTasks = [];
  const baseTasks = [...new Set(base.map((r) => r.task))];
  for (const t of baseTasks) {
    const q = armQuality(base.filter((r) => r.task === t), weights);
    if (q !== null && q >= THRESHOLDS.ceiling) ceilingTasks.push(t);
  }

  const targets = taskIds.filter((id) => tasks.get(id)?.target);
  const contaminated = rows.filter((r) => r.contamination);
  const flagged = contaminated.filter((r) => (r.contamination.externalFetch || []).length || (r.contamination.fixRecallChars || 0) >= MIN_RECALL);

  const pinOk = (r) => r.outcome !== 'modelMismatch' && ((r.sessionModel && r.sessionModel === (cfg.model || r.model)) || (r.modelNormalized === true && (!cfg.model || !r.sessionModel || r.sessionModel === cfg.model)));
  const capKey = 'budgetCredits' in cfg ? 'budgetCredits' : 'budgetUsd' in cfg ? 'budgetUsd' : null;
  const checkRows = rows.filter((r) => r.checks !== null);
  const revisionOf = (e) => (tasks.get(e.taskId) ? checksRevision(tasks.get(e.taskId)) : null);
  const currentRevision = run.runs.filter((e) => e.result.status !== 'budget_skipped' && Array.isArray(e.result.checks) && e.result.checks.length).filter((e) => e.result.checksRevision && e.result.checksRevision === revisionOf(e)).length;

  return {
    arms, baseline, study: { comparison: arms.length >= 2, capability: targets.length > 0, judged: Boolean(j) },
    replicates: { min: minCell ? minCell[1] : 0, cell: minCell ? minCell[0] : null, cells: cells.size },
    aaArms: aa ? aa.pair : null, sameRefRepeat, aa,
    controls: { positive: taskIds.filter((id) => tasks.get(id)?.control === 'positive').length, negative: taskIds.filter((id) => tasks.get(id)?.control === 'negative').length },
    judging: {
      present: Boolean(j), judges, families: j?.panel?.families ?? [...new Set(judges.map(modelFamily))], claude: judges.filter((x) => ['claude', 'anthropic'].includes(modelFamily(x))),
      expected: expected.length, unjudged, rubricTasks: taskIds.filter(needsRubric).length,
      parseFailures: [...rubricRecs, ...pairRecs].reduce((n, r) => n + (r.parseFailures || 0), 0),
      pairwise: { run: (j?.modes || []).includes('pairwise'), records: pairRecs.length, bothOrders: pairRecs.filter((r) => Array.isArray(r.orderings) && r.orderings.length === 2 && r.orderings.every(Boolean)).length },
      agreement: agreementOf(rubricRecs), truncated: [...rubricRecs, ...pairRecs].filter((r) => (r.truncatedFiles || []).length).length, stale,
    },
    calibration,
    checks: { withChecks: checkRows.length, currentRevision, stale },
    hidden: { tasks: taskIds.length, withHidden: taskIds.filter((t) => rows.some((r) => r.task === t && r.hidden !== null)).length },
    headroom: { tasks: baseTasks.length, ceilingTasks },
    failures: { n: rows.length, timeout: rows.filter((r) => r.outcome === 'timeout').length, error: rows.filter((r) => r.outcome === 'error').length, infraError: rows.filter((r) => r.outcome === 'infraError').length, modelMismatch: rows.filter((r) => r.outcome === 'modelMismatch').length, checksFailed: rows.filter((r) => r.outcome === 'checksFailed').length },
    censored: rows.filter((r) => r.censored).length,
    contamination: contaminated.length ? { audited: contaminated.length, flagged: flagged.length, externalFetch: contaminated.filter((r) => (r.contamination.externalFetch || []).length).length, fixRecall: contaminated.filter((r) => (r.contamination.fixRecallChars || 0) >= MIN_RECALL).length } : null,
    pin: { runs: rows.length, verified: rows.filter(pinOk).length, mismatch: rows.filter((r) => r.outcome === 'modelMismatch').length },
    isolation: { modes: [...new Set(rows.map((r) => r.isolation).filter(Boolean))], unknown: rows.filter((r) => !r.isolation).length, tripwire: rows.filter((r) => r.tripwire).length, runs: rows.length },
    budget: { recorded: capKey !== null, cap: capKey ? (cfgs.every((c) => typeof c[capKey] === 'number') ? cfgs.reduce((n, c) => n + c[capKey], 0) : cfg[capKey]) : null, spent: rows.reduce((n, r) => n + (finite(r.credits) ? r.credits : 0), 0), skipped },
    provenance: provenanceOf(run, cfgs),
    taskValidation: cfg.taskValidation && typeof cfg.taskValidation.ok === 'boolean' ? cfg.taskValidation : null,
    hasDifferentModels: new Set(cfgs.map((c) => c.model).filter(Boolean)).size > 1,
  };
}

function provenanceOf(run, cfgs) {
  const missing = [];
  for (const c of cfgs) {
    if (!c.benchCommit) missing.push('bench commit');
    if (!c.contentHash) missing.push('content hash');
    if (!c.tools || !Object.keys(c.tools).length) missing.push('tool versions');
    const arms = c.arms || [];
    if (!arms.length || arms.some((a) => !a.commitSha && !a.contentHash && !/(^|-)vanilla$/.test(a.id))) missing.push('arm SHAs');
    if (typeof c.benchDirty !== 'boolean') missing.push('dirty flag');
  }
  return { missing: [...new Set(missing)], dirty: cfgs.some((c) => c.benchDirty === true), dirs: cfgs.length };
}

// ---- rules ----

function evaluate(f, t = THRESHOLDS) {
  const out = [];
  const add = (c) => out.push(c);

  const rp = f.replicates.min;
  add(C('replicates', 'Replicates per cell', true, rp >= t.replicatesPass ? 'PASS' : rp >= t.replicatesFail ? 'WARN' : 'FAIL', `min ${rp} per arm and task${f.replicates.cell ? ` (${f.replicates.cell})` : ''}`, `>= ${t.replicatesPass} PASS, ${t.replicatesFail} WARN, fewer FAIL`));

  if (!f.study.comparison) add(C('aa', 'A/A arm or same-ref repeat', true, 'N/A', 'single arm', 'needs two or more arms'));
  else if (f.aaArms || f.sameRefRepeat) add(C('aa', 'A/A arm or same-ref repeat', true, 'PASS', f.aaArms ? `${f.aaArms.join(' and ')} are the same ref` : 'a same-ref repeat from another run directory', 'present'));
  else add(C('aa', 'A/A arm or same-ref repeat', true, 'WARN', 'none: no noise floor', 'present'));

  if (!f.study.capability) add(C('controls', 'Known-answer controls', true, 'N/A', 'not a capability study', 'a positive and a negative control'));
  else if (f.controls.positive > 0 && f.controls.negative > 0) add(C('controls', 'Known-answer controls', true, 'PASS', `${f.controls.positive} positive, ${f.controls.negative} negative`, 'a positive and a negative control'));
  else add(C('controls', 'Known-answer controls', true, 'WARN', `${f.controls.positive} positive, ${f.controls.negative} negative (not recorded)`, 'a positive and a negative control'));

  const jg = f.judging;
  const needsJudging = jg.rubricTasks > 0;
  if (!jg.present && !needsJudging) {
    for (const [id, label] of [['coverage', 'Judge coverage'], ['families', 'Judge families and Claude exclusion'], ['agreement', 'Judge agreement'], ['parse', 'Judge parse failures'], ['orders', 'Both orderings judged'], ['truncation', 'Judge bundle truncation']]) add(C(id, label, id !== 'parse' && id !== 'orders' && id !== 'truncation', 'N/A', 'no rubric task in this run', 'n/a'));
  } else if (!jg.present) {
    add(C('coverage', 'Judge coverage', true, 'WARN', `not judged: ${jg.expected} run(s) have a rubric and no judgments file`, 'every run judged by every judge'));
    for (const [id, label, key] of [['families', 'Judge families and Claude exclusion', true], ['agreement', 'Judge agreement', true], ['parse', 'Judge parse failures', false], ['orders', 'Both orderings judged', false], ['truncation', 'Judge bundle truncation', false]]) add(C(id, label, key, 'N/A', 'not judged', 'n/a'));
  } else {
    const share = jg.expected ? (jg.expected - jg.unjudged.length) / jg.expected : 1;
    add(C('coverage', 'Judge coverage', true, jg.unjudged.length === 0 ? 'PASS' : share >= t.coverageFail ? 'WARN' : 'FAIL', `${jg.expected - jg.unjudged.length} of ${jg.expected} runs judged by all ${jg.judges.length} judge(s)${jg.unjudged.length ? `; unjudged: ${jg.unjudged.slice(0, 8).join(', ')}${jg.unjudged.length > 8 ? ` and ${jg.unjudged.length - 8} more` : ''}` : ''}`, 'every run judged by every judge'));
    const famOk = jg.families.length >= t.familiesMin;
    add(C('families', 'Judge families and Claude exclusion', true, jg.claude.length ? 'FAIL' : famOk ? 'PASS' : 'WARN', `${jg.families.length} family(ies): ${jg.families.join(', ') || 'none'}${jg.claude.length ? `; Claude judge: ${jg.claude.join(', ')}` : ''}`, `>= ${t.familiesMin} families, no Claude judge`));
    const a = jg.agreement;
    if (!a) add(C('agreement', 'Judge agreement', true, jg.judges.length < 2 ? 'N/A' : 'WARN', jg.judges.length < 2 ? 'one judge' : 'no overlapping criteria', `within-one >= ${t.withinOneMin} and exact >= ${t.exactMin}`));
    else add(C('agreement', 'Judge agreement', true, a.withinOne >= t.withinOneMin && a.exact >= t.exactMin ? 'PASS' : a.withinOne < t.withinOneFail ? 'FAIL' : 'WARN', `exact ${pct(a.exact)}, within one level ${pct(a.withinOne)} over ${a.pairs} criterion pair(s)`, `within-one >= ${t.withinOneMin} and exact >= ${t.exactMin}; FAIL under ${t.withinOneFail} within-one`));
    add(C('parse', 'Judge parse failures', false, jg.parseFailures === 0 ? 'PASS' : 'WARN', String(jg.parseFailures), '0'));
    if (!jg.pairwise.run) add(C('orders', 'Both orderings judged', false, 'N/A', 'no pairwise mode', 'every pairwise record has two orderings'));
    else add(C('orders', 'Both orderings judged', false, jg.pairwise.bothOrders === jg.pairwise.records && jg.pairwise.records > 0 ? 'PASS' : jg.pairwise.records === 0 ? 'WARN' : 'FAIL', `${jg.pairwise.bothOrders} of ${jg.pairwise.records} pairwise records`, 'all'));
    add(C('truncation', 'Judge bundle truncation', false, jg.truncated === 0 ? 'PASS' : 'WARN', `${jg.truncated} record(s) judged a cut-off file`, '0'));
  }

  if (!needsJudging && !jg.present) add(C('calibration', 'Human calibration', false, 'N/A', 'no judges', 'kappa >= 0.6'));
  else if (f.calibration && finite(f.calibration.kappa)) add(C('calibration', 'Human calibration', false, f.calibration.kappa >= t.kappaMin ? 'PASS' : 'WARN', `kappa ${f.calibration.kappa.toFixed(2)}${f.calibration.kappa >= t.kappaMin ? '' : ' (uncalibrated)'}`, `kappa >= ${t.kappaMin}`));
  else add(C('calibration', 'Human calibration', false, 'WARN', 'uncalibrated: no calibration result recorded', `kappa >= ${t.kappaMin}`));

  const ck = f.checks;
  if (!ck.withChecks) add(C('checks', 'Checks rechecked and current', false, 'N/A', 'no checks', 'all runs carry the current checks revision'));
  else add(C('checks', 'Checks rechecked and current', false, ck.currentRevision === ck.withChecks && ck.stale === 0 ? 'PASS' : 'WARN', `${ck.currentRevision} of ${ck.withChecks} runs carry the current checks revision; ${ck.stale} stale judge record(s)`, 'all current, none stale'));

  const h = f.hidden;
  add(C('hidden', 'Hidden tests behind the quality metric', true, h.tasks && h.withHidden === h.tasks ? 'PASS' : 'WARN', `${h.withHidden} of ${h.tasks} task(s) have hidden-test results${h.withHidden === 0 ? ' (quality rests on checks and rubric)' : ''}`, 'every task'));

  const hr = f.headroom;
  if (!hr.tasks) add(C('headroom', 'Headroom', true, 'N/A', 'no base arm', `base below ${t.ceiling}`));
  else {
    const s = hr.ceilingTasks.length / hr.tasks;
    add(C('headroom', 'Headroom', true, s <= t.headroomShare ? 'PASS' : 'WARN', `${hr.ceilingTasks.length} of ${hr.tasks} task(s) at ceiling for the base arm${hr.ceilingTasks.length ? ` (${hr.ceilingTasks.slice(0, 6).join(', ')})` : ''}`, `ceiling share <= ${pct(t.headroomShare)} (base quality >= ${t.ceiling})`));
  }

  const fl = f.failures;
  const bad = fl.timeout + fl.error + fl.infraError + fl.modelMismatch;
  add(C('failures', 'Failed, timed-out, infra and model-mismatch runs', false, bad === 0 ? 'PASS' : bad / Math.max(1, fl.n) > t.failureShareFail ? 'FAIL' : 'WARN', `${bad} of ${fl.n} (timeout ${fl.timeout}, error ${fl.error}, infra ${fl.infraError}, model mismatch ${fl.modelMismatch}); checks failed ${fl.checksFailed}`, `0 PASS, over ${pct(t.failureShareFail)} FAIL`));
  add(C('censored', 'Censored credits', false, f.censored === 0 ? 'PASS' : 'WARN', `${f.censored} run(s)${f.censored ? ' (credits are lower bounds)' : ''}`, '0'));
  if (!f.contamination) add(C('contamination', 'Contamination flags', false, 'N/A', 'no audited runs', '0 flagged'));
  else add(C('contamination', 'Contamination flags', false, f.contamination.flagged === 0 ? 'PASS' : 'WARN', `${f.contamination.flagged} of ${f.contamination.audited} audited (externalFetch ${f.contamination.externalFetch}, fixRecall ${f.contamination.fixRecall})`, '0 flagged'));

  const pin = f.pin;
  add(C('pin', 'Model pin verified in every run', true, pin.mismatch > 0 ? 'FAIL' : pin.verified === pin.runs && pin.runs > 0 ? 'PASS' : 'WARN', `${pin.verified} of ${pin.runs} runs verified${pin.mismatch ? `; ${pin.mismatch} mismatch` : ''}${f.hasDifferentModels ? '; run directories use different models' : ''}`, 'all runs'));

  const iso = f.isolation;
  const weak = iso.modes.includes('none');
  add(C('isolation', 'Isolation mode and tripwire', false, iso.tripwire > 0 || weak ? 'WARN' : iso.unknown || !iso.modes.length ? 'WARN' : 'PASS', iso.modes.length ? `${iso.modes.join(', ')}; tripwire flagged ${iso.tripwire} run(s)${iso.unknown ? `; ${iso.unknown} run(s) not recorded` : ''}` : 'not recorded', 'unshare or sandbox-exec, 0 tripwire flags'));

  const b = f.budget;
  if (!b.recorded) add(unknown('budget', 'Budget spent vs cap', false, 'cap recorded, no skipped cells'));
  else {
    const over = b.cap !== null && b.spent > b.cap;
    add(C('budget', 'Budget spent vs cap', false, over || b.skipped > 0 ? 'WARN' : 'PASS', `${b.spent.toFixed(2)} spent of ${b.cap === null ? 'no cap' : b.cap}; ${b.skipped} cell(s) skipped`, 'within the cap, none skipped'));
  }

  if (!f.aa) add(C('drift', 'Same-day drift (A/A spread vs delta)', false, 'N/A', 'no A/A arm', `cost spread <= ${pct(t.aaCostRel)}, quality spread <= ${t.aaQualityPts} points`));
  else {
    const a = f.aa;
    const okCost = a.costSpread === null || a.costSpread <= t.aaCostRel;
    const okQ = a.qualitySpread === null || a.qualitySpread <= t.aaQualityPts;
    const okDay = a.spanHours === null || a.spanHours <= t.sameDayHours;
    add(C('drift', 'Same-day drift (A/A spread vs delta)', false, okCost && okQ && okDay ? 'PASS' : 'WARN',
      `A/A cost spread ${a.costSpread === null ? 'n/a' : pct(a.costSpread)}, quality spread ${a.qualitySpread === null ? 'n/a' : `${a.qualitySpread.toFixed(1)} pts`}; largest delta vs base ${a.largestDelta.arms ? `${pct(a.largestDelta.cost)} cost, ${a.largestDelta.quality.toFixed(1)} pts` : 'n/a'}; A/A runs span ${a.spanHours === null ? 'n/a' : `${a.spanHours.toFixed(1)} h`}`,
      `cost spread <= ${pct(t.aaCostRel)}, quality spread <= ${t.aaQualityPts} points, runs within ${t.sameDayHours} h`));
  }

  const pv = f.provenance;
  add(C('provenance', 'Provenance complete', true, pv.missing.length ? 'WARN' : pv.dirty ? 'WARN' : 'PASS', pv.missing.length ? `not recorded: ${pv.missing.join(', ')}` : pv.dirty ? 'complete, but the bench tree was dirty' : 'bench commit, content hash, tool versions, arm SHAs, clean tree', 'all recorded, tree clean'));

  if (f.taskValidation === null) add(unknown('validation', 'Task validation evidence', false, 'validate-tasks OK recorded', 'unknown: validate-tasks result not recorded in run-config'));
  else add(C('validation', 'Task validation evidence', false, f.taskValidation.ok ? 'PASS' : 'FAIL', f.taskValidation.ok ? 'validate-tasks OK recorded' : 'validate-tasks failed', 'validate-tasks OK recorded'));

  return out;
}

/** anecdotal: a key criterion FAILs. supported: every applicable key criterion PASSes and nothing FAILs. indicative: the rest. */
function rate(criteria) {
  const key = criteria.filter((c) => c.key && c.status !== 'N/A');
  const blockers = key.filter((c) => c.status !== 'PASS');
  if (key.some((c) => c.status === 'FAIL')) return { rating: 'anecdotal', blockers };
  if (!blockers.length && !criteria.some((c) => c.status === 'FAIL')) return { rating: 'supported', blockers };
  return { rating: 'indicative', blockers };
}

function scorecard(facts, t = THRESHOLDS) {
  const criteria = evaluate(facts, t);
  const { rating, blockers } = rate(criteria);
  const count = (s) => criteria.filter((c) => c.status === s).length;
  return { rating, criteria, counts: { PASS: count('PASS'), WARN: count('WARN'), FAIL: count('FAIL'), 'N/A': count('N/A') }, blockers: blockers.map((c) => ({ id: c.id, label: c.label, status: c.status, value: c.value })), thresholds: t };
}

module.exports = { collectFacts, evaluate, rate, scorecard, THRESHOLDS, agreementOf };
