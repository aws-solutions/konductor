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

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { textFlag: val, repoRootOf } = require('../runner/lib/flag-values.js');
const { unitManifest, UNIT_BASELINES_DIR, PAID_FRAME } = require('./units.js');
const { WORST_PER_CALL, ledgerSpent, assertOutsideHome, paidJson } = require('./paidcall.js');
const { readJsonFile } = require('./checkedjson.js');
const { commitOf, baselineProblems } = require('./unitstage.js');
const { BENCH_DIR } = require('../runner/lib/tasks.js');
const { familyOf } = require('../judge/family.js');

const WRITER = 'glm-5';
const REVIEWER = 'deepseek-3.2';
const DEFAULT_FAMILIES = Object.freeze({ writer: WRITER, reviewer: REVIEWER });
const STEPS = ['write', 'review', 'fix', 'recheck'];

const fileBlock = (text) => `<<<FILE\n${text}\nFILE>>>`;

// `frame` is PAID_FRAME[kind] (units.js): what the unit is (`noun`) and what a task looks like (`tasks`).
const writePrompt = (frame, unitText, briefs, extra = []) => [
  `You write benchmark tasks for one ${frame.noun}. ${frame.tasks}`,
  'A model answers each task once with the file loaded and once without.',
  '', 'The file:', fileBlock(unitText), '',
  'Write one task for each brief below. Each task has:',
  '- "id": the brief id;',
  '- "prompt": the situation, in the words its sender would use, ending with a question.',
  '  It must not quote, name or hint at the file;',
  '- "rubric": 3 to 5 items, each one statement a reader can check against an answer, that together say what the brief\'s',
  '  good answer does. Put exact names (agents, files, commands) in backticks.',
  ...extra, '', 'Briefs:', JSON.stringify(briefs.map(({ id, section, situation, good }) => ({ id, section, situation, good })), null, 2), '',
  'Reply only with JSON: {"tasks": [{"id": "...", "prompt": "...", "rubric": ["..."]}]}',
].join('\n');

const reviewPrompt = (frame, unitText, briefs, tasks, extra = []) => [
  `You review benchmark tasks written for one ${frame.noun}. ${frame.tasks}`,
  'A model answers each task once with the file loaded and once without; judges score each answer against the rubric.',
  '', 'The file:', fileBlock(unitText), '',
  'Fail a task when any of these holds: the prompt quotes, names or hints at the file; the right answer does not follow',
  'from the file; a rubric item cannot be checked against an answer, or does not match the brief\'s good answer; the',
  'rubric rewards something the brief does not ask for. Otherwise pass it.',
  ...extra, '', 'Briefs:', JSON.stringify(briefs, null, 2), '', 'Tasks:', JSON.stringify(tasks, null, 2), '',
  'Reply only with JSON: {"reviews": [{"id": "...", "verdict": "pass" or "fail", "note": "one sentence"}]}, one per task.',
].join('\n');

