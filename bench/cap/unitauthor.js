// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap unit-author`: writes the frozen baseline of one stage 2 to 4 unit from its task briefs, with two model
// families and the one-fix rule. Per batch of 8 briefs:
//   write     the writer family drafts the 8 tasks (prompt and rubric) from the briefs and the unit's text
//   review    the reviewer family passes or fails each task, with a note
//   fix       only when a task failed: the writer gets one fix of the failed tasks, with the notes
//   recheck   the reviewer reads the fixed tasks again; a task that still fails is dropped and recorded, never fixed by
//             hand
// So a unit costs at most 8 calls (2 batches x 4 steps). Every call is a paid, spend-checked call (paidcall.js): the
// ledger is read before each one, at the larger of 15 and its real credits, under a hard cap. Each step's reply is
// saved in the work dir, so a rerun resumes after the last finished step. With all 16 tasks passing, the baseline is
// written frozen on the unit's current hash, for a person to sign off; with any dropped, a draft and the drops are
// written instead and the command exits 2: the owner decides what replaces them. `--dry-run` prints the steps and the
// worst case and makes no call.

const fs = require('node:fs');
const path = require('node:path');
const { textFlag: val, repoRootOf } = require('../runner/lib/flag-values.js');
const { unitManifest, UNIT_BASELINES_DIR } = require('./units.js');
const { WORST_PER_CALL, ledgerSpent, assertOutsideHome, paidJson } = require('./paidcall.js');
const { readJsonFile } = require('./checkedjson.js');

const WRITER = 'glm-5';
const REVIEWER = 'deepseek-3.2';
const STEPS = ['write', 'review', 'fix', 'recheck'];

const fileBlock = (text) => `<<<FILE\n${text}\nFILE>>>`;

const writePrompt = (unitText, briefs) => [
  'You write benchmark tasks for one always-loaded instruction file of a coding-agent orchestrator. Each task gives the',
  'orchestrator a situation and asks what it does next. A model answers it once with the file loaded and once without.',
  '', 'The file:', fileBlock(unitText), '',
  'Write one task for each brief below. Each task has:',
  '- "id": the brief id;',
  '- "prompt": the situation, in the words a user or a specialist result would use, ending with a question about what the',
  '  orchestrator does next. It must not quote, name or hint at the file;',
  '- "rubric": 3 to 5 items, each one statement a reader can check against an answer, that together say what the brief\'s',
  '  good answer does. Put exact names (agents, files, commands) in backticks.',
  '', 'Briefs:', JSON.stringify(briefs.map(({ id, section, situation, good }) => ({ id, section, situation, good })), null, 2), '',
  'Reply only with JSON: {"tasks": [{"id": "...", "prompt": "...", "rubric": ["..."]}]}',
].join('\n');

const reviewPrompt = (unitText, briefs, tasks) => [
  'You review benchmark tasks written for one always-loaded instruction file of a coding-agent orchestrator. A model',
  'answers each task once with the file loaded and once without; judges score each answer against the rubric.',
  '', 'The file:', fileBlock(unitText), '',
  'Fail a task when any of these holds: the prompt quotes, names or hints at the file; the right answer does not follow',
  'from the file; a rubric item cannot be checked against an answer, or does not match the brief\'s good answer; the',
  'rubric rewards something the brief does not ask for. Otherwise pass it.',
  '', 'Briefs:', JSON.stringify(briefs, null, 2), '', 'Tasks:', JSON.stringify(tasks, null, 2), '',
  'Reply only with JSON: {"reviews": [{"id": "...", "verdict": "pass" or "fail", "note": "one sentence"}]}, one per task.',
].join('\n');

const fixPrompt = (unitText, briefs, failed) => [
  'You wrote these benchmark tasks for the instruction file below, and a reviewer failed them. Fix each one once, using',
  'the reviewer\'s note. Keep its id. The prompt must not quote, name or hint at the file; the rubric has 3 to 5 checkable',
  'items that match the brief\'s good answer, with exact names in backticks.',
  '', 'The file:', fileBlock(unitText), '',
  'Briefs:', JSON.stringify(briefs, null, 2), '', 'Failed tasks with the reviewer\'s notes:', JSON.stringify(failed, null, 2), '',
  'Reply only with JSON: {"tasks": [{"id": "...", "prompt": "...", "rubric": ["..."]}]}, one per failed task.',
].join('\n');

