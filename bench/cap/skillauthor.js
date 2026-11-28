// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap skill-author` (BACKLOG B-027; design: bench/docs/history/skill-author-design-2026-11-28.md): writes a
// skill's draft baseline from a source file, free (`--from-source`), or with two model families, paid:
//   rules     the writer reads SKILL.md and returns rules with verbatim quotes (a quote not in SKILL.md is dropped free)
//   per batch write, review, then fix and recheck only for failed tasks; a task that fails the recheck is dropped
//             and recorded, never fixed by hand (the one-fix rule of unitauthor.js)
// so at most 9 calls a skill. A task that fails the frozen format counts as failed, with the format messages as its
// note, so the free check costs no call. `--review-only` has the reviewer check each batch of a hand-written source
// once (2 calls) and drops what fails, with no fix. Every call is spend-checked by paidcall.js and resumable.

const fs = require('node:fs');
const path = require('node:path');
const { textFlag: val, repoRootOf } = require('../runner/lib/flag-values.js');
const { WORST_PER_CALL, ledgerSpent, paidJson } = require('./paidcall.js');
const { WRITER, REVIEWER } = require('./unitauthor.js');
const { normalizeForMatch, validateTasks, validateBuckets } = require('./baselineformats.js');
const { DRAFTS_DIR, filesOf, writeDraft } = require('./skillsource.js');

const BATCHES = ['a', 'b'];
const TASKS_PER_BATCH = 8;
const CLASSES = ['useful', 'style', 'generic'];
const fileBlock = (text) => `<<<FILE\n${text}\nFILE>>>`;
const numbered = (rules) => rules.map((r, i) => ({ n: i + 1, class: r.c, quote: r.q, outcome: r.o }));

const rulesPrompt = (skillMd) => [
  'You extract rules from one skill file for a benchmark. A model answers tasks once with the skill loaded and once without.',
  '', 'The skill:', fileBlock(skillMd), '',
  'Return 8 to 16 rules. Each rule has "q": a quote copied exactly from the skill, at least 12 characters; "c": "useful" (it should',
  'change what a good answer does), "style" (format only), or "generic" (what any good answer does anyway; give exactly one);',
  '"o": what an answer that follows the rule does, in plain words; "w": why it matters; "h": a situation where it applies.',
  'Also return "request_context": one sentence on the kind of request the skill is for.',
  'Reply only with JSON: {"request_context": "...", "rules": [{"q": "...", "c": "...", "o": "...", "w": "...", "h": "..."}]}',
].join('\n');

const writePrompt = (skillMd, rules, ids, avoid) => [
  'You write skill benchmark tasks. A model answers each task once, with no tools, once with the skill loaded and once without;',
  'judges score each answer against the task\'s checks.', '', 'The skill:', fileBlock(skillMd), '',
  'Write one task per id. Each task has "id"; "title"; "section" (the skill section it tests); "prompt": a self-contained request of',
  'at least 45 words that pastes any document, diff or log it needs, and never names the skill, a rule id or a rule quote; "rubric":',
  '5 to 8 checks, each [rule number, one checkable sentence], on rules whose class is not style; "why": why the skill matters here.',
  ...(avoid.length ? ['Do not repeat these situations:', JSON.stringify(avoid)] : []),
  '', 'Rules:', JSON.stringify(numbered(rules), null, 2), '', 'Task ids:', JSON.stringify(ids), '',
  'Reply only with JSON: {"tasks": [{"id": "...", "title": "...", "section": "...", "prompt": "...", "rubric": [[1, "..."]], "why": "..."}]}',
].join('\n');

const reviewPrompt = (skillMd, rules, tasks) => [
  'You review skill benchmark tasks. A model answers each task once, with no tools, with and without the skill below.', '',
  'The skill:', fileBlock(skillMd), '',
  'Fail a task when: its prompt names or hints at the skill; a good answer would not differ with the skill loaded; a check cannot be',
  'checked against an answer or does not follow from its rule; or a check rewards something the request does not need. Else pass it.',
  '', 'Rules:', JSON.stringify(numbered(rules), null, 2), '', 'Tasks:', JSON.stringify(tasks, null, 2), '',
  'Reply only with JSON: {"reviews": [{"id": "...", "verdict": "pass" or "fail", "note": "one sentence"}]}, one per task.',
].join('\n');

const fixPrompt = (skillMd, rules, failed) => [
  'You fix skill benchmark tasks that a reviewer or the format check failed. Fix each once, using its note, and keep its id.',
  'Same rules as before: a self-contained prompt of at least 45 words that never names the skill or quotes a rule; 5 to 8 checks,',
  'each [rule number, one checkable sentence], on rules whose class is not style.', '', 'The skill:', fileBlock(skillMd), '',
  'Rules:', JSON.stringify(numbered(rules), null, 2), '', 'Failed tasks with notes:', JSON.stringify(failed, null, 2), '',
  'Reply only with JSON: {"tasks": [{"id": "...", "title": "...", "section": "...", "prompt": "...", "rubric": [[1, "..."]], "why": "..."}]}',
].join('\n');