const fixPrompt = (frame, unitText, briefs, failed, extra = []) => [
  `You wrote these benchmark tasks for the ${frame.noun} below, and a reviewer failed them. ${frame.tasks}`,
  'Fix each failed task once, using the reviewer\'s note. Keep its id. The prompt must not quote, name or hint at the file; the rubric has 3 to 5 checkable',
  'items that match the brief\'s good answer, with exact names in backticks.',
  '', 'The file:', fileBlock(unitText), '',
  ...(extra.length ? [...extra, ''] : []), 'Briefs:', JSON.stringify(briefs, null, 2), '', 'Failed tasks with the reviewer\'s notes:', JSON.stringify(failed, null, 2), '',
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
const planOf = (batches, fam = DEFAULT_FAMILIES) => batches.flatMap((b) => STEPS.map((step) => ({ batch: b, step, model: step === 'write' || step === 'fix' ? fam.writer : fam.reviewer })));

/**
 * Runs one batch's four steps (fix and recheck only when a task failed). `call(step, model, prompt, parse)` makes one
 * paid call. Returns { tasks: the passing tasks, dropped: [{ id, note }], calls }.
 */
function authorBatch({ batch, briefs, unitText, frame, call, fam = DEFAULT_FAMILIES, extra = {} }) {
  const ids = briefs.map((b) => b.id);
  const drafts = call(`${batch}.write`, fam.writer, writePrompt(frame, unitText, briefs, extra.writer), (j) => readTasks(j, ids));
  const reviews = call(`${batch}.review`, fam.reviewer, reviewPrompt(frame, unitText, briefs, drafts, extra.reviewer), (j) => readReviews(j, ids));
  const failed = reviews.filter((r) => r.verdict === 'fail');
  if (!failed.length) return { tasks: drafts, dropped: [], fixed: [] };
  const failedIds = failed.map((r) => r.id);
  const failedBriefs = briefs.filter((b) => failedIds.includes(b.id));
  const failedTasks = drafts.filter((t) => failedIds.includes(t.id)).map((t) => ({ ...t, note: failed.find((r) => r.id === t.id).note }));
  const fixes = call(`${batch}.fix`, fam.writer, fixPrompt(frame, unitText, failedBriefs, failedTasks, extra.writer), (j) => readTasks(j, failedIds));
  const rechecks = call(`${batch}.recheck`, fam.reviewer, reviewPrompt(frame, unitText, failedBriefs, fixes, extra.reviewer), (j) => readReviews(j, failedIds));
  const stillFailed = new Map(rechecks.filter((r) => r.verdict === 'fail').map((r) => [r.id, r.note]));
  const fixedById = new Map(fixes.map((t) => [t.id, t]));
  const tasks = drafts.map((t) => (failedIds.includes(t.id) ? fixedById.get(t.id) : t)).filter((t) => !stillFailed.has(t.id));
  return { tasks, dropped: [...stillFailed].map(([id, note]) => ({ id, note })), fixed: failedIds.filter((id) => !stillFailed.has(id)) };
}

/**
 * Who writes and who reviews. A briefs file may set { "families": { "writer", "reviewer" } } so a rewrite is not written
 * by the family that wrote the first tasks (the 2026-11-23 combined review: glm-5 wrote the pilot, so deepseek-3.2
 * writes and glm-5 reviews). The two must be two known families, and neither Claude, the agent's own family.
 */
function familiesOf(b, file) {
  if (b.families === undefined) return DEFAULT_FAMILIES;
  const { writer, reviewer } = b.families ?? {};
  const fw = familyOf(String(writer ?? '')), fr = familyOf(String(reviewer ?? ''));
  if (!fw || !fr) throw new Error(`${file}: families.writer and families.reviewer must be models of a known family`);
  if (fw === fr) throw new Error(`${file}: the writer ${writer} and the reviewer ${reviewer} are one family (${fw}); a family never checks its own work`);
  if (fw === 'claude' || fr === 'claude') throw new Error(`${file}: Claude is the agent's own family and neither writes nor reviews its tasks`);
  return { writer, reviewer };
}

/** The briefs file of a unit: { unit, families?, briefs: [{ id, batch, section, situation, good }] }, two batches of 8. */
function loadBriefs(file, unitId) {
  const b = readJsonFile(file);
  if (b.unit !== unitId) throw new Error(`${file} is for ${b.unit}, not ${unitId}`);
  const batches = [...new Set((b.briefs ?? []).map((x) => x.batch))];
  if (batches.length !== 2 || batches.some((x) => b.briefs.filter((y) => y.batch === x).length !== 8)) throw new Error(`${file} needs 2 batches of 8 briefs`);
  return { batches, briefs: b.briefs, families: familiesOf(b, file) };
}

/**
 * Writes one unit's baseline. Options: kind, name, repo, briefsFile, out (the baseline.json path), paid (paidcall's
 * { cap, ledger, workDir, bin, authDb }), dryRun. Returns { status: 'planned' | 'frozen' | 'dropped', file, plan, dropped }.
 */
function authorUnit({ kind, name, repo, briefsFile, out, paid, dryRun = false }) {
  const unit = unitManifest({ repo, kind, name });
  const { batches, briefs, families: fam } = loadBriefs(briefsFile, unit.id);
  // A person's sign-off is never overwritten: a rerun would rewrite the file with signedOffBy null.
  if (fs.existsSync(out) && JSON.parse(fs.readFileSync(out, 'utf8')).source?.signedOffBy) throw new Error(`${out} is already signed off; move it aside to write a new baseline`);
  const stepsDir = path.join(paid.workDir, 'steps');
  const plan = planOf(batches, fam).map((p) => ({ ...p, done: fs.existsSync(path.join(stepsDir, `${p.batch}.${p.step}.json`)) }));
  if (dryRun) return { status: 'planned', plan, worst: plan.filter((p) => !p.done).length * WORST_PER_CALL, spent: paid.ledger ? ledgerSpent(paid.ledger) : 0 };
  const call = (step, model, prompt, parse) => paidJson({ ...paid, model, prompt, out: path.join(stepsDir, step), label: `${unit.id} ${step}` }, parse).value;
  const results = batches.map((b) => ({ batch: b, ...authorBatch({ batch: b, briefs: briefs.filter((x) => x.batch === b), unitText: unit.text, frame: PAID_FRAME[kind], call, fam }) }));
  const dropped = results.flatMap((r) => r.dropped.map((d) => ({ batch: r.batch, ...d })));
  const baseline = {
    format_version: 1, kind, name, unit_sha256: unit.sha256,
    source: {
      commit: commitOf(BENCH_DIR), briefs: path.basename(briefsFile), writtenBy: fam.writer, reviewedBy: fam.reviewer, rule: 'one fix by the writer, then drop and record; never fixed by hand',
      fixed: results.flatMap((r) => r.fixed), dropped, ledgerCredits: paid.ledger ? ledgerSpent(paid.ledger) : null, signedOffBy: null,
    },
    batches: results.map((r) => ({ batch: r.batch, tasks: r.tasks })),
  };
  const file = dropped.length ? out.replace(/\.json$/, '.draft.json') : out;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  return { status: dropped.length ? 'dropped' : 'frozen', file, plan, dropped };
}

/** The two calls of one replacement, in order: the other family writes, the first family reviews. */
const replacePlan = (id, fam = DEFAULT_FAMILIES) => [{ step: `${id}.replace`, model: fam.reviewer }, { step: `${id}.replace-review`, model: fam.writer }];

/**
 * Option B for a task dropped under the one-fix rule: a new task for the same brief, written by the reviewer family
 * (deepseek-3.2) and reviewed by the writer family (glm-5), so neither family checks its own work. Two paid calls, no
 * fix: if the review fails, the task stays dropped and the failure is recorded. The draft (`draftFile`) is updated in
 * place: a passing task goes into its batch and out of `source.dropped`, and `source.replaced` records who wrote and
 * reviewed it. Returns { status: 'planned' | 'replaced' | 'still dropped', plan, worst, spent, review }.
 */
function replaceDropped({ kind, name, repo, briefsFile, draftFile, paid, id, dryRun = false }) {
  const unit = unitManifest({ repo, kind, name });
  const { briefs, families: fam } = loadBriefs(briefsFile, unit.id);
  const draft = readJsonFile(draftFile);
  if (draft.unit_sha256 !== unit.sha256) throw new Error(`${draftFile} was written for another version of ${unit.id}; write a new baseline instead`);
  const dropped = (draft.source?.dropped ?? []).find((d) => d.id === id);
  if (!dropped) throw new Error(`${id} is not in source.dropped of ${draftFile}`);
  const brief = briefs.find((b) => b.id === id);
  const stepsDir = path.join(paid.workDir, 'steps');
  const plan = replacePlan(id, fam).map((p) => ({ ...p, done: fs.existsSync(path.join(stepsDir, `${p.step}.json`)) }));
  const spent = paid.ledger ? ledgerSpent(paid.ledger) : 0;
  if (dryRun) return { status: 'planned', plan, worst: plan.filter((p) => !p.done).length * WORST_PER_CALL, spent };
  const call = (step, model, prompt, parse) => paidJson({ ...paid, model, prompt, out: path.join(stepsDir, step), label: `${unit.id} ${step}` }, parse).value;
  const frame = PAID_FRAME[kind];
  const [task] = call(`${id}.replace`, fam.reviewer, `${writePrompt(frame, unit.text, [brief])}\n\nAn earlier task for this brief was dropped. Its reviewer said: ${dropped.note}`, (j) => readTasks(j, [id]));
  const [review] = call(`${id}.replace-review`, fam.writer, reviewPrompt(frame, unit.text, [brief], [task]), (j) => readReviews(j, [id]));
  const record = { id, batch: dropped.batch, writtenBy: fam.reviewer, reviewedBy: fam.writer, verdict: review.verdict, note: review.note };
  draft.source.replaced = [...(draft.source.replaced ?? []), record];
  if (review.verdict === 'pass') {
    const batch = draft.batches.find((b) => b.batch === dropped.batch);
    batch.tasks = [...batch.tasks, task].sort((a, b) => (a.id < b.id ? -1 : 1));
    draft.source.dropped = draft.source.dropped.filter((d) => d.id !== id);
  } else {
    dropped.note = `${dropped.note}; the replacement by ${fam.reviewer} also failed review by ${fam.writer}: ${review.note}`;
  }
  draft.source.ledgerCredits = paid.ledger ? ledgerSpent(paid.ledger) : null;
  fs.writeFileSync(draftFile, `${JSON.stringify(draft, null, 2)}\n`);
  return { status: review.verdict === 'pass' ? 'replaced' : 'still dropped', plan, review };
}

/**
 * A rewrite file: { unit, families?, review, tasks: [{ id, batch, section, situation, good, why: ["..."] }] }. Each task
 * replaces the task of the same id in a frozen baseline; `why` holds the reviews' reasons it was bad.
 */
function loadRewrite(file, unitId) {
  const r = readJsonFile(file);
  if (r.unit !== unitId) throw new Error(`${file} is for ${r.unit}, not ${unitId}`);
  const tasks = r.tasks ?? [];
  if (!tasks.length) throw new Error(`${file} names no task to rewrite`);
  for (const t of tasks) {
    for (const k of ['id', 'batch', 'section', 'situation', 'good']) if (typeof t[k] !== 'string' || !t[k]) throw new Error(`${file}: task ${t.id ?? '?'} needs "${k}"`);
    if (!Array.isArray(t.why) || !t.why.length) throw new Error(`${file}: task ${t.id} needs "why", the reviews' reasons it was bad`);
  }
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length) throw new Error(`${file}: a task id is listed twice`);
  return { tasks, review: r.review ?? null, families: familiesOf(r, file) };
}

