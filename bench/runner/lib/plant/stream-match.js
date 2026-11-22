// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pairs plant calls in the agent's stream with gateway `call` events as a multiset of (tool, canonical args).
// Equal keys are interchangeable; a call on one side only is a mismatch. Never trusts the stream for safety.

const { argsSha256, canonicalArgs, streamArgs } = require('./canonical.js');
const { SERVER_NAME } = require('./agent-file.js');
const { ALL_TOOLS } = require('./meta.js');
const { censusProblems } = require('./strands-adapter.js');
const { isV3Call, mcpCallOf, mcpInputOf } = require('../stream.js');
const { callIdOf } = require('./log-rules.js');

/**
 * How each engine names a plant call in a `tool_call` update. `isPlant` says the call went to the plant server;
 * `tool` reads its tool name, or null when it cannot be read. Engine v2 names both in `_meta.kiro`. Engine v3 titles
 * the call `@plant/<tool>` (or wraps a deferred call as `Tool Call` with `tool::plant::<tool>`), and may also say
 * `_meta.kiro.serverName`. A v3 `Tool Load` of `tool::plant::<tool>` only loads a schema and is not a plant call.
 */
const ENGINES = [
  {
    engine: 'v2',
    is: (u) => !isV3Call(u),
    isPlant: (u) => u._meta.kiro.mcpServerName === SERVER_NAME,
    tool: (u) => u._meta.kiro.toolName,
    args: (u) => streamArgs(u.rawInput),
  },
  {
    engine: 'v3',
    is: isV3Call,
    isPlant: (u) => u._meta?.kiro?.serverName === SERVER_NAME || mcpCallOf(u)?.server === SERVER_NAME,
    tool: (u) => {
      const mcp = mcpCallOf(u);
      return mcp?.server === SERVER_NAME ? mcp.tool : null;
    },
    // A titled call's rawInput is the arguments as sent; a deferred `Tool Call` wraps them as {tool_id, arguments}.
    args: (u) => streamArgs(mcpInputOf(u.rawInput)),
  },
];

/**
 * Plant tool calls in parsed stream `events`: `{toolCallId, tool, argsSha256, engine}` in stream order. A plant-server
 * call whose tool cannot be read keeps `tool: null`, so it never pairs with a gateway call and stays a mismatch.
 */
function plantCallsInStream(events) {
  const calls = [];
  for (const u of events.map((e) => e?.data?.update)) {
    if (u?.sessionUpdate !== 'tool_call') continue;
    const reader = ENGINES.find((r) => r.is(u));
    if (!reader.isPlant(u)) continue;
    calls.push({ toolCallId: u.toolCallId, tool: reader.tool(u) ?? null, argsSha256: argsSha256(reader.args(u)), engine: reader.engine });
  }
  return calls;
}

// Claude Code names an MCP tool `mcp__<server>__<tool>`; the plant shim is server `plant` (kind A, like Kiro CLI).
const CLAUDE_PLANT_PREFIX = `mcp__${SERVER_NAME}__`;

/**
 * Plant tool calls in a parsed Claude Code stream (`claude-stream-json`): `{toolCallId, tool, argsSha256, engine}` in
 * stream order. A plant call is a `tool_use` block in an `assistant` event whose name starts with `mcp__plant__`; the
 * tool is the rest of the name, keyed by its input as canonical args, so it pairs with the gateway the same way a Kiro
 * call does. A `mcp__plant__` name with nothing after it keeps `tool: null` and stays a mismatch. No adapter census:
 * unlike Strands, Claude Code has no tool-event hook that can rewrite or retry a call, so the MCP shim and the gateway
 * log are the trust boundary.
 */
function plantCallsInClaudeStream(events) {
  const calls = [];
  for (const ev of events) {
    if (ev?.type !== 'assistant' || !Array.isArray(ev?.message?.content)) continue;
    for (const b of ev.message.content) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string' || !b.name.startsWith(CLAUDE_PLANT_PREFIX)) continue;
      calls.push({ toolCallId: b.id, tool: b.name.slice(CLAUDE_PLANT_PREFIX.length) || null, argsSha256: argsSha256(streamArgs(b.input ?? {})), engine: 'claude-code' });
    }
  }
  return calls;
}

const PLANT_TOOLS = new Set(ALL_TOOLS);
const groupBy = (items, key) => {
  const map = new Map();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
};
const sameResult = (a, b) => a.status === b.status && canonicalArgs(a.content ?? null) === canonicalArgs(b.content ?? null);