/** The writer's rules, keeping only rules whose quote is in SKILL.md: { request_context, rules, dropped }. */
function readRules(j, skillMd) {
  const text = normalizeForMatch(skillMd);
  const shaped = (j.rules ?? []).filter((r) => r && CLASSES.includes(r.c) && [r.q, r.o, r.h].every((s) => typeof s === 'string' && s.trim()));
  const kept = shaped.filter((r) => normalizeForMatch(r.q).length >= 12 && text.includes(normalizeForMatch(r.q)));
  if (kept.length < 3 || typeof j.request_context !== 'string') throw new Error(`the rules reply has ${kept.length} usable rules (3 needed) or no request_context`);
  return { request_context: j.request_context, rules: kept.map(({ q, c, o, w, h }) => ({ q, c, o, w: w ?? '', h })), dropped: (j.rules ?? []).filter((r) => !kept.includes(r)) };
}

/** A writer reply: exactly the tasks of `ids`, each fully shaped. Format rules are checked later, by formatNotes. */
function readTasks(j, ids) {
  const byId = new Map((j.tasks ?? []).map((t) => [t.id, t]));
  return ids.map((id) => {
    const t = byId.get(id);
    const ok = t && ['title', 'section', 'prompt', 'why'].every((k) => typeof t[k] === 'string' && t[k].trim()) && Array.isArray(t.rubric) && t.rubric.every((x) => Array.isArray(x) && Number.isInteger(x[0]) && typeof x[1] === 'string');
    if (!ok) throw new Error(`task ${id} is missing or not shaped as { title, section, prompt, rubric: [[n, text]], why }`);
    return { id, title: t.title, section: t.section, prompt: t.prompt, rubric: t.rubric.map(([n, s]) => [n, s.trim()]), why: t.why };
  });
}

function readReviews(j, ids) {
  const byId = new Map((j.reviews ?? []).map((r) => [r.id, r]));
  return ids.map((id) => {
    const r = byId.get(id);
    if (!r || !['pass', 'fail'].includes(r.verdict)) throw new Error(`review of ${id} is missing or not pass or fail`);
    return { id, verdict: r.verdict, note: String(r.note ?? '') };
  });
}

/**
 * The frozen-format problems of some tasks, by task id: Map(id -> note). The tasks are checked as one batch with the
 * frozen validators (through filesOf), so the rules are the same as for a frozen baseline.
 */
function formatNotes({ skill, repo, ruleSet, tasks }) {
  const nOf = (t) => Number(t.id.slice(t.id.lastIndexOf('-') + 1));
  const source = { skill, request_context: ruleSet.request_context, writtenBy: 'check', rules: ruleSet.rules, batches: { check: tasks.map((t) => ({ ...t, n: nOf(t) })) } };
  const files = filesOf(source, { repo }).files;
  const notes = new Map();
  const idOf = (m) => { const i = /scenarios\[(\d+)\]/.exec(m); if (i) return tasks[Number(i[1])]?.id; const k = /scenarios\.([a-z0-9-]+)\./.exec(m); return k ? tasks.find((t) => `${skill}-check-${nOf(t)}` === k[1])?.id : null; };
  for (const [, obj, kind, ctx] of files.filter(([, , k]) => k === 'tasks' || k === 'buckets')) {
    // Batch-wide messages (too few tasks in a subset being fixed) name no task and are left out.
    for (const m of (kind === 'tasks' ? validateTasks : validateBuckets)(obj, ctx).errors) {
      const id = idOf(m);
      if (id) notes.set(id, [notes.get(id), m].filter(Boolean).join('; '));
    }
  }
  return notes;
}

/** The steps of a skill, in order, with each one's model: what a dry run prints and a cap is set from. */
const planOf = (batches = BATCHES) => [{ step: 'rules', model: WRITER }, ...batches.flatMap((b) => ['write', 'review', 'fix', 'recheck'].map((s) => ({ step: `${b}.${s}`, model: s === 'write' || s === 'fix' ? WRITER : REVIEWER })))];

const failedOf = (reviews, notes) => reviews.filter((r) => r.verdict === 'fail' || notes.has(r.id)).map((r) => ({ id: r.id, note: [r.verdict === 'fail' ? r.note : '', notes.get(r.id) ?? ''].filter(Boolean).join('; ') }));

