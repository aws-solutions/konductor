#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reply check for the prompt-fix adaptive arm: does the root reply carry the lines the arm asks for (Plan, Skills,
// Review gate), in the right place, with the pre-registered solo or team choice? A diagnostic, not a counted verdict.
//   node reply-check.js score   --runs DIR [--arm konductor-adaptive] [--early yes] [--out FILE]   free: checks E1 to E7
//   node reply-check.js prompts --runs DIR --out DIR [--arm A] [--prefix P] [--tasks ID,ID] [--early yes]
//                               free: one frozen reviewer prompt per run (P.<task>.r<rep>.review-prompt.txt) and its
//                               entry in DIR/manifest.json (task, run dir, sha256, deterministic score); an existing
//                               prompt is never rewritten
//   node reply-check.js plan    --tasks smoke|all|ID,ID --reps N --run-limit N [--runs DIR]   free: paid call count and cost
//   node reply-check.js may-run --runs DIR --ledger FILE --cap N --run-cap N --run-limit N
//                               free: exit 0 and "left N" when one more early-stopped run fits both caps, else 1 and why
//   node reply-check.js rebook-early --runs DIR [--arm A] [--apply yes]
//                               free: tops up early stops an older bench booked at the floor to their measured
//                               creditSplit (D-299), in DIR/rebooked; without --apply yes it only says what it would book
//   node reply-check.js review  --prompts DIR --out DIR --claude MODEL --cap N --runs DIR --cap-usd X --work DIR
//                               [--kiro-bin F] [--auth-db F] [--aws-export-profile P] [--cache DIR] [--panel-module F]
//                               PAID: per prompt, one Claude reviewer call (kiro-cli, counted at max(15, real)) and one
//                               call per panel judge (opencode, USD); each call is checked against the ledgers first
//   node reply-check.js compare --prompts DIR --reviews DIR [--out FILE]   free: both reviewers side by side, flagged
// --early yes treats every run as stopped early (E5 to E7 are not reached). The caps are the owner's approval of
// 2026-11-27 (300 credits for the runs and the Claude reviewer together, USD 0.50 for the panel); the owner script
// run-prompt-fix-arms.sh reply-check passes them. The panel's majority is the verdict; Claude is shown beside it.
// review and compare live in reply-review.js.

const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../../runner/lib/stream.js');
const crypto = require('node:crypto');
const { rootReply, linesOf, planWord, firstPlanLine, EXPECT } = require('../../runner/lib/plan-call.js');
const { loadObserved, lookup } = require('../../judge/observed-cost.js');
const { ledgerSpent } = require('../../cap/paidcall.js');
const { spent: runsSpent } = require('./study.js');

const BENCH = path.join(__dirname, '..', '..');
const SMOKE = ['t12-mux-parallel-merge', 't1-bug-date-range', 't12-split-shared-file', 'probe-e2e-explicit-yes'];
const PANEL = ['gpt-5.6-luna', 'deepseek-3.2', 'qwen3-coder-next'];
const CLAUDE_PER_CALL = 15;
const VERDICTS = ['met', 'not-met', 'not-reached'];

const REVIEW_TEXT = {
  always: 'A reviewer spawn ran on the work.',
  'exempt-or-one': 'A reviewer spawn ran, or the Review gate line names a real exemption.',
};

/** The checks for one task, from expect.json: [{ id, text }]. The plan word and the action are skipped for 'proceed'. */
function expectationsFor(taskId) {
  const e = EXPECT.tasks[taskId];
  if (!e) throw new Error(`${taskId} is not in expect.json`);
  const scored = e.plan === 'solo' || e.plan === 'team';
  const out = [
    { id: 'E1', text: 'The reply has a line `Plan: solo, because ...` or `Plan: team (...), because ...`.' },
    { id: 'E2', text: 'That Plan line comes before the first write, edit or spawn.' },
  ];
  if (scored) out.push({ id: 'E3', text: `The Plan line says ${e.plan} (expected because: ${e.why}).` });
  out.push({ id: 'E4', text: 'A `Skills: <names>` or `Skills: none fit` line comes before the first write, edit or spawn.' });
  if (scored) out.push({ id: 'E5', text: e.plan === 'solo' ? 'The work matches a solo plan: no writer spawn.' : 'The work matches a team plan: 2 or more writer spawns.' });
  out.push({ id: 'E6', text: 'The final reply ends with a `Review gate: ...` line.' });
  if (REVIEW_TEXT[e.review]) out.push({ id: 'E7', text: REVIEW_TEXT[e.review] });
  return out;
}

