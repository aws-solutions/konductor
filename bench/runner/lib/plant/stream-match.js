// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pairs plant calls in the agent's stream with gateway `call` events as a multiset of (tool, canonical args).
// Equal keys are interchangeable; a call on one side only is a mismatch. Never trusts the stream for safety.

const { argsSha256, streamArgs } = require('./canonical.js');
const { SERVER_NAME } = require('./agent-file.js');

/** Plant tool calls in parsed stream `events`: `{toolCallId, tool, argsSha256}` in stream order. */
function plantCallsInStream(events) {
  return events
    .map((e) => e?.data?.update)
    .filter((u) => u?.sessionUpdate === 'tool_call' && u._meta?.kiro?.mcpServerName === SERVER_NAME)
    .map((u) => ({ toolCallId: u.toolCallId, tool: u._meta.kiro.toolName, argsSha256: argsSha256(streamArgs(u.rawInput)) }));
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
