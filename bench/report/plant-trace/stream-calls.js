// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the agent's own stream says about its plant calls: which calls it made, what it sent, what it saw back, the
// tokens it used, and which child agent made each call. The stream is never trusted for safety; the gateway log is the
// truth and this only decorates it. A child is linked to its parent only by an id field the harness writes, never by time.

const { argsSha256, streamArgs } = require('../../runner/lib/plant/canonical.js');
const { streamCallsOf } = require('../../runner/lib/plant/stream-match.js');
const { SERVER_NAME } = require('../../runner/lib/plant/agent-file.js');
const { ALL_TOOLS } = require('../../runner/lib/plant/meta.js');
const { toolNameOf, subagentTargets, isV3Call, SUBAGENT_TOOL } = require('../../runner/lib/stream.js');
const { SUBAGENT_TOOLS } = require('../../plugins/claude-code/parse.js');
const { PlantTraceError } = require('./load.js');

const MAX_TEXT = 2000;
const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}... [cut]` : s);
const CLAUDE_PREFIX = `mcp__${SERVER_NAME}__`;
const V3_SUBAGENT_PREFIX = 'Sub-agent: ';

/**
 * Token facts of a run, in one shape for every harness: `{mode, note, total, byCall}`.
 * `mode` is `per-step` (`byCall` maps a stream call id to `{input, output, cacheRead, cacheWrite}`, or to `{sameCall: true}`
 * when a model call made several tool calls and the first one carries its tokens), `run-total` (only `total` is known)
 * or `not-recorded` (the stream has no token counts). `note` says why, for the page.
 */
const tokens = (mode, note, total = null, byCall = new Map()) => ({ mode, note, total, byCall });

/**
 * What a reader returns besides the calls: `seen` maps a plant call id to `{args, resultText, raw, parentId, order}`
 * (`raw` is the stream event that started the call, `parentId` the child agent that made it or null, `order` its place in
 * the stream); `agents` lists each child agent as `{id, name, parentId, order}`.
 */
const newSeen = (raw, order, parentId = null) => ({ args: null, resultText: null, raw, parentId, order });

const textOfUpdate = (u) => clip((u.content ?? []).map((c) => c?.content?.text ?? c?.text).filter((t) => typeof t === 'string').join('\n'));

/** The child agent a Kiro `subagent` call starts, or null when the call carries no `agentSubtaskId` to link its calls by. */
function kiroAgentOf(u, order) {
  const id = u._meta?.kiro?.agentSubtaskId;
  if (toolNameOf(u) !== SUBAGENT_TOOL || typeof id !== 'string') return null;
  const titled = typeof u.title === 'string' && u.title.startsWith(V3_SUBAGENT_PREFIX) ? u.title.slice(V3_SUBAGENT_PREFIX.length) : null;
  // shortcut: Kiro writes the new child's id on a subagent call, not its caller's, so a child started by a child sits at
  // the top; nest it when Kiro names the caller.
  return { id, name: titled ?? subagentTargets(u.rawInput, { nameIsAgent: isV3Call(u) })[0], parentId: null, order };
}

/**
 * Kiro ACP stream: what the agent sent and saw for each plant call, by tool call id. A call made by a child agent carries
 * that child's `_meta.kiro.agentSubtaskId`, the same id its `subagent` call carries. Kiro records no per-request tokens.
 */
function kiroTrace(events) {
  const { calls } = streamCallsOf('kiro-acp', events);
  const wanted = new Set(calls.map((c) => c.toolCallId));
  const seen = new Map();
  const agents = [];
  const updates = events.map((e) => e?.data?.update);
  updates.forEach((u, order) => {
    if (u?.sessionUpdate !== 'tool_call') return;
    const agent = kiroAgentOf(u, order);
    if (agent && !agents.some((a) => a.id === agent.id)) agents.push(agent);
  });
  const known = new Set(agents.map((a) => a.id));
  updates.forEach((u, order) => {
    if (!wanted.has(u?.toolCallId)) return;
    if (u.sessionUpdate === 'tool_call' && !seen.has(u.toolCallId)) {
      const sub = u._meta?.kiro?.agentSubtaskId;
      seen.set(u.toolCallId, { ...newSeen(events[order], order, known.has(sub) ? sub : null), args: streamArgs(u.rawInput) });
    }
    if (u.sessionUpdate === 'tool_call_update' && u.status === 'completed' && seen.has(u.toolCallId)) seen.get(u.toolCallId).resultText = textOfUpdate(u);
  });
  return { calls, seen, agents, tokens: tokens('not-recorded', 'not recorded for Kiro: the stream has no per-request token counts') };
}

/** Strands trace: the model's tool uses and the results the agent saw. One agent, no children. One `usage` line per run. */
function strandsTrace(events) {
  const { calls } = streamCallsOf('strands-jsonl', events);
  const wanted = new Set(calls.map((c) => c.toolCallId));
  const seen = new Map();
  events.forEach((e, order) => {
    if (!wanted.has(e?.toolUseId)) return;
    if (e.type === 'model_tool_use' && !seen.has(e.toolUseId)) seen.set(e.toolUseId, { ...newSeen(e, order), args: e.input });
    if (e.type === 'tool_result' && seen.has(e.toolUseId)) seen.get(e.toolUseId).resultText = clip(JSON.stringify(e.content ?? null));
  });
  const usage = events.findLast((e) => e?.type === 'usage');
  const total = usage ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, modelCalls: usage.modelCalls ?? null } : null;
  return { calls, seen, agents: [], tokens: tokens('run-total', 'Strands records one usage line for the whole run, not one per step', total) };
}

const blocksOf = (e) => (Array.isArray(e?.message?.content) ? e.message.content : []);
const num = (v) => (Number.isFinite(v) ? v : 0);

/** The largest value seen per field for each message id: Claude Code writes one event per content block and output tokens grow. */
function usageByMessage(events) {
  const byId = new Map();
  for (const e of events.filter((x) => x?.type === 'assistant' && x.message?.id)) {
    const u = e.message.usage ?? {};
    const cur = byId.get(e.message.id) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    cur.input = Math.max(cur.input, num(u.input_tokens));
    cur.output = Math.max(cur.output, num(u.output_tokens));
    cur.cacheRead = Math.max(cur.cacheRead, num(u.cache_read_input_tokens));
    cur.cacheWrite = Math.max(cur.cacheWrite, num(u.cache_creation_input_tokens));
    byId.set(e.message.id, cur);
  }
  return byId;
}

/**
 * Claude Code stream: plant calls are `mcp__plant__<tool>` tool_use blocks; each message's usage goes to its first plant
 * call. A child agent is a `Task` or `Agent` tool_use; every event the child writes carries `parent_tool_use_id` set to
 * that tool_use's id, so children nest to any depth.
 */
function claudeTrace(events) {
  const usage = usageByMessage(events);
  const calls = [];
  const seen = new Map();
  const agents = [];
  const byCall = new Map();
  const carried = new Set();
  events.forEach((e, order) => {
    if (e?.type !== 'assistant') return;
    const parentId = e.parent_tool_use_id ?? null;
    for (const b of blocksOf(e).filter((x) => x?.type === 'tool_use' && x.id)) {
      if (SUBAGENT_TOOLS.has(b.name) && !agents.some((a) => a.id === b.id)) agents.push({ id: b.id, name: b.input?.subagent_type ?? '(unnamed)', parentId, order });
      if (!b.name?.startsWith(CLAUDE_PREFIX) || seen.has(b.id)) continue;
      const tool = b.name.slice(CLAUDE_PREFIX.length);
      calls.push({ toolCallId: b.id, tool: ALL_TOOLS.includes(tool) ? tool : null, argsSha256: argsSha256(b.input ?? {}), engine: 'claude' });
      seen.set(b.id, { ...newSeen(e, order, parentId), args: b.input ?? {} });
      const id = e.message.id;
      byCall.set(b.id, carried.has(id) || !usage.has(id) ? { sameCall: true } : usage.get(id));
      carried.add(id);
    }
  });
  for (const b of events.filter((x) => x?.type === 'user').flatMap(blocksOf).filter((x) => x?.type === 'tool_result')) {
    if (seen.has(b.tool_use_id)) seen.get(b.tool_use_id).resultText = clip(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? null));
  }
  const total = [...usage.values()].reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output }), { input: 0, output: 0 });
  return { calls, seen, agents, tokens: tokens('per-step', 'from each assistant message; a message with several plant calls shows its tokens on the first', total, byCall) };
}

const READERS = { 'kiro-acp': kiroTrace, 'strands-jsonl': strandsTrace, 'claude-stream-json': claudeTrace };

/**
 * `{calls, seen, agents, tokens}` for the plant calls in `events`, a parsed agent stream of format `format`.
 * `calls` are `{toolCallId, tool, argsSha256, engine}` in stream order (what `matchCalls` takes); `seen` and `agents` are
 * described at `newSeen`, `tokens` at `tokens` above. Throws PlantTraceError for a stream format with no reader.
 */
function streamTrace(format, events) {
  const read = READERS[format];
  if (!read) throw new PlantTraceError(`stream format ${format} has no plant trace reader (known: ${Object.keys(READERS).join(', ')})`);
  return read(events);
}

module.exports = { streamTrace };