// shortcut: a shell command is an act when it matches common write verbs; a write this misses only makes E2 and E4
// lenient. Upgrade to the sandbox's file diff when a run needs exact first-write timing.
const SHELL_WRITE = /(^|[;&|]\s*)(sed\s+-i|tee\b|mv\b|cp\b|rm\b|mkdir\b|touch\b|git\s+(commit|merge|worktree\s+add|checkout\s+-b|switch\s+-c|apply|am)\b|tmux\s+new)|[^<>2&]>{1,2}\s*[^&\s]/;

/** The root session in order (rootReply, one message per line start): its reply text, and its tool calls with whether
 * each is an act (write, edit or spawn). */
function timeline(events) {
  const { text, tools: calls } = rootReply(events);
  const tools = calls.map(({ at, update: u }) => {
    const spawn = String(u.toolCallId ?? '').startsWith('invoke_subagent') || /^Sub-agent/.test(u.title ?? '');
    const cmd = u.rawInput?.command;
    const act = !spawn && (['edit', 'delete', 'move'].includes(u.kind) || (typeof cmd === 'string' && SHELL_WRITE.test(cmd)));
    return { at, title: u.title ?? '', input: u.rawInput ?? null, act, spawn };
  });
  const first = tools.find((t) => t.act || t.spawn);
  return { text, tools, firstActAt: first ? first.at : null };
}

// The offset of the first line that starts with `label` and then `tail` (default a colon), or null.
const firstLineAt = (text, label, tail = ':') => {
  const m = new RegExp(`^[ \\t>*_-]*${label}${tail}`, 'im').exec(text);
  return m ? m.index : null;
};

/**
 * Scores one run against its task's checks. `orch`: result.orch (makerSpawns, reviewerSpawns). `stopped`: the run was
 * stopped early, so E5 to E7 (which need the end of the run) are null. Returns { checks: [{ id, met, evidence }], toolsBeforeFirstAct }.
 */
function scoreRun({ events, orch, taskId, stopped = false }) {
  const e = EXPECT.tasks[taskId];
  const t = timeline(events);
  const plan = firstPlanLine(linesOf(t.text, 'Plan'));
  const word = planWord(plan);
  const planAt = firstLineAt(t.text, 'Plan:\\s*(?:solo|team)\\b', '');
  const skillsAt = firstLineAt(t.text, 'Skills');
  const early = (at) => at !== null && (t.firstActAt === null || at < t.firstActAt);
  const lastLine = t.text.trim().split('\n').at(-1) ?? '';
  const done = (v) => (stopped ? null : v);
  const makers = orch?.makerSpawns ?? 0;
  const reviewers = orch?.reviewerSpawns ?? 0;
  const value = {
    E1: Boolean(word),
    E2: Boolean(word) && early(planAt),
    E3: word === e.plan,
    E4: early(skillsAt),
    E5: done(e.plan === 'solo' ? makers === 0 : makers >= 2),
    E6: done(/^[ \t>*_-]*Review gate:/i.test(lastLine)),
    E7: done(e.review === 'always' ? reviewers > 0 : reviewers > 0 || /^[ \t>*_-]*Review gate:\s*not needed\b/i.test(lastLine)),
  };
  const evidence = { E1: plan ?? 'no Plan line', E2: `Plan at ${planAt}, first act at ${t.firstActAt}`, E3: word ?? 'no plan word',
    E4: linesOf(t.text, 'Skills')[0] ?? 'no Skills line', E5: `${makers} writer spawns`, E6: lastLine.slice(0, 120), E7: `${reviewers} reviewer spawns` };
  const checks = expectationsFor(taskId).map((x) => ({ id: x.id, met: value[x.id], evidence: evidence[x.id] }));
  const toolsBeforeFirstAct = t.tools.findIndex((x) => x.act || x.spawn);
  return { checks, toolsBeforeFirstAct: toolsBeforeFirstAct < 0 ? t.tools.length : toolsBeforeFirstAct };
}