/** The lines the rewrite adds to the writer's and the reviewer's prompts: each earlier task and why it was bad. */
const rewriteExtra = (tasks, from) => {
  const earlier = JSON.stringify(tasks.map((t) => ({ id: t.id, earlier: from.get(t.id), why: t.why })), null, 2);
  return {
    writer: ['These tasks replace earlier ones that two reviewers rated BAD. Each earlier task, and why it was bad:', earlier, 'Write a new task for each brief that has none of those faults.'],
    reviewer: ['These tasks replace earlier ones that two reviewers rated BAD. Each earlier task, and why it was bad:', earlier, 'Also fail a task that repeats a fault named for its earlier version.'],
  };
};

/**
 * Writes a new version of a frozen baseline (`fromFile`) with some of its tasks rewritten from `rewriteFile`, under
 * the one-fix rule in one batch: write, review, then one fix and a recheck of failed tasks (at most 4 calls). Every
 * other task is copied unchanged, in its place; a rewrite that still fails is dropped and recorded. The result names
 * the baseline it came from and has no sign-off. Options as authorUnit, plus rewriteFile and fromFile. Returns
 * { status: 'planned' | 'frozen' | 'dropped', file, plan, worst, spent, kept, rewritten, dropped }.
 */
function rewriteUnit({ kind, name, repo, rewriteFile, fromFile, out, paid, dryRun = false }) {
  const unit = unitManifest({ repo, kind, name });
  const { tasks: briefs, review, families: fam } = loadRewrite(rewriteFile, unit.id);
  const fromText = fs.readFileSync(fromFile, 'utf8');
  const from = JSON.parse(fromText);
  const problems = baselineProblems(from);
  if (problems.length) throw new Error(`${fromFile} is not a valid baseline: ${problems.join('; ')}`);
  if (from.unit_sha256 !== unit.sha256) throw new Error(`${fromFile} was written for another version of ${unit.id}; rewrite from a fresh baseline`);
  if (path.resolve(out) === path.resolve(fromFile)) throw new Error('--out must be a new file: the baseline it comes from is never changed');
  if (fs.existsSync(out) && JSON.parse(fs.readFileSync(out, 'utf8')).source?.signedOffBy) throw new Error(`${out} is already signed off; move it aside to write a new baseline`);
  const byId = new Map(from.batches.flatMap((b) => b.tasks.map((t) => [t.id, { batch: b.batch, task: t }])));
  for (const t of briefs) {
    if (!byId.has(t.id)) throw new Error(`${t.id} is not a task of ${fromFile}`);
    if (byId.get(t.id).batch !== t.batch) throw new Error(`${t.id} is in batch ${byId.get(t.id).batch} of ${fromFile}, not ${t.batch}`);
  }
  const ids = new Set(briefs.map((t) => t.id));
  const kept = [...byId.keys()].filter((id) => !ids.has(id));
  const stepsDir = path.join(paid.workDir, 'steps');
  const plan = planOf(['rewrite'], fam).map((p) => ({ ...p, done: fs.existsSync(path.join(stepsDir, `${p.batch}.${p.step}.json`)) }));
  const spent = paid.ledger ? ledgerSpent(paid.ledger) : 0;
  if (dryRun) return { status: 'planned', plan, worst: plan.filter((p) => !p.done).length * WORST_PER_CALL, spent, kept, rewritten: [...ids] };
  const call = (step, model, prompt, parse) => paidJson({ ...paid, model, prompt, out: path.join(stepsDir, step), label: `${unit.id} ${step}` }, parse).value;
  const extra = rewriteExtra(briefs, new Map([...byId].map(([id, v]) => [id, v.task])));
  const r = authorBatch({ batch: 'rewrite', briefs, unitText: unit.text, frame: PAID_FRAME[kind], call, fam, extra });
  const fresh = new Map(r.tasks.map((t) => [t.id, t]));
  const dropped = r.dropped.map((d) => ({ batch: byId.get(d.id).batch, ...d }));
  const baseline = {
    format_version: 1, kind, name, unit_sha256: unit.sha256,
    source: {
      commit: commitOf(BENCH_DIR), version: (from.source?.version ?? 1) + 1,
      from: { file: path.basename(fromFile), sha256: crypto.createHash('sha256').update(fromText).digest('hex'), signedOffBy: from.source?.signedOffBy ?? null },
      rewrite: path.basename(rewriteFile), review, writtenBy: fam.writer, reviewedBy: fam.reviewer, rule: 'one fix by the writer, then drop and record; never fixed by hand',
      kept, rewritten: [...fresh.keys()], fixed: r.fixed, dropped: [...(from.source?.dropped ?? []), ...dropped],
      ledgerCredits: paid.ledger ? ledgerSpent(paid.ledger) : null, signedOffBy: null,
    },
    // A kept task is the same object, so it serialises to the same bytes; a rewritten one takes its place.
    batches: from.batches.map((b) => ({ batch: b.batch, tasks: b.tasks.flatMap((t) => (!ids.has(t.id) ? [t] : fresh.has(t.id) ? [fresh.get(t.id)] : [])) })),
  };
  const file = dropped.length ? out.replace(/\.json$/, '.draft.json') : out;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  return { status: dropped.length ? 'dropped' : 'frozen', file, plan, kept, rewritten: [...fresh.keys()], dropped };
}

