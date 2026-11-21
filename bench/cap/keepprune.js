// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap keep-prune`: one keep-or-prune tool at two depths, under one copied rule set (Michael Lin's labels, verdicts,
// coverage, no-data and control pass rules; see labels.js and passrules.js).
//
//   quick  one answer per task and arm (with, without) over a frozen baseline: two batches of 8 tasks per skill.
//   deep   replicated answers per task and arm (with, its A/A repeat aa, without), as full sessions give them.
//
// Both depths score each answer with the same two readings, A (a checklist written from the request alone) and B (the
// skill's rules checklist), on the 1 to 5 scale, and read them with the same rules. Every judged answer has three
// judges from three distinct, known model families, none the agent's (PANEL_RULES, SR-24); the answer's score is the
// median of the three. A task's gap is the mean median score with minus the mean median score without; a task counts
// when all three judges scored every answer validly and the with arm loaded the skill. A stored judgment made from
// other inputs is stale and refused, never read. No verdict is read unless every control in the run passed (SR-25).
// The deep check adds one rule of ours (DEEP_RULES): no verdict inside the A/A spread.
//
// What this measures is the conditional effect after load: the with arm is made to load the skill, so the result says
// what the skill does once selected, not whether users' requests select it. A whole-skill keep or prune call also
// needs a separate selection result (kprecord.js).
//
// All model work goes through `provider` ({ answer, writeChecklist, judge }); in Phase A only the stub exists
// (stubprovider.js), so nothing here can spend.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { gapStats, round4 } = require('./gapstats.js');
const { LABELS, labelSkill, verdictFor } = require('./labels.js');
const { ladderDoses, evaluateLadder, evaluateConventionControl, trustOf } = require('./passrules.js');
const { buildPairs, itemName } = require('./doseladder.js');
const { judgeSeats } = require('../judge/family.js');
const { formatGap } = require('./gaptext.js');

const DEPTHS = Object.freeze({
  quick: Object.freeze({ arms: ['with', 'without'], harness: 'one-turn' }),
  deep: Object.freeze({ arms: ['with', 'aa', 'without'], harness: 'kiro-cli' }),
});
const READINGS = Object.freeze(['A', 'B']);
const WEIGHT = Object.freeze({ MET: 1, PARTIAL: 0.5, MISSING: 0 });
/** The owner's panel rule (PANEL_RULES): this many judge families score every judged answer. */
const JUDGE_FAMILIES = 3;
/** What every keep-or-prune block measures. */
const CLAIM = 'conditional effect after load';
const JUDGE_PROMPT_VERSION = 'cap-keep-prune-judge/1';
const DEFAULT_REPLICATES = 3;

const DEEP_RULES_DATE = '2026-11-17';
const DEEP_RULES = [
  'Deep check only, checked beside the copied label rules and written before any paid deep run. "A/A gap" is reading A\'s per-task gap between the with arm and its repeat (aa), pooled over the counted tasks like any gap. The A/A spread is the absolute mean A/A gap.',
  '',
  '1. The skill is `NO DATA` when the A/A gap has no interval (fewer than 2 counted tasks).',
  "2. The skill is `NO DATA` when the absolute mean of A is not above the A/A spread: the effect sits inside the run-to-run noise.",
  '3. A change is a new dated rule; a record made under these rules is never read again under new ones.',
].join('\n');

const PANEL_RULES_DATE = '2026-11-17';
const PANEL_RULES = [
  'Both depths, an owner decision that replaces the copied rule of two judge seats per task.',
  '',
  `1. Before any judging, at least ${JUDGE_FAMILIES} judges must be seated from ${JUDGE_FAMILIES} distinct, known model families, none of them the agent's family (SR-24). With fewer, nothing is judged and the check is \`NO DATA\` with "not enough judge families" as its first reason.`,
  `2. The first ${JUDGE_FAMILIES} seated judges score every judged answer. The answer's score is the median of their ${JUDGE_FAMILIES} scores.`,
  `3. A task counts in a reading only when all ${JUDGE_FAMILIES} judges scored every one of its answers validly. Every score and family is kept in the record.`,
  '4. A change is a new dated rule; a record made under these rules is never read again under new ones.',
].join('\n');

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** The median of a non-empty list of numbers. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const { sha256 } = require('../runner/lib/util.js');
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');