/** The transcript a reviewer reads: root text and one line per tool call, in order. Thinking is left out. */
function transcriptOf(events) {
  const t = timeline(events);
  const parts = [];
  let from = 0;
  for (const x of t.tools) {
    if (x.at > from) parts.push(`TEXT: ${t.text.slice(from, x.at).trim()}`);
    from = x.at;
    parts.push(`TOOL${x.spawn ? ' (spawn)' : x.act ? ' (write)' : ''}: ${x.title} ${JSON.stringify(x.input).slice(0, 300)}`);
  }
  if (t.text.length > from) parts.push(`TEXT: ${t.text.slice(from).trim()}`);
  return parts.join('\n');
}

/** The reviewer prompt, the same text for the Claude reviewer and each panel judge. */
function reviewPrompt({ taskId, taskPrompt, transcript }) {
  const checks = expectationsFor(taskId).map((e) => `${e.id}: ${e.text}`).join('\n');
  return `You are checking whether a coding agent followed the reply format its instructions ask for. Judge only the transcript below; do not judge code quality.

The agent's instructions ask for: a \`Plan: solo, because ...\` or \`Plan: team (<agents>), because ...\` line before its first write or spawn (a \`Plan: after a read-only look\` line may come first; the checks are on the line that says solo or team); a \`Skills: <names>\` or \`Skills: none fit\` line before its first write or spawn; and, in every final reply after a file change, a last line \`Review gate: ran <agent>\` or \`Review gate: not needed, <exemption>, <diff stat>\`.

User request:
"""
${taskPrompt}
"""

Transcript of the agent's own session (TEXT is what it wrote, TOOL is a call it made, marked (write) or (spawn) when it changed files or started another agent):
"""
${transcript}
"""

Checks:
${checks}

For each check give "met", "not-met" or "not-reached" (the transcript stops before the check can apply), and quote the words of the transcript that decide it (empty when none). Then say which way the agent decided in its own words, even when it wrote no Plan line: "solo", "team" or "none".
Reply with JSON only: {"checks":[{"id":"E1","verdict":"met","quote":"..."}],"decisionInOtherWords":"solo"}`;
}

/** Validates a reviewer reply: every check id once, a known verdict, a decision word. */
function checkReview(v, taskId) {
  const ids = expectationsFor(taskId).map((e) => e.id);
  if (!v || !Array.isArray(v.checks)) return { ok: false, error: 'the reply needs a "checks" array' };
  const got = v.checks.map((c) => c?.id);
  if (ids.some((id) => got.filter((g) => g === id).length !== 1) || got.length !== ids.length) return { ok: false, error: `checks must be exactly ${ids.join(', ')}` };
  if (!v.checks.every((c) => VERDICTS.includes(c.verdict) && typeof c.quote === 'string')) return { ok: false, error: `each verdict is one of ${VERDICTS.join(', ')}, with a quote string` };
  if (!['solo', 'team', 'none'].includes(v.decisionInOtherWords)) return { ok: false, error: 'decisionInOtherWords is solo, team or none' };
  return { ok: true, value: v };
}

/**
 * The paid plan: `tasks` x `reps` early-stopped live runs at `runLimit` credits each (hard per-run limit), plus the
 * `existing` outputs already on disk; one Claude reviewer call per output at 15 credits; three panel calls per output
 * in USD (opencode, observed cost by prompt size, worst case one retry each).
 */
function paidPlan({ tasks, reps, runLimit, existing = 0, promptKChars, observed = loadObserved() }) {
  const runs = tasks.length * reps;
  const outputs = runs + existing;
  let mid = 0;
  let high = 0;
  for (const j of PANEL) {
    const u = panelCallUsd(j, promptKChars, observed);
    mid += u.mid;
    high += u.high;
  }
  return {
    runs, runCredits: runs * runLimit, outputs, claudeCalls: outputs, claudeCredits: outputs * CLAUDE_PER_CALL,
    panel: PANEL, panelCalls: outputs * PANEL.length, panelCallsWorst: outputs * PANEL.length * 2,
    panelUsdMid: Number((outputs * mid).toFixed(4)), panelUsdHigh: Number((outputs * high * 2).toFixed(4)),
  };
}

