#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reply check for the prompt-fix adaptive arm: does the root reply carry the lines the arm asks for (Plan, Skills,
// Review gate), in the right place, with the pre-registered solo or team choice? A diagnostic, not a counted verdict.
//   node reply-check.js score   --runs DIR [--arm konductor-adaptive] [--out FILE]   free: deterministic checks E1 to E7
//   node reply-check.js prompts --runs DIR --out DIR [--arm konductor-adaptive]      free: the frozen reviewer prompts
//   node reply-check.js plan    --tasks smoke|all|ID,ID --reps N --run-limit N [--runs DIR]   free: paid call count and cost
// The paid steps (early-stopped live runs, then one Claude reviewer and the non-Claude panel on the same prompts) are
// not run here; the owner approves a cap first (reports/adaptive-prompt-cap-check-2026-11-27.md).

const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../../runner/lib/stream.js');
const { linesOf, EXPECT } = require('../../runner/lib/plan-call.js');
const { loadObserved, lookup } = require('../../judge/observed-cost.js');

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

const isSub = (u) => u?._meta?.kiro?.kind === 'agent-subtask' || Boolean(u?._meta?.kiro?.agentSubtaskId);
// shortcut: a shell command is an act when it matches common write verbs; a write this misses only makes E2 and E4
// lenient. Upgrade to the sandbox's file diff when a run needs exact first-write timing.
const SHELL_WRITE = /(^|[;&|]\s*)(sed\s+-i|tee\b|mv\b|cp\b|rm\b|mkdir\b|touch\b|git\s+(commit|merge|worktree\s+add|checkout\s+-b|switch\s+-c|apply|am)\b|tmux\s+new)|[^<>2&]>{1,2}\s*[^&\s]/;

/** The root session in order: its reply text, and its tool calls with whether each is an act (write, edit or spawn). */
function timeline(events) {
  let text = '';
  const tools = [];
  for (const ev of events ?? []) {
    const u = ev.data?.update;
    if (ev.type !== 'sessionUpdate' || !u || isSub(u)) continue;
    if (u.sessionUpdate === 'agent_message_chunk' && typeof u.content?.text === 'string') text += u.content.text;
    else if (u.sessionUpdate === 'tool_call') {
      const spawn = String(u.toolCallId ?? '').startsWith('invoke_subagent') || /^Sub-agent/.test(u.title ?? '');
      const cmd = u.rawInput?.command;
      const act = !spawn && (['edit', 'delete', 'move'].includes(u.kind) || (typeof cmd === 'string' && SHELL_WRITE.test(cmd)));
      tools.push({ at: text.length, title: u.title ?? '', input: u.rawInput ?? null, act, spawn });
    }
  }
  const first = tools.find((t) => t.act || t.spawn);
  return { text, tools, firstActAt: first ? first.at : null };
}

const firstLineAt = (text, label) => {
  const m = new RegExp(`^[ \\t>*_-]*${label}:`, 'im').exec(text);
  return m ? m.index : null;
};

/**
 * Scores one run against its task's checks. `orch`: result.orch (makerSpawns, reviewerSpawns). `stopped`: the run was
 * stopped early, so E5 to E7 (which need the end of the run) are null. Returns { checks: [{ id, met, evidence }], toolsBeforeFirstAct }.
 */