/** The 1 to 5 score of one judgment: 1 plus 4 times the share of weight met; null when a label is not one of the three. */
function scoreOf(labels, items) {
  if (!Array.isArray(labels) || labels.length !== items || !labels.every((l) => l in WEIGHT)) return null;
  return 1 + (4 * labels.reduce((s, l) => s + WEIGHT[l], 0)) / items;
}

/**
 * Gap statistics in the shape his readings carry (copied from summarizeGaps in readings-report.js, commit 705fd834):
 * rounded mean and intervals for print, and the unrounded t interval the rules compare with 0.
 */
function summarizeGaps(gaps) {
  const r = gapStats(gaps);
  return {
    tasks_counted: r.tasks,
    mean_gap: round4(r.mean_gap),
    t_interval: r.t_interval && r.t_interval.map(round4),
    bootstrap_interval: r.bootstrap_interval && r.bootstrap_interval.map(round4),
    t_interval_exact: r.t_interval,
  };
}

/**
 * One reading from its task rows [{ batch, counted, gap, stale }]: { tasks, tasks_counted, mean_gap, t_interval,
 * bootstrap_interval, t_interval_exact, by_batch, judgments: { stale } }. A batch is in by_batch only when the reading
 * had judge work in it, so a batch with none reads as "not read".
 */
function readingOf(rows) {
  const gaps = (rs) => rs.filter((r) => r.counted).map((r) => r.gap);
  const byBatch = {};
  for (const b of [...new Set(rows.map((r) => r.batch))]) {
    const mine = rows.filter((r) => r.batch === b);
    byBatch[b] = { tasks: mine.length, ...summarizeGaps(gaps(mine)) };
  }
  return { tasks: rows.length, ...summarizeGaps(gaps(rows)), by_batch: byBatch, judgments: { stale: rows.reduce((n, r) => n + r.stale, 0) } };
}

/**
 * Stored judgments under `dir` (null keeps them in memory only). get(key, inputSha) returns { state, record }: current
 * when the stored record was made from these inputs, stale when from others, missing when there is none.
 */
function judgmentStore(dir) {
  const memory = new Map();
  const fileOf = (key) => path.join(dir, ...key.map(safe)) + '.json';
  const read = (key) => {
    if (!dir) return memory.get(key.join('/')) ?? null;
    try { return JSON.parse(fs.readFileSync(fileOf(key), 'utf8')); } catch { return null; }
  };
  return {
    get(key, inputSha) {
      const record = read(key);
      if (!record) return { state: 'missing', record: null };
      return { state: record.input_sha256 === inputSha ? 'current' : 'stale', record };
    },
    put(key, record) {
      if (!dir) { memory.set(key.join('/'), record); return; }
      const f = fileOf(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, `${JSON.stringify(record, null, 2)}\n`);
    },
  };
}

/**
 * The judgments of one reading of one task: per seat, per arm, the score of each answer (one per replicate; null when
 * the judgment was invalid or refused as stale). Returns { seatScores: Map(seat -> { arm: [score|null] }), stale }.
 * A missing judgment is made by the provider and stored; a stale one is refused (not read, counted) unless `rejudge`
 * is true, which makes it again. `seats` are judge model ids, `keyBase` the store key prefix, `answers` { arm: [{ text }] }.
 */
function judgeReading({ provider, store, seats, keyBase, taskId, checklist, answers, rejudge }) {
  const seatScores = new Map();
  let stale = 0;
  for (const seat of seats) {
    const byArm = {};
    for (const [arm, list] of Object.entries(answers)) {
      byArm[arm] = [];
      list.forEach((ans, rep) => {
        const inputSha = sha256(JSON.stringify([JUDGE_PROMPT_VERSION, seat, checklist, ans.text]));
        const key = [...keyBase, `${safe(seat)}.${arm}.${rep}`];
        let { state, record } = store.get(key, inputSha);
        if (state === 'stale' && !rejudge) { stale += 1; byArm[arm].push(null); return; }
        if (state !== 'current') {
          const j = provider.judge({ seat, checklist, answer: ans.text, taskId });
          record = { input_sha256: inputSha, seat, arm, replicate: rep, labels: j.labels, version: j.version ?? null };
          store.put(key, record);
        }
        byArm[arm].push(scoreOf(record.labels, checklist.length));
      });
    }
    seatScores.set(seat, byArm);
  }
  return { seatScores, stale };
}