/** USD one opencode call of `judge` on a prompt of `kchars` thousand characters may cost: { mid, high } (observed-cost.json). */
function panelCallUsd(judge, kchars, observed = loadObserved()) {
  const e = lookup(observed, 'opencode', judge, 'rubric') ?? lookup(observed, 'opencode', '*', 'rubric');
  const mid = e.perUnit ? e.perUnit.fixed + e.perUnit.perKChar * kchars : e.mean;
  return { mid, high: e.perUnit ? mid * e.perUnit.highRatio : Math.max(e.p90 ?? mid, mid) };
}

function findTaskPrompt(taskId) {
  const dirs = fs.readdirSync(path.join(BENCH, 'scenarios')).map((d) => path.join(BENCH, 'scenarios', d)).concat([path.join(BENCH, 'complex'), path.join(BENCH, 'tasks')]);
  for (const d of dirs) {
    const f = path.join(d, `${taskId}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).prompt;
  }
  throw new Error(`no task file for ${taskId}`);
}

/** Every result.json of `arm` under `dir`: [{ dir, result }]. */
function runsOf(dir, arm) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && e.name !== 'workspace' && e.name !== 'session') walk(p);
      else if (e.name === 'result.json') {
        const result = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (result.armId === arm && EXPECT.tasks[result.taskId]) out.push({ dir: d, result });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.result.taskId.localeCompare(b.result.taskId) || (a.result.replicate ?? 1) - (b.result.replicate ?? 1));
}

const eventsOf = (dir) => parseStream(fs.readFileSync(path.join(dir, 'stream.jsonl'), 'utf8')).events;
const mark = (v) => (v === null ? 'n/a' : v ? 'yes' : 'NO');
const verdictOf = (v) => (v === null ? 'not-reached' : v ? 'met' : 'not-met');
// A run is early-stopped when the caller says so (--early yes), or bench stopped it (a stop reason, the stop watcher's
// earlyStopped flag or the credit limit).
const stoppedOf = (result, early) => early || Boolean(result.stopped) || (result.flags ?? []).some((f) => f === 'earlyStopped' || f === 'creditLimit');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function scoreTable(runs, early = false) {
  const rows = ['| task | expect | E1 Plan line | E2 early | E3 word | E4 Skills | E5 action | E6 gate line | E7 review | tools before first act |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const { dir, result } of runs) {
    const s = scoreRun({ events: eventsOf(dir), orch: result.orch, taskId: result.taskId, stopped: stoppedOf(result, early) });
    const m = Object.fromEntries(s.checks.map((c) => [c.id, c.met]));
    const e = EXPECT.tasks[result.taskId];
    const cell = (id) => (id in m ? mark(m[id]) : '-');
    rows.push(`| ${result.taskId} r${result.replicate ?? 1} | ${e.plan}, ${e.review} | ${['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'].map(cell).join(' | ')} | ${s.toolsBeforeFirstAct} |`);
  }
  return rows.join('\n');
}

const MANIFEST = 'manifest.json';
const readManifest = (dir) => (fs.existsSync(path.join(dir, MANIFEST)) ? JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')) : { entries: {} });

/**
 * Writes one reviewer prompt per run of `arm` under `runs` into `out`, named `<prefix>.<task>.r<rep>`, and records it in
 * out/manifest.json with its run dir, sha256 and deterministic score. `tasks` (a list) keeps only those tasks. A prompt
 * already in the manifest is kept as it is (frozen): the reviewers must read the same bytes on a rerun.
 */
function writePrompts({ runs, out, arm, prefix, tasks = null, early = false, log }) {
  fs.mkdirSync(out, { recursive: true });
  const m = readManifest(out);
  for (const { dir, result } of runsOf(runs, arm)) {
    if (tasks && !tasks.includes(result.taskId)) continue;
    const name = `${prefix ? `${prefix}.` : ''}${result.taskId}.r${result.replicate ?? 1}`;
    const f = path.join(out, `${name}.review-prompt.txt`);
    if (m.entries[name] && fs.existsSync(f)) { log(`${f} kept (frozen)`); continue; }
    const p = reviewPrompt({ taskId: result.taskId, taskPrompt: findTaskPrompt(result.taskId), transcript: transcriptOf(eventsOf(dir)) });
    const s = scoreRun({ events: eventsOf(dir), orch: result.orch, taskId: result.taskId, stopped: stoppedOf(result, early) });
    fs.writeFileSync(f, p);
    m.entries[name] = { taskId: result.taskId, replicate: result.replicate ?? 1, dir, file: path.basename(f), sha256: sha256(p), kchars: p.length / 1000,
      score: Object.fromEntries(s.checks.map((c) => [c.id, verdictOf(c.met)])) };
    log(`${f} ${(p.length / 1000).toFixed(1)}K chars`);
  }
  fs.writeFileSync(path.join(out, MANIFEST), `${JSON.stringify(m, null, 2)}\n`);
  return m;
}

/**
 * Whether one more early-stopped run may start: the runs' own ledgers under `runs` plus `runLimit` must stay within
 * `runCap`, and that plus the Claude reviewer's `ledger` within `cap`. Returns { ok, left } (the most the run may spend
 * under both) or { ok: false, why }.
 */
function mayRun({ runs, ledger, cap, runCap, runLimit }) {
  const r = runsSpent(runs);
  if (r.unknown) return { ok: false, why: `the run ledgers under ${runs} have ${r.unknown} entr(y/ies) of unknown cost; check them first` };
  const total = r.credits + ledgerSpent(ledger);
  if (r.credits + runLimit > runCap) return { ok: false, why: `run cap: ${r.credits} spent of ${runCap}, and one more run may cost up to ${runLimit}` };
  if (total + runLimit > cap) return { ok: false, why: `total cap: ${total} spent of ${cap}, and one more run may cost up to ${runLimit}` };
  return { ok: true, left: Math.round(Math.min(runCap - r.credits, cap - total) * 100) / 100 };
}

/**
 * Re-books early-stopped runs of `arm` under `runs` that an older bench charged at the censored floor although their
 * session wrote a creditSplit (D-299; the reply check's t12-mux-parallel-merge r1 of 2026-11-28, booked 1.0, measured
 * 1.642). Each such run keeps its cell (its stream and frozen prompt are the result) and gets a top-up line, measured
 * minus booked, in runs/rebooked/<cell>/credit-ledger.jsonl, once. Returns [{ cell, booked, measured, topUp }].
 */
function rebookEarly({ runs, arm, apply = false }) {
  const { makeSplitReader } = require('../../runner/lib/credit-watch.js');
  const out = [];
  for (const { dir, result: r } of runsOf(runs, arm)) {
    if (!(r.flags ?? []).includes('earlyStopped') || r.creditMeasured != null || r.credits != null) continue;
    const measured = makeSplitReader(path.join(dir, 'session'), { flat: true }).read();
    if (measured == null) continue;
    const cell = path.resolve(dir, '..', '..', '..');
    const name = path.relative(runs, cell).split(path.sep).join('-');
    const booked = path.join(runs, 'rebooked', name);
    if (fs.existsSync(booked)) continue;
    const m = Math.ceil(measured * 1000) / 1000;
    const item = { cell: name, booked: r.creditsCharged ?? 0, measured: m, topUp: Math.round((m - (r.creditsCharged ?? 0)) * 1000) / 1000 };
    if (item.topUp <= 0) continue;
    if (apply) {
      fs.mkdirSync(booked, { recursive: true });
      const line = { at: new Date().toISOString(), kind: 'run', unit: 'credits', arm: r.armId, task: r.taskId, replicate: r.replicate ?? null, status: r.status,
        credits: item.topUp, charged: item.topUp, censored: false, rebooked: { booked: item.booked, measured: m, from: name, reason: 'D-299 early stop booked at the floor' } };
      fs.appendFileSync(path.join(booked, 'credit-ledger.jsonl'), `${JSON.stringify(line)}\n`);
    }
    out.push(item);
  }
  return out;
}

class UsageError extends Error {}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new UsageError(`bad argument ${rest[i]}`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  return { cmd, opts };
}

const need = (opts, ...keys) => { for (const k of keys) if (opts[k] === undefined) throw new UsageError(`--${k} is required`); };

function main(argv, log = console.log) {
  const { cmd, opts } = parseArgs(argv);
  const arm = opts.arm ?? 'konductor-adaptive';
  const early = opts.early === 'yes';
  if (cmd === 'score') {
    const table = scoreTable(runsOf(opts.runs, arm), early);
    if (opts.out) fs.writeFileSync(opts.out, `${table}\n`);
    log(table);
  } else if (cmd === 'prompts') {
    need(opts, 'runs', 'out');
    writePrompts({ runs: opts.runs, out: opts.out, arm, prefix: opts.prefix ?? '', tasks: opts.tasks ? opts.tasks.split(',') : null, early, log });
  } else if (cmd === 'plan') {
    const tasks = opts.tasks === 'smoke' ? SMOKE : opts.tasks === 'all' ? Object.keys(EXPECT.tasks) : opts.tasks.split(',');
    tasks.forEach(expectationsFor);
    const existing = opts.runs ? runsOf(opts.runs, arm).length : 0;
    const p = paidPlan({ tasks, reps: Number(opts.reps), runLimit: Number(opts['run-limit']), existing, promptKChars: Number(opts['prompt-kchars'] ?? 12) });
    log(JSON.stringify(p, null, 2));
  } else if (cmd === 'may-run') {
    need(opts, 'runs', 'ledger', 'cap', 'run-cap', 'run-limit');
    const r = mayRun({ runs: opts.runs, ledger: opts.ledger, cap: Number(opts.cap), runCap: Number(opts['run-cap']), runLimit: Number(opts['run-limit']) });
    log(r.ok ? `left ${r.left}` : r.why);
    return r.ok ? 0 : 1;
  } else if (cmd === 'rebook-early') {
    need(opts, 'runs');
    const apply = opts.apply === 'yes';
    const done = rebookEarly({ runs: opts.runs, arm, apply });
    for (const x of done) log(`${x.cell}: early stop booked ${x.booked}, measured ${x.measured}; ${apply ? 'booked' : 'would book'} ${x.topUp} more`);
    if (!done.length) log('no early stop to re-book');
  } else if (cmd === 'review') {
    need(opts, 'prompts', 'out', 'claude', 'cap', 'runs', 'cap-usd', 'work');
    const cap = Number(opts.cap); const capUsd = Number(opts['cap-usd']);
    if (!(cap > 0) || !(capUsd > 0)) throw new UsageError('--cap and --cap-usd must be positive numbers');
    const rv = require('./reply-review.js');
    return rv.review({ promptsDir: opts.prompts, out: opts.out, claudeModel: opts.claude, capCredits: cap, runsDir: opts.runs, capUsd, workDir: opts.work,
      kiroBin: opts['kiro-bin'], authDb: opts['auth-db'], panelCaller: rv.panelCallerOf(opts), log }).then(() => 0);
  } else if (cmd === 'compare') {
    need(opts, 'prompts', 'reviews');
    const md = require('./reply-review.js').compare({ promptsDir: opts.prompts, reviewsDir: opts.reviews });
    if (opts.out) fs.writeFileSync(opts.out, md);
    log(md);
  } else {
    throw new UsageError('usage: reply-check.js score|prompts|plan|may-run|rebook-early|review|compare (see the header)');
  }
  return 0;
}

if (require.main === module) {
  Promise.resolve().then(() => main(process.argv.slice(2))).then((code) => { process.exitCode = code; }, (err) => {
    console.error(err.message);
    process.exitCode = err instanceof UsageError ? 64 : 1;
  });
}

module.exports = { expectationsFor, timeline, scoreRun, transcriptOf, reviewPrompt, checkReview, paidPlan, panelCallUsd, writePrompts, readManifest, sha256, mayRun, rebookEarly, main, SMOKE, PANEL, MANIFEST };
