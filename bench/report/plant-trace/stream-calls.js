// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the agent's own stream says about its plant calls: which calls it made, what it sent, what it saw back, and the
// tokens it used. The stream is never trusted for safety; the gateway log is the truth and this only decorates it.

const { argsSha256, streamArgs } = require('../../runner/lib/plant/canonical.js');
const { streamCallsOf } = require('../../runner/lib/plant/stream-match.js');
const { SERVER_NAME } = require('../../runner/lib/plant/agent-file.js');
const { TOOLS } = require('../../runner/lib/plant/meta.js');
const { PlantTraceError } = require('./load.js');

const MAX_TEXT = 2000;
const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}... [cut]` : s);
const CLAUDE_PREFIX = `mcp__${SERVER_NAME}__`;

/**
 * Token facts of a run, in one shape for every harness: `{mode, note, total, byCall}`.
 * `mode` is `per-step` (`byCall` maps a stream call id to `{input, output, cacheRead, cacheWrite}`, or to `{sameCall: true}`
 * when a model call made several tool calls and the first one carries its tokens), `run-total` (only `total` is known)
 * or `not-recorded` (the stream has no token counts). `note` says why, for the page.
 */
const tokens = (mode, note, total = null, byCall = new Map()) => ({ mode, note, total, byCall });

const textOfUpdate = (u) => clip((u.content ?? []).map((c) => c?.content?.text ?? c?.text).filter((t) => typeof t === 'string').join('\n'));

/** Kiro ACP stream: what the agent sent and saw for each plant call, by tool call id. Kiro records no per-request tokens. */
function kiroTrace(events) {
  const { calls } = streamCallsOf('kiro-acp', events);
  const wanted = new Set(calls.map((c) => c.toolCallId));
  const seen = new Map();
  for (const u of events.map((e) => e?.data?.update)) {
    if (!wanted.has(u?.toolCallId)) continue;
    const now = seen.get(u.toolCallId) ?? { args: null, resultText: null };
    if (u.sessionUpdate === 'tool_call') now.args = streamArgs(u.rawInput);
    if (u.sessionUpdate === 'tool_call_update' && u.status === 'completed') now.resultText = textOfUpdate(u);
    seen.set(u.toolCallId, now);
  }
  return { calls, seen, tokens: tokens('not-recorded', 'not recorded for Kiro: the stream has no per-request token counts') };
}

/** Strands trace: the model's tool uses and the results the agent saw. The adapter writes one `usage` line for the whole run. */
function strandsTrace(events) {
  const { calls } = streamCallsOf('strands-jsonl', events);
  const wanted = new Set(calls.map((c) => c.toolCallId));
  const seen = new Map();
  for (const e of events) {
    if (!wanted.has(e?.toolUseId)) continue;
    const now = seen.get(e.toolUseId) ?? { args: null, resultText: null };
    if (e.type === 'model_tool_use') now.args = e.input;
    if (e.type === 'tool_result') now.resultText = clip(JSON.stringify(e.content ?? null));
    seen.set(e.toolUseId, now);
  }
  const usage = events.findLast((e) => e?.type === 'usage');
  const total = usage ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, modelCalls: usage.modelCalls ?? null } : null;
  return { calls, seen, tokens: tokens('run-total', 'Strands records one usage line for the whole run, not one per step', total) };
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

/** Claude Code stream: plant calls are `mcp__plant__<tool>` tool_use blocks; each message's usage goes to its first plant call. */
function claudeTrace(events) {
  const usage = usageByMessage(events);
  const calls = [];
  const seen = new Map();
  const byCall = new Map();
  const carried = new Set();
  for (const e of events.filter((x) => x?.type === 'assistant')) {
    for (const b of blocksOf(e).filter((x) => x?.type === 'tool_use' && x.name?.startsWith(CLAUDE_PREFIX))) {
      const tool = b.name.slice(CLAUDE_PREFIX.length);
      if (calls.some((c) => c.toolCallId === b.id)) continue;
      calls.push({ toolCallId: b.id, tool: TOOLS.includes(tool) ? tool : null, argsSha256: argsSha256(b.input ?? {}), engine: 'claude' });
      seen.set(b.id, { args: b.input ?? {}, resultText: null });
      const id = e.message.id;
      byCall.set(b.id, carried.has(id) || !usage.has(id) ? { sameCall: true } : usage.get(id));
      carried.add(id);
    }
  }
  for (const b of events.filter((x) => x?.type === 'user').flatMap(blocksOf).filter((x) => x?.type === 'tool_result')) {
    if (seen.has(b.tool_use_id)) seen.get(b.tool_use_id).resultText = clip(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? null));
  }
  const total = [...usage.values()].reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output }), { input: 0, output: 0 });
  return { calls, seen, tokens: tokens('per-step', 'from each assistant message; a message with several plant calls shows its tokens on the first', total, byCall) };
}

const READERS = { 'kiro-acp': kiroTrace, 'strands-jsonl': strandsTrace, 'claude-stream-json': claudeTrace };

/**
 * `{calls, seen, tokens}` for the plant calls in `events`, a parsed agent stream of format `format`.
 * `calls` are `{toolCallId, tool, argsSha256, engine}` in stream order (what `matchCalls` takes), `seen` maps a call id to
 * `{args, resultText}` and `tokens` is described at `tokens` above. Throws PlantTraceError for a stream format with no reader.
 */
function streamTrace(format, events) {
  const read = READERS[format];
  if (!read) throw new PlantTraceError(`stream format ${format} has no plant trace reader (known: ${Object.keys(READERS).join(', ')})`);
  return read(events);
}

module.exports = { streamTrace };
