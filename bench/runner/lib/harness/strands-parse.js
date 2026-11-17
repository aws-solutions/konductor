// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads the trace bench/physical/strands/launch.py writes (`strands-jsonl`, one JSON object per line with a `type`).
// The trace is the agent's own record: the plant scorer checks it against gateway.jsonl and never trusts it for safety.

const FINAL_TEXT_MAX = 20000;

const ofType = (events, type) => events.filter((e) => e?.type === type);
const lastOf = (events, type) => ofType(events, type).at(-1) ?? null;

/**
 * The run aggregate of parsed trace `events`, in the shape harness/CONTRACT.md asks of `acc.agg`, plus `usage`
 * (`{input, output}` tokens) and `modelCalls`. `runFinishedStatus` is "success" with a `final` line, "error" with an
 * `error` line, else null (the trace never said the run ended). `costUsd` is 0 for the fake model; for a capped
 * (Bedrock) model it is the `usage` line's cost, or, when the run was cut off before that line, the last `spend`
 * line's reserve (an upper bound), or null when neither was written.
 */
function aggregateEvents(events) {
  const start = lastOf(events, 'start');
  const final = lastOf(events, 'final');
  const error = lastOf(events, 'error');
  const toolNames = {};
  for (const u of ofType(events, 'model_tool_use')) toolNames[u.name] = (toolNames[u.name] ?? 0) + 1;
  const toolCalls = Object.values(toolNames).reduce((n, c) => n + c, 0);
  const text = typeof final?.text === 'string' ? final.text : null;
  const usage = lastOf(events, 'usage');
  const spend = lastOf(events, 'spend');
  const fake = String(start?.model ?? '').startsWith('fake:');
  return {
    sessionId: start?.sessionId ?? null, sessionIds: start?.sessionId ? [start.sessionId] : [],
    runFinishedStatus: final ? 'success' : error ? 'error' : null, stopReason: final?.stopReason ?? null,
    credits: 0, meteringEntries: 0, nonCreditUnits: [], turnDurationMs: null, contextUsagePercentage: null,
    toolCalls, workToolCalls: toolCalls, subagentCalls: 0, toolNames, skillsMcpOk: null, delegatedTo: {},
    finalText: text === null ? null : text.slice(0, FINAL_TEXT_MAX), finalTextTruncated: text === null ? null : text.length > FINAL_TEXT_MAX,
    askedUser: null, configuredModel: start?.model ?? null,
    error: error ? `${error.stage}: ${error.message}` : null,
    usage: { input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 },
    modelCalls: usage?.modelCalls ?? 0,
    costUsd: fake ? 0 : usage?.costUsd ?? spend?.reservedUsd ?? null,
    strands: start?.strands ?? null, adapter: start?.adapter ?? null,
  };
}

module.exports = { aggregateEvents, FINAL_TEXT_MAX };