/**
 * The panel scores of each answer: { arm: [{ replicate, median, seats: [{ model, score }] }] }. `median` is null unless
 * every seat scored the answer validly.
 */
function answerScores(seatScores, arms) {
  const seats = [...seatScores.keys()];
  return Object.fromEntries(arms.map((arm) => {
    const n = Math.max(0, ...seats.map((s) => seatScores.get(s)[arm]?.length ?? 0));
    return [arm, Array.from({ length: n }, (_, rep) => {
      const list = seats.map((model) => ({ model, score: seatScores.get(model)[arm]?.[rep] ?? null }));
      return { replicate: rep, median: list.length === JUDGE_FAMILIES && list.every((x) => x.score !== null) ? median(list.map((x) => x.score)) : null, seats: list };
    })];
  }));
}

/**
 * The task gap of `left` minus `right`: mean median score of `left`'s answers minus that of `right`'s. The task counts
 * only when every answer of every arm in `arms` has its panel median (PANEL_RULES 3). Returns { counted, gap, scores }.
 */
function taskGap(seatScores, left, right, arms) {
  const scores = answerScores(seatScores, arms);
  const counted = arms.every((a) => scores[a].length > 0 && scores[a].every((x) => x.median !== null));
  const gap = counted ? mean(scores[left].map((x) => x.median)) - mean(scores[right].map((x) => x.median)) : null;
  return { counted, gap, scores };
}

/**
 * Checks one subject (a skill or a control skill) at one depth and returns his readSkill shape plus the A/A reading
 * and every panel score: { skill, tasks, A, B, B_all, exclusions, aa, status, scores }. `seats` are the panel's judge
 * model ids (empty: nothing is judged). `subject` is { name, skill: { text } , batches: [{ batch,
 * tasks: [{ id, prompt, rubric }] }] }. `bWaiting` lists batches whose rules checklist waits for a refreshed baseline,
 * so B is not judged there. `status` counts tasks by what happened to them (counted, not_loaded, setup_fault).
 */
function checkSubject({ subject, depth, provider, seats, store, subjectModel, replicates = DEFAULT_REPLICATES, bWaiting = [], rejudge = false }) {
  const { arms } = DEPTHS[depth];
  const reps = depth === 'deep' ? replicates : 1;
  const rows = { A: [], B: [], aa: [] };
  const scores = [];
  const status = { counted: 0, not_loaded: 0, setup_fault: 0 };
  const allTasks = subject.batches.flatMap((b) => b.tasks.map((t) => ({ ...t, batch: b.batch })));
  for (const task of allTasks) {
    const answers = Object.fromEntries(arms.map((arm) => [arm, Array.from({ length: reps }, (_, rep) => provider.answer({ request: task.prompt, skill: subject.skill, arm, replicate: rep, model: subjectModel }))]));
    // The with arm must load the skill in every run; the without arm loading it means the arms were set up wrong.
    const fault = answers.without.some((a) => a.loaded);
    const unloaded = arms.filter((a) => a !== 'without').some((a) => answers[a].some((x) => !x.loaded));
    const usable = !fault && !unloaded;
    if (fault) status.setup_fault += 1; else if (unloaded) status.not_loaded += 1; else status.counted += 1;
    if (!seats.length) continue;
    const readings = READINGS.filter((r) => !(r === 'B' && bWaiting.includes(task.batch)));
    if (!usable) {
      // An answer that never loaded the skill, or a without arm that did, is not judged and never counts.
      for (const r of readings) rows[r].push({ batch: task.batch, counted: false, gap: null, stale: 0 });
      if (depth === 'deep') rows.aa.push({ batch: task.batch, counted: false, gap: null, stale: 0 });
      continue;
    }
    const checklists = { A: provider.writeChecklist({ request: task.prompt, count: task.rubric.length }), B: task.rubric };
    for (const reading of readings) {
      const keyBase = [depth, subject.name, task.batch, task.id, reading];
      const j = judgeReading({ provider, store, seats, keyBase, taskId: task.id, checklist: checklists[reading], answers, rejudge });
      const g = taskGap(j.seatScores, 'with', 'without', arms);
      rows[reading].push({ batch: task.batch, counted: j.stale === 0 && g.counted, gap: g.gap, stale: j.stale });
      for (const [arm, list] of Object.entries(g.scores)) for (const x of list) scores.push({ task: task.id, batch: task.batch, reading, arm, ...x });
      if (reading === 'A' && depth === 'deep') {
        const a = taskGap(j.seatScores, 'with', 'aa', arms);
        rows.aa.push({ batch: task.batch, counted: j.stale === 0 && a.counted, gap: a.gap, stale: 0 });
      }
    }
  }
  const B = readingOf(rows.B);
  return { skill: subject.name, tasks: allTasks.length, A: readingOf(rows.A), B, B_all: B, exclusions: [], aa: depth === 'deep' ? readingOf(rows.aa) : null, status, scores };
}

