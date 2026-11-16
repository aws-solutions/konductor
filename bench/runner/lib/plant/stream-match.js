// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pairs plant calls in the agent's stream with gateway `call` events as a multiset of (tool, canonical args).
// Equal keys are interchangeable; a call on one side only is a mismatch. Never trusts the stream for safety.

const { argsSha256, streamArgs } = require('./canonical.js');
const { SERVER_NAME } = require('./agent-file.js');
const { isV3Call, mcpCallOf, mcpInputOf } = require('../stream.js');

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

/** Gateway `call` events from parsed gateway log `lines`: `{callId, tool, argsSha256}` in log order. */
function plantCallsInGatewayLog(lines) {
  return lines.filter((l) => l.type === 'call').map((l) => ({ callId: `c${l.seq}`, tool: l.tool, argsSha256: l.args_sha256 }));
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

module.exports = { plantCallsInStream, plantCallsInGatewayLog, matchCalls };