/** Checks a writer reply: exactly the tasks of `ids`, each with a prompt and 3 to 5 rubric items. Returns them by id order. */
function readTasks(j, ids) {
  const byId = new Map((j.tasks ?? []).map((t) => [t.id, t]));
  return ids.map((id) => {
    const t = byId.get(id);
    if (!t || typeof t.prompt !== 'string' || !t.prompt.trim() || !Array.isArray(t.rubric) || t.rubric.length < 3 || t.rubric.length > 5 || !t.rubric.every((x) => typeof x === 'string' && x.trim())) {
      throw new Error(`task ${id} is missing, or lacks a prompt or 3 to 5 rubric items`);
    }
    return { id, prompt: t.prompt.trim(), rubric: t.rubric.map((x) => x.trim()) };
  });
}

/** Checks a reviewer reply: one pass or fail per id. Returns [{ id, verdict, note }] in id order. */
function readReviews(j, ids) {
  const byId = new Map((j.reviews ?? []).map((r) => [r.id, r]));
  return ids.map((id) => {
    const r = byId.get(id);
    if (!r || !['pass', 'fail'].includes(r.verdict)) throw new Error(`review of ${id} is missing or not pass or fail`);
    return { id, verdict: r.verdict, note: String(r.note ?? '') };
  });
}

/** The steps a batch may take, in order, with each one's model: the plan the dry run prints and the cap is set from. */
const planOf = (batches) => batches.flatMap((b) => STEPS.map((step) => ({ batch: b, step, model: step === 'write' || step === 'fix' ? WRITER : REVIEWER })));

/**
 * Runs one batch's four steps (fix and recheck only when a task failed). `call(step, model, prompt, parse)` makes one
 * paid call. Returns { tasks: the passing tasks, dropped: [{ id, note }], calls }.
 */
function authorBatch({ batch, briefs, unitText, call }) {
  const ids = briefs.map((b) => b.id);
  const drafts = call(`${batch}.write`, WRITER, writePrompt(unitText, briefs), (j) => readTasks(j, ids));
  const reviews = call(`${batch}.review`, REVIEWER, reviewPrompt(unitText, briefs, drafts), (j) => readReviews(j, ids));
  const failed = reviews.filter((r) => r.verdict === 'fail');
  if (!failed.length) return { tasks: drafts, dropped: [], fixed: [] };
  const failedIds = failed.map((r) => r.id);
  const failedBriefs = briefs.filter((b) => failedIds.includes(b.id));
  const failedTasks = drafts.filter((t) => failedIds.includes(t.id)).map((t) => ({ ...t, note: failed.find((r) => r.id === t.id).note }));
  const fixes = call(`${batch}.fix`, WRITER, fixPrompt(unitText, failedBriefs, failedTasks), (j) => readTasks(j, failedIds));
  const rechecks = call(`${batch}.recheck`, REVIEWER, reviewPrompt(unitText, failedBriefs, fixes), (j) => readReviews(j, failedIds));
  const stillFailed = new Map(rechecks.filter((r) => r.verdict === 'fail').map((r) => [r.id, r.note]));
  const fixedById = new Map(fixes.map((t) => [t.id, t]));
  const tasks = drafts.map((t) => (failedIds.includes(t.id) ? fixedById.get(t.id) : t)).filter((t) => !stillFailed.has(t.id));
  return { tasks, dropped: [...stillFailed].map(([id, note]) => ({ id, note })), fixed: failedIds.filter((id) => !stillFailed.has(id)) };
}

/** The briefs file of a unit: { unit, briefs: [{ id, batch, section, situation, good }] }, two batches of 8. */
function loadBriefs(file, unitId) {
  const b = readJsonFile(file);
  if (b.unit !== unitId) throw new Error(`${file} is for ${b.unit}, not ${unitId}`);
  const batches = [...new Set((b.briefs ?? []).map((x) => x.batch))];
  if (batches.length !== 2 || batches.some((x) => b.briefs.filter((y) => y.batch === x).length !== 8)) throw new Error(`${file} needs 2 batches of 8 briefs`);
  return { batches, briefs: b.briefs };
}

/**
 * Writes one unit's baseline. Options: kind, name, repo, briefsFile, out (the baseline.json path), paid (paidcall's
 * { cap, ledger, workDir, bin, authDb }), dryRun. Returns { status: 'planned' | 'frozen' | 'dropped', file, plan, dropped }.
 */
