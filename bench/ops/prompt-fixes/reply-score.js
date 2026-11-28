// SPDX-License-Identifier: Apache-2.0
'use strict';

// The free half of the reply check: reads a run's root session, scores it against its task's checks (E1 to E7), and
// writes the transcript and the prompt each reviewer reads.

const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../../runner/lib/stream.js');
const { rootReply, linesOf, planWord, firstPlanLine, EXPECT } = require('../../runner/lib/plan-call.js');
const { expectationsFor } = require('./reply-manifest.js');

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

module.exports = { timeline, scoreRun, transcriptOf, reviewPrompt, runsOf, eventsOf, verdictOf, stoppedOf, scoreTable };