/**
 * The freeze step: the draft (`draftFile`) becomes `out` (baseline.json) with `source.signedOffBy` set to the person
 * who read and accepted its tasks. Refuses when `out` exists, the person is empty, the unit changed since the draft,
 * or the draft is not a valid baseline (a dropped task must be recorded; 15 tasks is allowed). Returns the tasks count.
 */
function freezeDraft({ kind, name, repo, draftFile, out, signedOffBy }) {
  if (!String(signedOffBy ?? '').trim()) throw new Error('--sign-off needs the name of the person who read the tasks');
  if (fs.existsSync(out)) throw new Error(`${out} already exists; nothing was changed`);
  const draft = readJsonFile(draftFile);
  if (draft.unit_sha256 !== unitManifest({ repo, kind, name }).sha256) throw new Error(`${draftFile} was written for another version of ${kind}:${name}; it cannot be frozen`);
  const baseline = { ...draft, source: { ...draft.source, signedOffBy: String(signedOffBy).trim(), signedOffAt: new Date().toISOString() } };
  const problems = baselineProblems(baseline);
  if (problems.length) throw new Error(`${draftFile} cannot be frozen: ${problems.join('; ')}`);
  fs.writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline.batches.reduce((n, b) => n + b.tasks.length, 0);
}

/**
 * The command: `cap unit-author --kind K --unit NAME --work DIR --ledger FILE --cap N [--briefs FILE] [--out FILE] [--dry-run]`;
 * with `--replace ID` the option B replacement of one dropped task (paid, two calls); with `--sign-off NAME` the free
 * freeze of the draft into baseline.json.
 */
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
  const draftFile = args.out.replace(/\.json$/, '.draft.json');
  if (val(opts['sign-off'])) {
    const n = freezeDraft({ kind, name, repo, draftFile, out: args.out, signedOffBy: val(opts['sign-off']) });
    console.log(`froze ${args.out}: ${n} tasks, signed off by ${val(opts['sign-off']).trim()}`);
    return;
  }
  if (val(opts.rewrite)) {
    if (!val(opts.from)) throw new Error('--rewrite FILE needs --from BASELINE, the frozen baseline whose tasks it replaces');
    const rw = { ...args, rewriteFile: path.resolve(val(opts.rewrite)), fromFile: path.resolve(val(opts.from)) };
    if (!opts['dry-run'] && !paid.ledger) throw new Error('--ledger FILE is required for a paid run');
    const r = rewriteUnit({ ...rw, dryRun: Boolean(opts['dry-run']) });
    if (r.status === 'planned') {
      for (const p of r.plan) console.log(`${p.batch} ${p.step.padEnd(7)} ${p.model}${p.done ? '  done (saved, free on a rerun)' : p.step === 'fix' || p.step === 'recheck' ? '  only if a task fails' : ''}`);
      console.log(`rewrites ${r.rewritten.join(', ')}; keeps ${r.kept.length} tasks unchanged (${r.kept.join(', ')})`);
      const cap = Number.isFinite(paid.cap) ? paid.cap : null;
      console.log(`dry run, no call made: at most ${r.plan.filter((p) => !p.done).length} calls, worst case ${r.worst} credits at ${WORST_PER_CALL} per call; ledger spent ${r.spent}; cap ${cap ?? '(none given)'}${cap === null ? '' : r.spent + r.worst <= cap ? '; the worst case fits' : '; the worst case does not fit'}`);
      return;
    }
    if (r.status === 'frozen') console.log(`wrote ${r.file}: ${r.rewritten.length} tasks rewritten, ${r.kept.length} kept unchanged; a person who did not write them signs off before it is used`);
    else {
      console.log(`wrote ${r.file}: ${r.dropped.length} rewrite(s) dropped after one fix (${r.dropped.map((d) => d.id).join(', ')}); the owner decides what replaces them`);
      process.exitCode = 2;
    }
    return;
  }
  if (val(opts.replace)) {
    const r = replaceDropped({ ...args, draftFile, id: val(opts.replace), dryRun: Boolean(opts['dry-run']) });
    if (r.status === 'planned') {
      for (const p of r.plan) console.log(`${p.step.padEnd(18)} ${p.model}${p.done ? '  done (saved, free on a rerun)' : ''}`);
      console.log(`dry run, no call made: at most ${r.plan.filter((p) => !p.done).length} calls, worst case ${r.worst} credits at ${WORST_PER_CALL} per call; ledger spent ${r.spent}; cap ${Number.isFinite(paid.cap) ? paid.cap : '(none given)'}${Number.isFinite(paid.cap) ? (r.spent + r.worst <= paid.cap ? '; the worst case fits' : '; the worst case does not fit') : ''}`);
    } else console.log(`${val(opts.replace)}: ${r.status} (${r.review.verdict}: ${r.review.note}); ${draftFile} updated`);
    if (r.status === 'still dropped') process.exitCode = 2;
    return;
  }
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

module.exports = { WRITER, REVIEWER, DEFAULT_FAMILIES, familiesOf, planOf, readTasks, readReviews, authorBatch, loadBriefs, authorUnit, loadRewrite, rewriteUnit, replaceDropped, freezeDraft, cmdUnitAuthor, writePrompt, reviewPrompt, fixPrompt };