function scoreRun({ events, orch, taskId, stopped = false }) {
  const e = EXPECT.tasks[taskId];
  const t = timeline(events);
  const plans = linesOf(t.text, 'Plan');
  const planAt = firstLineAt(t.text, 'Plan');
  const skillsAt = firstLineAt(t.text, 'Skills');
  const word = plans[0] ? /^Plan:\s*(solo|team)\b/i.exec(plans[0])?.[1]?.toLowerCase() ?? null : null;
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
  const evidence = { E1: plans[0] ?? 'no Plan line', E2: `Plan at ${planAt}, first act at ${t.firstActAt}`, E3: word ?? 'no plan word',
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

The agent's instructions ask for: a \`Plan: solo, because ...\` or \`Plan: team (<agents>), because ...\` line before its first write or spawn; a \`Skills: <names>\` or \`Skills: none fit\` line before its first write or spawn; and, in every final reply after a file change, a last line \`Review gate: ran <agent>\` or \`Review gate: not needed, <exemption>, <diff stat>\`.

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
    const e = lookup(observed, 'opencode', j, 'rubric') ?? lookup(observed, 'opencode', '*', 'rubric');
    const m = e.perUnit ? e.perUnit.fixed + e.perUnit.perKChar * promptKChars : e.mean;
    mid += m;
    high += e.perUnit ? m * e.perUnit.highRatio : Math.max(e.p90 ?? m, m);
  }
  return {
    runs, runCredits: runs * runLimit, outputs, claudeCalls: outputs, claudeCredits: outputs * CLAUDE_PER_CALL,
    panel: PANEL, panelCalls: outputs * PANEL.length, panelCallsWorst: outputs * PANEL.length * 2,
    panelUsdMid: Number((outputs * mid).toFixed(4)), panelUsdHigh: Number((outputs * high * 2).toFixed(4)),
  };
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
  return out.sort((a, b) => a.result.taskId.localeCompare(b.result.taskId));
}

const eventsOf = (dir) => parseStream(fs.readFileSync(path.join(dir, 'stream.jsonl'), 'utf8')).events;
const mark = (v) => (v === null ? 'n/a' : v ? 'yes' : 'NO');

function scoreTable(runs) {
  const rows = ['| task | expect | E1 Plan line | E2 early | E3 word | E4 Skills | E5 action | E6 gate line | E7 review | tools before first act |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const { dir, result } of runs) {
    const s = scoreRun({ events: eventsOf(dir), orch: result.orch, taskId: result.taskId, stopped: Boolean(result.stopped) });
    const m = Object.fromEntries(s.checks.map((c) => [c.id, c.met]));
    const e = EXPECT.tasks[result.taskId];
    const cell = (id) => (id in m ? mark(m[id]) : '-');
    rows.push(`| ${result.taskId} r${result.replicate ?? 1} | ${e.plan}, ${e.review} | ${['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'].map(cell).join(' | ')} | ${s.toolsBeforeFirstAct} |`);
  }
  return rows.join('\n');
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error(`bad argument ${rest[i]}`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  return { cmd, opts };
}

function main(argv, log = console.log) {
  const { cmd, opts } = parseArgs(argv);
  const arm = opts.arm ?? 'konductor-adaptive';
  if (cmd === 'score') {
    const table = scoreTable(runsOf(opts.runs, arm));
    if (opts.out) fs.writeFileSync(opts.out, `${table}\n`);
    log(table);
  } else if (cmd === 'prompts') {
    fs.mkdirSync(opts.out, { recursive: true });
    for (const { dir, result } of runsOf(opts.runs, arm)) {
      const p = reviewPrompt({ taskId: result.taskId, taskPrompt: findTaskPrompt(result.taskId), transcript: transcriptOf(eventsOf(dir)) });
      const f = path.join(opts.out, `${result.taskId}.r${result.replicate ?? 1}.review-prompt.txt`);
      fs.writeFileSync(f, p);
      log(`${f} ${(p.length / 1000).toFixed(1)}K chars`);
    }
  } else if (cmd === 'plan') {
    const tasks = opts.tasks === 'smoke' ? SMOKE : opts.tasks === 'all' ? Object.keys(EXPECT.tasks) : opts.tasks.split(',');
    tasks.forEach(expectationsFor);
    const existing = opts.runs ? runsOf(opts.runs, arm).length : 0;
    const p = paidPlan({ tasks, reps: Number(opts.reps), runLimit: Number(opts['run-limit']), existing, promptKChars: Number(opts['prompt-kchars'] ?? 12) });
    log(JSON.stringify(p, null, 2));
  } else {
    throw new Error('usage: reply-check.js score|prompts|plan (see the header)');
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(64); }
}

module.exports = { expectationsFor, timeline, scoreRun, transcriptOf, reviewPrompt, checkReview, paidPlan, SMOKE, PANEL };