/**
 * The dose ladder as a judge test: each dose's authored pairs (defective answer in the with arm) judged by reading A.
 * Returns ladderDoses output [{ dose, n, skill, summary }] for evaluateLadder.
 */
function checkLadder({ ladder, provider, seats, store, rejudge = false }) {
  const pairs = buildPairs(ladder);
  const summaries = {};
  for (const dose of Object.keys(ladder.doses)) {
    const item = itemName(dose);
    const rows = [];
    for (const p of pairs.filter((x) => x.dose === dose)) {
      if (!seats.length) continue;
      const checklist = provider.writeChecklist({ request: p.prompt, rubric: p.rubric });
      const answers = { with: [{ text: p.with }], without: [{ text: p.without }] };
      const j = judgeReading({ provider, store, seats, keyBase: ['ladder', ladder.set, item, p.task_id, 'A'], taskId: p.task_id, checklist, answers, rejudge });
      const g = taskGap(j.seatScores, 'with', 'without', ['with', 'without']);
      rows.push({ batch: ladder.set, counted: j.stale === 0 && g.counted, gap: g.gap, stale: j.stale });
    }
    const A = readingOf(rows);
    summaries[item] = { skill: item, tasks: ladder.tasks.length, A, B: readingOf([]), B_all: readingOf([]), exclusions: [] };
  }
  return ladderDoses(ladder.doses, summaries);
}

/**
 * Our deep rule (DEEP_RULES): the reason the deep check is NO DATA under the A/A spread, or null. `A` and `aa` are
 * readings; `aa` null (a quick check) gives null.
 */
function deepNoData(A, aa) {
  if (!aa) return null;
  if (!aa.t_interval_exact) return `the A/A gap has no interval (${aa.tasks_counted} counted tasks), so the noise is unknown (deep rule 1)`;
  if (typeof A.mean_gap !== 'number') return null;
  const spread = Math.abs(aa.mean_gap);
  if (Math.abs(A.mean_gap) <= spread) return `A mean ${formatGap(A.mean_gap)} is inside the A/A spread ${formatGap(spread)} (deep rule 2)`;
  return null;
}

/**
 * The judge panel under SR-24 and PANEL_RULES: { seats, why, info }. `seats` are the first JUDGE_FAMILIES seated judge
 * model ids, or empty with `why` naming the shortage; `info` is judgeSeats' result with later seated judges marked
 * as not on the panel.
 */