/** One batch: write, review, and one fix and recheck of what failed. Returns { tasks, dropped, fixed }. */
function authorBatch({ batch, ctx, call, avoid }) {
  const { skillMd, ruleSet } = ctx;
  const ids = Array.from({ length: TASKS_PER_BATCH }, (_, i) => `${ctx.skill}-${batch}-${i + 1}`);
  const drafts = call(`${batch}.write`, WRITER, writePrompt(skillMd, ruleSet.rules, ids, avoid), (j) => readTasks(j, ids));
  const reviews = call(`${batch}.review`, REVIEWER, reviewPrompt(skillMd, ruleSet.rules, drafts), (j) => readReviews(j, ids));
  const failed = failedOf(reviews, formatNotes({ ...ctx, tasks: drafts }));
  if (!failed.length) return { tasks: drafts, dropped: [], fixed: [] };
  const failedIds = failed.map((x) => x.id);
  const withNotes = drafts.filter((t) => failedIds.includes(t.id)).map((t) => ({ ...t, note: failed.find((x) => x.id === t.id).note }));
  const fixes = call(`${batch}.fix`, WRITER, fixPrompt(skillMd, ruleSet.rules, withNotes), (j) => readTasks(j, failedIds));
  const rechecks = call(`${batch}.recheck`, REVIEWER, reviewPrompt(skillMd, ruleSet.rules, fixes), (j) => readReviews(j, failedIds));
  const still = new Map(failedOf(rechecks, formatNotes({ ...ctx, tasks: fixes })).map((x) => [x.id, x.note]));
  const fixedById = new Map(fixes.map((t) => [t.id, t]));
  const tasks = drafts.map((t) => fixedById.get(t.id) ?? t).filter((t) => !still.has(t.id));
  return { tasks, dropped: [...still].map(([id, note]) => ({ id, note })), fixed: failedIds.filter((id) => !still.has(id)) };
}

const asSourceTask = (t) => ({ n: Number(t.id.slice(t.id.lastIndexOf('-') + 1)), title: t.title, section: t.section, prompt: t.prompt, rubric: t.rubric, why: t.why });
const callerOf = (paid, skill) => (step, model, prompt, parse) => paidJson({ ...paid, model, prompt, out: path.join(paid.workDir, 'steps', step), label: `${skill} ${step}` }, parse).value;

/**
 * Writes one skill's draft baseline with two families. Options: skill, repo, out (drafts folder), paid (paidcall's
 * { cap, ledger, workDir, bin, authDb }), dryRun. Returns { status: 'planned' | 'written' | 'dropped', plan, worst,
 * spent, dropped, problems }. The source the writer's replies make and a record of drops go in the work dir.
 */