function authorUnit({ kind, name, repo, briefsFile, out, paid, dryRun = false }) {
  const unit = unitManifest({ repo, kind, name });
  const { batches, briefs } = loadBriefs(briefsFile, unit.id);
  const stepsDir = path.join(paid.workDir, 'steps');
  const plan = planOf(batches).map((p) => ({ ...p, done: fs.existsSync(path.join(stepsDir, `${p.batch}.${p.step}.json`)) }));
  if (dryRun) return { status: 'planned', plan, worst: plan.filter((p) => !p.done).length * WORST_PER_CALL, spent: paid.ledger ? ledgerSpent(paid.ledger) : 0 };
  const call = (step, model, prompt, parse) => paidJson({ ...paid, model, prompt, out: path.join(stepsDir, step), label: `${unit.id} ${step}` }, parse).value;
  const results = batches.map((b) => ({ batch: b, ...authorBatch({ batch: b, briefs: briefs.filter((x) => x.batch === b), unitText: unit.text, call }) }));
  const dropped = results.flatMap((r) => r.dropped.map((d) => ({ batch: r.batch, ...d })));
  const baseline = {
    format_version: 1, kind, name, unit_sha256: unit.sha256,
    source: {
      commit: null, briefs: path.basename(briefsFile), writtenBy: WRITER, reviewedBy: REVIEWER, rule: 'one fix by the writer, then drop and record; never fixed by hand',
      fixed: results.flatMap((r) => r.fixed), dropped, ledgerCredits: paid.ledger ? ledgerSpent(paid.ledger) : null, signedOffBy: null,
    },
    batches: results.map((r) => ({ batch: r.batch, tasks: r.tasks })),
  };
  const file = dropped.length ? out.replace(/\.json$/, '.draft.json') : out;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  return { status: dropped.length ? 'dropped' : 'frozen', file, plan, dropped };
}

/** The command: `cap unit-author --kind K --unit NAME --work DIR --ledger FILE --cap N [--briefs FILE] [--out FILE] [--dry-run]`. */
function cmdUnitAuthor(opts) {
  const repo = repoRootOf(opts);
  const kind = val(opts.kind);
  const name = val(opts.unit);
  if (!kind || !name) throw new Error('--kind agent|sop|context and --unit NAME are required');
  const dir = path.join(UNIT_BASELINES_DIR, `${kind}-${name}`);
  if (!val(opts.work)) throw new Error('--work DIR is required (outside the home folder; the steps are saved there, so a rerun resumes)');
  const paid = {
    cap: Number(val(opts.cap)), ledger: val(opts.ledger) && path.resolve(val(opts.ledger)), workDir: path.resolve(val(opts.work)),
    ...(val(opts['kiro-bin']) ? { bin: val(opts['kiro-bin']) } : {}), ...(val(opts['auth-db']) ? { authDb: path.resolve(val(opts['auth-db'])) } : {}),
  };
  assertOutsideHome(paid.workDir);
  const args = { kind, name, repo, briefsFile: path.resolve(val(opts.briefs) ?? path.join(dir, 'briefs.json')), out: path.resolve(val(opts.out) ?? path.join(dir, 'baseline.json')), paid };
  if (opts['dry-run']) {
    const r = authorUnit({ ...args, dryRun: true });
    for (const p of r.plan) console.log(`${p.batch} ${p.step.padEnd(7)} ${p.model}${p.done ? '  done (saved, free on a rerun)' : p.step === 'fix' || p.step === 'recheck' ? '  only if a task fails' : ''}`);
    const cap = Number.isFinite(paid.cap) ? paid.cap : null;
    console.log(`dry run, no call made: at most ${r.plan.filter((p) => !p.done).length} calls, worst case ${r.worst} credits at ${WORST_PER_CALL} per call; ledger spent ${r.spent}; cap ${cap ?? '(none given)'}${cap === null ? '' : r.spent + r.worst <= cap ? '; the worst case fits' : '; the worst case does not fit'}`);
    return;
  }
  if (!paid.ledger) throw new Error('--ledger FILE is required for a paid run');
  const r = authorUnit(args);
  if (r.status === 'frozen') console.log(`wrote ${r.file}: 16 tasks passed review; a person who did not write them signs off before it is used`);
  else {
    console.log(`wrote ${r.file}: ${r.dropped.length} task(s) dropped after one fix (${r.dropped.map((d) => d.id).join(', ')}); no baseline is frozen until the owner decides what replaces them`);
    process.exitCode = 2;
  }
}

module.exports = { WRITER, REVIEWER, planOf, readTasks, readReviews, authorBatch, loadBriefs, authorUnit, cmdUnitAuthor, writePrompt, reviewPrompt, fixPrompt };