function judgePanel({ subjectModel, judges }) {
  const info = judgeSeats({ subjectModel, judges });
  let taken = 0;
  const seats = info.seats.map((s) => {
    if (!s.seated) return s;
    taken += 1;
    return taken <= JUDGE_FAMILIES ? s : { ...s, seated: false, why: `the panel already has its ${JUDGE_FAMILIES} families` };
  });
  const seated = seats.filter((s) => s.seated);
  const panel = { ...info, seats };
  if (info.judged && seated.length === JUDGE_FAMILIES) return { seats: seated.map((s) => s.model), why: null, info: panel };
  const detail = info.judged ? `only ${seated.length} distinct known families other than the agent's (${info.subject.family}) are seated` : info.why;
  const why = `not enough judge families: ${JUDGE_FAMILIES} distinct, known families other than the agent's are needed before judging; ${detail}`;
  return { seats: [], why, info: { ...panel, judged: false, why, seats: seats.map((s) => (s.seated ? { ...s, seated: false, why: 'not enough judge families, so nothing is judged' } : s)) } };
}

/**
 * The verdict of one depth for one skill. Runs the controls (convention-control at this depth, and the dose ladder)
 * and the skill under the same seats, then applies the copied rules, SR-24, SR-25 and our deep rule. Options:
 *   depth          quick or deep
 *   subject        the skill: { name, skill: { text }, batches }
 *   convention     the convention-control subject, or null to leave it out of the run
 *   ladder         the dose ladder, or null to leave it out
 *   subjectModel   the agent's model id (its family decides the seats)
 *   judges         judge model ids
 *   bWaiting       batches whose B waits for a refreshed baseline
 *   store          a judgmentStore; replicates and rejudge as in checkSubject
 * Returns { depth, entry, summary, seats, controls }, where entry is labelSkill's result with every extra no-data
 * cause added in front of his own: not enough judge families first, then `subjectNoData` (a stale unit, an unapproved
 * rename or fold), then SR-25, then the deep rule. `subjectNoData` is a list of reasons the subject cannot be read.
 */
function checkDepth({ depth, subject, convention = null, ladder = null, provider, subjectModel, judges, bWaiting = [], subjectNoData = [], store = judgmentStore(null), replicates = DEFAULT_REPLICATES, rejudge = false }) {
  if (!DEPTHS[depth]) throw new Error(`depth must be quick or deep, not ${JSON.stringify(depth)}`);
  const panel = judgePanel({ subjectModel, judges });
  const { seats } = panel;
  const common = { depth, provider, seats, store, subjectModel, replicates, rejudge };
  const evaluations = [];
  const ran = [];
  if (convention) { evaluations.push(evaluateConventionControl(checkSubject({ ...common, subject: convention }))); ran.push('convention-control'); }
  if (ladder) { evaluations.push(evaluateLadder(checkLadder({ ladder, provider, seats, store, rejudge }))); ran.push('dose-ladder'); }
  const trust = trustOf(evaluations);
  const summary = checkSubject({ ...common, subject, bWaiting });
  const batches = subject.batches.map((b) => b.batch);
  const entry = labelSkill({ summary, batches, bWaiting });
  const extra = [];
  if (panel.why) extra.push(panel.why);
  extra.push(...subjectNoData.filter(Boolean));
  if (!trust.trusted) extra.push(trust.status === 'NONE' ? 'the run includes no control, so no verdict is read (SR-25)' : `a control did not pass (${trust.evaluations.filter((e) => !e.pass).map((e) => `${e.control} ${e.status}`).join(', ')}), so no verdict is read (SR-25)`);
  const aaWhy = deepNoData(summary.A, summary.aa);
  if (aaWhy) extra.push(aaWhy);
  if (extra.length) {
    const noData = [...extra, ...entry.no_data.filter((r) => !extra.includes(r))];
    const v = verdictFor(LABELS.noData, null, null, { noDataWhy: noData[0] });
    Object.assign(entry, { label: LABELS.noData, why: noData[0], verdict: v.verdict, verdict_why: v.why, verdict_action: v.action, no_data: noData });
  }
  return { depth, entry, summary, seats: panel.info, unjudged: panel.why, controls: { ...trust, ran } };
}

module.exports = {
  DEPTHS, JUDGE_FAMILIES, CLAIM, DEEP_RULES, DEEP_RULES_DATE, PANEL_RULES, PANEL_RULES_DATE, JUDGE_PROMPT_VERSION, DEFAULT_REPLICATES,
  scoreOf, median, readingOf, judgmentStore, checkSubject, checkLadder, deepNoData, judgePanel, checkDepth,
};
