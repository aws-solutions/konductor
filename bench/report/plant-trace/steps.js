// SPDX-License-Identifier: Apache-2.0
'use strict';

// Joins one trial's gateway log, simulator log and agent stream into one row per tool call. The gateway log is the
// truth for what was asked and what was decided; the stream adds what the agent saw and its tokens. The two are matched
// as a multiset of (tool, args_sha256), never by rpc_id, with the bench's own matcher.

const path = require('node:path');
const { matchCalls, plantCallsInGatewayLog } = require('../../runner/lib/plant/stream-match.js');
const { streamTrace } = require('./stream-calls.js');

const DECISIONS = new Set(['allowed', 'denied', 'approval_required', 'execution_error']);
const BLOCKED = new Set(['denied', 'approval_required', 'execution_error']);
const baseName = (s) => path.basename(String(s ?? ''));

/** The call's row colour: `blocked` when the gateway refused it, `unsafe` when an unsafe call or harm got through, else `allowed`. */
function classify(decision, unsafe, harm) {
  if (BLOCKED.has(decision)) return 'blocked';
  return unsafe.length || harm.length ? 'unsafe' : 'allowed';
}

const wallMs = (line) => Date.parse(line.t_wall);
const stateOf = (world, callId, fallback) => world.find((w) => w.cause === callId)?.state ?? fallback ?? null;

/**
 * The gateway events of each call, by call id (`allowed`, `executed`, `denied`, `approval_*`, `fault`, ...). A `harm` line
 * names its call as `cause` (or `settle`, which no call owns) and an `approval_update` that spent an approval as `consumed_by`.
 */
function eventsByCall(gateway) {
  const byCall = new Map();
  for (const line of gateway) {
    const id = line.type === 'call' ? `c${line.seq}` : line.call_id ?? (line.type === 'harm' ? line.cause : line.consumed_by);
    if (id) byCall.set(id, [...(byCall.get(id) ?? []), line]);
  }
  return byCall;
}

/** Sim ms the call moved the clock by, or null when the log has no state before it (a call refused for bad arguments). */
function simAdvance(call, world, callId, after) {
  const to = stateOf(world, callId, after)?.t_ms;
  return Number.isFinite(to) && Number.isFinite(call.state_before?.t_ms) ? to - call.state_before.t_ms : null;
}

/** The step for gateway `call` line `call`, its `events` (the call line included), the world log, and the previous step's end time. */
function stepOf(n, call, events, world, prevEndMs) {
  const callId = `c${call.seq}`;
  const decisionLine = events.find((e) => DECISIONS.has(e.type));
  const decision = decisionLine?.type ?? 'undecided';
  const harm = events.filter((e) => e.type === 'harm').flatMap((e) => e.rules);
  const after = events.find((e) => e.state_after)?.state_after ?? null;
  const endMs = Math.max(...events.map(wallMs));
  return {
    n, callId, seq: call.seq, tool: call.tool, args: call.args ?? {}, argsSha256: call.args_sha256,
    decision, reason: decisionLine?.reason ?? decisionLine?.error ?? decisionLine?.action ?? null,
    unsafe: call.unsafe ?? [], harm, kind: classify(decision, call.unsafe ?? [], harm),
    needsApproval: Boolean(call.needs_approval), staleSensors: call.sensors_fresh ? Object.entries(call.sensors_fresh).filter(([, ok]) => !ok).map(([k]) => k) : [],
    stateBefore: call.state_before ?? null, stateAfter: stateOf(world, callId, after),
    waitMs: Number.isFinite(prevEndMs) ? Math.max(0, wallMs(call) - prevEndMs) : null,
    gatewayMs: endMs - wallMs(call), simMs: simAdvance(call, world, callId, after),
    stepMs: Number.isFinite(prevEndMs) ? Math.max(0, endMs - prevEndMs) : null,
    events: events.filter((e) => e !== call), tWall: call.t_wall,
    stream: null, tokens: null,
  };
}

/** The steps of a trial's gateway log in call order, without the stream side. */
function gatewaySteps(gateway, world) {
  const byCall = eventsByCall(gateway);
  const start = gateway.find((l) => l.type === 'startup');
  let prevEnd = start ? wallMs(start) : NaN;
  return gateway.filter((l) => l.type === 'call').map((call, i) => {
    const step = stepOf(i + 1, call, byCall.get(`c${call.seq}`), world, prevEnd);
    prevEnd = Math.max(...byCall.get(`c${call.seq}`).map(wallMs));
    return step;
  });
}

/** Adds what the agent stream says to each step and returns `{steps, streamOnly}`: stream calls the gateway never saw. */
function joinStream(steps, trace, gateway) {
  const { pairs, streamOnly, gatewayOnly } = matchCalls(trace.calls, plantCallsInGatewayLog(gateway));
  const streamOf = new Map(pairs.map((p) => [p.gateway.callId, p.stream]));
  const lost = new Set(gatewayOnly.map((g) => g.callId));
  for (const step of steps) {
    const stream = streamOf.get(step.callId);
    step.stream = stream ? { matched: true, toolCallId: stream.toolCallId, ...trace.seen.get(stream.toolCallId) } : { matched: false };
    step.tokens = stream ? trace.tokens.byCall.get(stream.toolCallId) ?? null : null;
    step.gatewayOnly = lost.has(step.callId);
  }
  return { steps, streamOnly: streamOnly.map((c) => ({ ...c, ...trace.seen.get(c.toolCallId) })) };
}

const count = (steps, test) => steps.filter(test).length;

/**
 * Everything the page shows about one trial `trial` (from `readTrial`): `{label, task, arm, model, harness, status, wallMs,
 * steps, streamOnly, tokens, final, counts, badLines}`. `final` is the plant state at the end of the run, after the settle.
 * `counts` has the steps, how many the gateway blocked, how many carried an unsafe rule (`unsafeTries`, blocked or not), how many
 * unsafe ones ran (`unsafeRan`) and the stream-to-gateway mismatches.
 */
function buildTrace(trial) {
  const trace = streamTrace(trial.streamFormat, trial.events);
  const { steps, streamOnly } = joinStream(gatewaySteps(trial.gateway, trial.world), trace, trial.gateway);
  const r = trial.result;
  const endState = trial.world.at(-1)?.state ?? null;
  const settleHarm = trial.gateway.filter((l) => l.type === 'harm' && l.cause === 'settle').flatMap((l) => l.rules);
  return {
    label: r.armId ?? baseName(trial.dir), arm: r.armId ?? null, task: r.taskId ?? null, model: r.model ?? null,
    harness: r.harness ?? null, status: r.status ?? null, wallMs: r.wallClockMs ?? null,
    steps, streamOnly, tokens: trace.tokens, final: { state: endState, harm: settleHarm },
    counts: {
      steps: steps.length, blocked: count(steps, (s) => s.kind === 'blocked'), unsafeTries: count(steps, (s) => s.unsafe.length > 0),
      unsafeRan: count(steps, (s) => s.kind === 'unsafe'), mismatches: streamOnly.length + count(steps, (s) => s.gatewayOnly),
    },
    badLines: trial.badLines,
  };
}

module.exports = { buildTrace, classify };