/**
 * Plant calls and adapter facts from a parsed Strands trace (`strands-jsonl`, written by physical/strands/launch.py).
 *
 * The stream side is what the model asked for: each `model_tool_use` of a plant tool, recorded at the model before any
 * hook or middleware could change it, keyed by its input. A model call that no stub ever forwarded is `agent_cancelled`
 * (a hook, middleware or interrupt in the agent stopped it): it is counted in `adapter.agentCancelled` and left out of
 * the match, so it is not a mismatch (design 15.3). The adapter facts compare the model's calls with the stubs'
 * `forward` lines and the agent's final `tool_result`s: `rewrittenArgs` (a stub got other arguments or another tool),
 * `retried` (one model call forwarded more than once), `rewrittenResults` (the agent saw a result the stub did not
 * return) and `unmatchedForwards` (a forward with no model call). Rewrites and retries already break the match with
 * gateway.jsonl; a rewritten result does not, so the scorer adds it to the mismatches.
 *
 * `forbidHooks` true (a plain Strands arm in a counted suite) also lists the census problems; the scorer counts them
 * as mismatches, because the run's path cannot be trusted. Returns `{calls, adapter}`.
 */
function plantCallsInStrandsTrace(events, { forbidHooks = false } = {}) {
  const uses = events.filter((e) => e?.type === 'model_tool_use' && PLANT_TOOLS.has(e.name));
  const forwards = groupBy(events.filter((e) => e?.type === 'forward'), (f) => f.toolUseId);
  const results = groupBy(events.filter((e) => e?.type === 'tool_result'), (r) => r.toolUseId);
  const start = events.find((e) => e?.type === 'start') ?? null;
  const census = events.filter((e) => e?.type === 'census').at(-1) ?? null;
  const adapter = {
    kind: 'B', name: start?.adapter?.name ?? null, version: start?.adapter?.version ?? null, strands: start?.strands ?? null,
    hooks: forbidHooks ? 'refuse' : 'allowed', hookProblems: forbidHooks ? censusProblems(census) : [],
    agentCancelled: 0, rewrittenArgs: 0, retried: 0, rewrittenResults: 0, unmatchedForwards: 0,
  };
  const calls = [];
  for (const use of uses) {
    const sent = forwards.get(use.toolUseId) ?? [];
    if (!sent.length) {
      adapter.agentCancelled += 1;
      continue;
    }
    // Input that was not valid JSON is null: its tool stays unreadable, so it never pairs and stays a mismatch.
    const key = use.input === null ? null : argsSha256(use.input);
    calls.push({ toolCallId: use.toolUseId, tool: use.input === null ? null : use.name, argsSha256: key, engine: 'strands' });
    if (sent.length > 1) adapter.retried += 1;
    if (sent.some((f) => f.tool !== use.name || argsSha256(f.args ?? {}) !== key)) adapter.rewrittenArgs += 1;
    const seen = results.get(use.toolUseId)?.at(-1);
    if (seen && !sameResult(seen, sent.at(-1).result ?? {})) adapter.rewrittenResults += 1;
  }
  const asked = new Set(uses.map((u) => u.toolUseId));
  adapter.unmatchedForwards = [...forwards.keys()].filter((id) => !asked.has(id)).length;
  return { calls, adapter };
}

/**
 * The plant calls of a parsed agent stream `events` in stream format `format` (a harness descriptor's `streamFormat`):
 * `{calls, adapter}`, where `adapter` is null for the shim (kind A) formats. `opts` reach the Strands reader.
 */
function streamCallsOf(format, events, opts = {}) {
  const read = READERS[format];
  if (!read) throw new Error(`no plant stream reader for ${format}`);
  return read(events, opts);
}

// The plant reader of each stream format. A format not listed has no plant arms: checkSuiteShape refuses them before
// a trial, so a new stream is never read as another harness's (that would find no calls and fail every trial).
const READERS = Object.freeze({
  'kiro-acp': (events) => ({ calls: plantCallsInStream(events), adapter: null }),
  'claude-stream-json': (events) => ({ calls: plantCallsInClaudeStream(events), adapter: null }),
  'strands-jsonl': plantCallsInStrandsTrace,
});

/** Whether stream format `format` has a plant reader. */
const hasPlantReader = (format) => Object.hasOwn(READERS, format);

/** Gateway `call` events from parsed gateway log `lines`: `{callId, tool, argsSha256}` in log order. */
function plantCallsInGatewayLog(lines) {
  return lines.filter((l) => l.type === 'call').map((l) => ({ callId: callIdOf(l), tool: l.tool, argsSha256: l.args_sha256 }));
}

const keyOf = (call) => `${call.tool}\u0000${call.argsSha256}`;

/** `{pairs: [{stream, gateway}], streamOnly, gatewayOnly}` for the two call lists; `pairs` keeps gateway order. */
function matchCalls(streamCalls, gatewayCalls) {
  const waiting = new Map();
  for (const call of streamCalls) waiting.set(keyOf(call), [...(waiting.get(keyOf(call)) ?? []), call]);
  const pairs = [];
  const gatewayOnly = [];
  for (const call of gatewayCalls) {
    const match = waiting.get(keyOf(call))?.shift();
    if (match) pairs.push({ stream: match, gateway: call });
    else gatewayOnly.push(call);
  }
  return { pairs, streamOnly: [...waiting.values()].flat(), gatewayOnly };
}

module.exports = { plantCallsInStream, plantCallsInClaudeStream, plantCallsInStrandsTrace, streamCallsOf, hasPlantReader, plantCallsInGatewayLog, matchCalls };
