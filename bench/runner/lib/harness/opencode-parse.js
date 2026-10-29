// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads what an `opencode run --format json` call leaves behind. The event stream only carries the
// parent session; subagent sessions exist only in the SQLite database, linked by parent_id.

const { detectAskedUser } = require('../stream.js');

const SUBAGENT_TOOL = 'task';

const SQL = {
  sessions: 'select id, parent_id, agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, title from session order by time_created',
  messages: "select session_id, count(*) as n from message where json_extract(data, '$.role') = 'assistant' group by session_id",
  tools: "select session_id, json_extract(data, '$.tool') as tool, count(*) as n from part where json_extract(data, '$.type') = 'tool' group by session_id, tool",
};

// opencode's own total: reasoning tokens are already inside output.
const totalTokens = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;

const zeroTokens = () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

function addStepTokens(sum, t = {}) {
  sum.input += t.input || 0;
  sum.output += t.output || 0;
  sum.reasoning += t.reasoning || 0;
  sum.cacheRead += t.cache?.read || 0;
  sum.cacheWrite += t.cache?.write || 0;
}

const errorText = (e) => e?.error?.data?.message ?? e?.error?.message ?? e?.error?.name ?? 'unknown error';

/** Parent-session view from the event stream: used for the final text, timing and as a cross-check. */
function aggregateEvents(events) {
  const out = {
    sessionId: null, steps: 0, tokens: zeroTokens(), costUsd: 0, toolCalls: 0, toolNames: {},
    runFinishedStatus: null, stopReason: null, finalText: null, lastText: null, errors: [], turnDurationMs: null, askedUser: null,
  };
  let lastReason = null;
  let first = null;
  let last = null;
  for (const ev of events) {
    out.sessionId = out.sessionId ?? ev.sessionID ?? null;
    if (typeof ev.timestamp === 'number') { first = first ?? ev.timestamp; last = ev.timestamp; }
    if (ev.sessionID && out.sessionId && ev.sessionID !== out.sessionId) continue;
    const p = ev.part || {};
    if (ev.type === 'step_finish') {
      out.steps++;
      lastReason = p.reason ?? null;
      addStepTokens(out.tokens, p.tokens);
      out.costUsd += Number(p.cost) || 0;
    } else if (ev.type === 'tool_use') {
      out.toolCalls++;
      out.toolNames[p.tool ?? 'unknown'] = (out.toolNames[p.tool ?? 'unknown'] || 0) + 1;
    } else if (ev.type === 'text' && typeof p.text === 'string') {
      out.lastText = p.text;
    } else if (ev.type === 'error') {
      out.errors.push(errorText(ev));
    }
  }
  if (out.errors.length) out.runFinishedStatus = 'error';
  else if (lastReason && lastReason !== 'tool-calls') out.runFinishedStatus = 'success';
  out.finalText = out.runFinishedStatus === null ? null : out.lastText;
  out.stopReason = out.runFinishedStatus === null ? null : lastReason === 'stop' ? 'end_turn' : lastReason;
  out.turnDurationMs = out.runFinishedStatus === null || first === null ? null : last - first;
  out.askedUser = detectAskedUser(out);
  return out;
}

function parseModel(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Adds up the root session and all its descendants from the rows of the session, message and part tables.
 * Sessions outside that tree are listed in orphanSessions and not counted. Null when there are no sessions.
 */
function rollUp({ sessions, messages, tools }, rootHint = null) {
  if (!sessions.length) return null;
  const rootId = sessions.some((s) => s.id === rootHint) ? rootHint : (sessions.find((s) => !s.parent_id) ?? sessions[0]).id;
  const inTree = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of sessions) if (!inTree.has(s.id) && inTree.has(s.parent_id)) { inTree.add(s.id); grew = true; }
  }
  const tokens = zeroTokens();
  let costUsd = 0;
  const models = new Set();
  const variants = new Set();
  for (const s of sessions.filter((x) => inTree.has(x.id))) {
    tokens.input += s.tokens_input || 0;
    tokens.output += s.tokens_output || 0;
    tokens.reasoning += s.tokens_reasoning || 0;
    tokens.cacheRead += s.tokens_cache_read || 0;
    tokens.cacheWrite += s.tokens_cache_write || 0;
    costUsd += Number(s.cost) || 0;
    const m = parseModel(s.model);
    if (m?.id) models.add(m.id);
    if (m?.variant) variants.add(m.variant);
  }
  const toolNames = {};
  for (const t of tools.filter((x) => inTree.has(x.session_id))) toolNames[t.tool ?? 'unknown'] = (toolNames[t.tool ?? 'unknown'] || 0) + t.n;
  const toolCalls = Object.values(toolNames).reduce((a, b) => a + b, 0);
  const subagentCalls = toolNames[SUBAGENT_TOOL] || 0;
  const rootRow = sessions.find((s) => s.id === rootId);
  return {
    rootId,
    rootModel: parseModel(rootRow.model)?.id ?? null,
    root: {
      costUsd: Number(rootRow.cost) || 0,
      tokens: { input: rootRow.tokens_input || 0, output: rootRow.tokens_output || 0, reasoning: rootRow.tokens_reasoning || 0, cacheRead: rootRow.tokens_cache_read || 0, cacheWrite: rootRow.tokens_cache_write || 0 },
    },
    sessions: inTree.size,
    orphanSessions: sessions.filter((s) => !inTree.has(s.id)).map((s) => s.id),
    tokens,
    costUsd,
    modelCalls: messages.filter((m) => inTree.has(m.session_id)).reduce((a, m) => a + m.n, 0),
    toolCalls,
    workToolCalls: toolCalls - subagentCalls,
    subagentCalls,
    toolNames: Object.fromEntries(Object.entries(toolNames).sort(([a], [b]) => a.localeCompare(b))),
    models: [...models].sort(),
    variants: [...variants].sort(),
  };
}

/** `runDb(sql)` returns the rows of a read-only query (in production: `opencode db <sql> --format json`). */
function queryRollup(runDb, rootHint = null) {
  return rollUp({ sessions: runDb(SQL.sessions), messages: runDb(SQL.messages), tools: runDb(SQL.tools) }, rootHint);
}

module.exports = { aggregateEvents, rollUp, queryRollup, totalTokens, zeroTokens, SQL, SUBAGENT_TOOL };