function authorSkill({ skill, repo, out = DRAFTS_DIR, paid, dryRun = false }) {
  const skillMd = fs.readFileSync(path.join(repo, 'skills', skill, 'SKILL.md'), 'utf8');
  const steps = path.join(paid.workDir, 'steps');
  const plan = planOf().map((p) => ({ ...p, done: fs.existsSync(path.join(steps, `${p.step}.json`)) }));
  if (dryRun) return { status: 'planned', plan, worst: plan.filter((p) => !p.done).length * WORST_PER_CALL, spent: fs.existsSync(paid.ledger) ? ledgerSpent(paid.ledger) : 0 };
  const call = callerOf(paid, skill);
  const ruleSet = call('rules', WRITER, rulesPrompt(skillMd), (j) => readRules(j, skillMd));
  const ctx = { skill, repo, skillMd, ruleSet };
  const results = [];
  for (const b of BATCHES) results.push({ batch: b, ...authorBatch({ batch: b, ctx, call, avoid: results.flatMap((r) => r.tasks.map((t) => t.title)) }) });
  const dropped = results.flatMap((r) => r.dropped.map((d) => ({ batch: r.batch, ...d })));
  const source = { skill, request_context: ruleSet.request_context, writtenBy: WRITER, reviewedBy: REVIEWER, rules: ruleSet.rules,
    batches: Object.fromEntries(results.map((r) => [r.batch, r.tasks.map(asSourceTask)])) };
  fs.writeFileSync(path.join(paid.workDir, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);
  fs.writeFileSync(path.join(paid.workDir, 'author-record.json'), `${JSON.stringify({ skill, droppedRules: ruleSet.dropped, dropped, fixed: results.flatMap((r) => r.fixed) }, null, 2)}\n`);
  const { problems } = writeDraft({ source, repo, out });
  return { status: dropped.length ? 'dropped' : 'written', plan, dropped, problems };
}

/**
 * The second-family check of a hand-written source: one review call per batch by `reviewer`, which must not be the
 * writer's family; a task that fails the review or the format is dropped and recorded, with no fix. Writes the draft.
 * Returns { dropped, problems }.
 */
function reviewDraft({ sourceFile, repo, out = DRAFTS_DIR, paid, reviewer = REVIEWER }) {
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const { skill } = source;
  const skillMd = fs.readFileSync(path.join(repo, 'skills', skill, 'SKILL.md'), 'utf8');
  const call = callerOf(paid, skill);
  const ruleSet = { request_context: source.request_context, rules: source.rules };
  const dropped = [];
  const batches = {};
  for (const [batch, list] of Object.entries(source.batches)) {
    const tasks = list.map((t, i) => ({ id: `${skill}-${batch}-${t.n ?? i + 1}`, title: t.title, section: t.section, prompt: t.prompt, rubric: t.rubric, why: t.why }));
    const reviews = call(`review-only.${batch}`, reviewer, reviewPrompt(skillMd, source.rules, tasks), (j) => readReviews(j, tasks.map((t) => t.id)));
    const failed = failedOf(reviews, formatNotes({ skill, repo, ruleSet, tasks }));
    dropped.push(...failed.map((x) => ({ batch, ...x })));
    batches[batch] = tasks.filter((t) => !failed.some((x) => x.id === t.id)).map(asSourceTask);
  }
  const reviewed = { ...source, reviewedBy: reviewer, batches };
  fs.mkdirSync(paid.workDir, { recursive: true });
  fs.writeFileSync(path.join(paid.workDir, `${skill}.reviewed-source.json`), `${JSON.stringify(reviewed, null, 2)}\n`);
  fs.writeFileSync(path.join(paid.workDir, `${skill}.review-record.json`), `${JSON.stringify({ skill, reviewer, dropped }, null, 2)}\n`);
  return { dropped, problems: writeDraft({ source: reviewed, repo, out }).problems };
}

/** The command. Free with --from-source alone; paid otherwise (or with --review-only), and then --cap, --ledger and --work are needed. */
function cmdSkillAuthor(opts) {
  const skill = val(opts.skill);
  if (!skill) throw new Error('--skill NAME is required');
  const repo = repoRootOf(opts);
  const out = path.resolve(val(opts.out) ?? DRAFTS_DIR);
  const sourceFile = val(opts['from-source']) ? path.resolve(val(opts['from-source'])) : null;
  if (sourceFile && !opts['review-only']) {
    const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    if (source.skill !== skill) throw new Error(`${sourceFile} is for ${source.skill}, not ${skill}`);
    const r = writeDraft({ source, repo, out });
    console.log(`wrote ${r.dir}; verifier problems: ${r.problems.length}`);
    for (const p of r.problems) console.log(`  ${p}`);
    if (r.problems.length) process.exitCode = 1;
    return;
  }
  const cap = Number(val(opts.cap));
  const paid = { cap, ledger: val(opts.ledger) && path.resolve(val(opts.ledger)), workDir: val(opts.work) && path.resolve(val(opts.work)),
    ...(val(opts['kiro-bin']) ? { bin: path.resolve(val(opts['kiro-bin'])) } : {}), ...(val(opts['auth-db']) ? { authDb: path.resolve(val(opts['auth-db'])) } : {}) };
  if (!(cap > 0) || !paid.ledger || !paid.workDir) throw new Error('a paid author run needs --cap N (credits), --ledger FILE and --work DIR');
  if (opts['review-only']) {
    if (!sourceFile) throw new Error('--review-only needs --from-source FILE');
    if (opts['dry-run']) { console.log(`review-only ${skill}: ${Object.keys(JSON.parse(fs.readFileSync(sourceFile, 'utf8')).batches).length} call(s) by ${REVIEWER}, worst ${2 * WORST_PER_CALL} counted credits`); return; }
    const r = reviewDraft({ sourceFile, repo, out, paid });
    console.log(`reviewed ${skill}: ${r.dropped.length} task(s) dropped; verifier problems: ${r.problems.length}`);
    if (r.dropped.length || r.problems.length) process.exitCode = 2;
    return;
  }
  const r = authorSkill({ skill, repo, out, paid, dryRun: Boolean(opts['dry-run']) });
  if (r.status === 'planned') {
    for (const p of r.plan) console.log(`${p.done ? 'done' : 'todo'}  ${p.step}  ${p.model}`);
    console.log(`worst case ${r.worst} counted credits at ${WORST_PER_CALL} a call; spent so far ${r.spent}; cap ${cap}`);
    return;
  }
  console.log(`${r.status} ${skill}: ${r.dropped.length} task(s) dropped; verifier problems: ${r.problems.length}`);
  if (r.status === 'dropped' || r.problems.length) process.exitCode = 2;
}

module.exports = { BATCHES, planOf, readRules, readTasks, formatNotes, authorSkill, reviewDraft, cmdSkillAuthor, rulesPrompt, writePrompt, reviewPrompt, fixPrompt };
