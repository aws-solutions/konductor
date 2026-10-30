// SPDX-License-Identifier: Apache-2.0
'use strict';

const { loadSchema, validate } = require('./schema.js');
const { resultFields } = require('./skills.js');
const { aggregateHidden, aggregateRegression, aggregateGroup } = require('./check-matcher.js');
const { autonomyFields } = require('./autonomy.js');
const { provenanceOf } = require('./runconfig.js');
const { kiroInstallHarness } = require('./harness/runtime.js');

function classifyStatus({ timedOut, exitCode, runFinishedStatus }) {
  if (timedOut) return 'timeout';
  if (exitCode !== 0 || runFinishedStatus !== 'success') return 'error';
  return 'success';
}

const CREDIT_TOLERANCE = 0.02;

// Compares the stream's credits with the per-session metering in the session files.
// Subagent sessions carry no turn metadata, so a full comparison needs every session
// to have it; otherwise the session total can only be a lower bound of the stream total.
function crossCheckCredits(streamCredits, sessions) {
  const withTurns = sessions.filter((s) => s && s.turns > 0);
  const total = withTurns.reduce((n, s) => n + s.meteringTotal, 0);
  const full = sessions.length > 0 && withTurns.length === sessions.length;
  const tol = Math.max(0.001, CREDIT_TOLERANCE * Math.max(total, streamCredits));
  const mismatch = withTurns.length > 0 && (full ? Math.abs(total - streamCredits) > tol : total > streamCredits + tol);
  return { total: withTurns.length ? total : null, mismatch };
}

/**
 * Builds a result.json object.
 * agg: aggregateStream output (null if the run died before any parsing).
 * session: summarizeSessionJson of the parent session, or null.
 * transcript: {chars, bytes, partial}, summed over the parent and subagent sessions.
 * usage: opencode only, {tokens, costUsd, modelCalls, sessions} summed over the parent and all subagent sessions.
 * skills: {extraction, info} from the harness (see skills.js), or null.
 * conv: the autonomy conversation (see autonomy.newConversation), for tasks with an autonomy block.
 * meta: runner-side facts {agentStarted, flags, infraError, modelNormalized, rewrittenAgents, mcpSha256,
 *   isolation, homeTripwireHits, inFlightAtStart, creditsSessionTotal}.
 */
function buildResult({ arm, task, replicate, config, exec, agg, session, usage = null, skills = null, checks, transcript, env, meta = {}, conv = null }) {
  const runtime = arm.runtime ?? 'kiro-cli';
  const oc = runtime === 'opencode';
  const flags = [...(meta.flags || [])];
  let status = classifyStatus({
    timedOut: exec.timedOut,
    exitCode: exec.exitCode,
    runFinishedStatus: agg?.runFinishedStatus ?? null,
  });
  let error = exec.error ?? null;
  const sessionModel = session?.model ?? null;
  // A resumed conversation has one model entry per turn; any turn on another model invalidates the run.
  const wrongModel = [...new Set([...(session?.models ?? []), sessionModel].filter((m) => m && m !== config.model))];
  if (wrongModel.length) {
    flags.push('modelMismatch');
    if (status === 'success') status = 'error';
    error = [error, `parent session ran on ${wrongModel.join(', ')}, expected ${config.model}`].filter(Boolean).join(' | ');
  }
  if (agg?.nonCreditUnits?.length) flags.push('meteringUnit');
  if (transcript?.partial) flags.push('transcriptPartial');
  if (meta.infraError && status === 'success') status = 'error';

  const hasMetering = agg && agg.meteringEntries > 0;
  const credits = hasMetering ? agg.credits : null;
  const finished = (agg?.runFinishedStatus ?? null) !== null;
  const agentStarted = meta.agentStarted !== false;
  const censored = agentStarted && (status === 'timeout' || status === 'error') && !finished;
  const creditsCensored = censored && !oc;

  return {
    armId: arm.id,
    armLabel: arm.label,
    ref: arm.ref,
    commitSha: arm.commitSha,
    ...provenanceOf(arm),
    harness: runtime,
    installHarness: oc || arm.vanilla || !config.agentEngine ? arm.harness : kiroInstallHarness(config.agentEngine),
    harnessVersion: env?.harnessVersion ?? env?.kiroCliVersion ?? null,
    model: config.model,
    effort: config.effort,
    taskId: task.id,
    replicate,
    status,
    exitCode: exec.exitCode,
    runFinishedStatus: agg?.runFinishedStatus ?? null,
    stopReason: agg?.stopReason ?? null,
    runStartedAt: exec.startedAt ?? null,
    wallClockMs: exec.wallClockMs,
    turnDurationMs: agg?.turnDurationMs ?? null,
    credits,
    creditsCensored,
    creditsLowerBound: creditsCensored ? credits ?? 0 : null,
    creditsCharged: null,
    creditsSessionTotal: meta.creditsSessionTotal ?? null,
    modelCalls: oc
      ? (usage ? { meteringEntries: usage.modelCalls, totalRequestCount: usage.modelCalls } : null)
      : agg
        ? { meteringEntries: agg.meteringEntries, totalRequestCount: session?.totalRequestCount ?? null }
        : null,
    tokens: usage?.tokens ?? null,
    costUsd: usage?.costUsd ?? null,
    costCensored: oc ? censored : null,
    costUsdCharged: null,
    sessionsRolledUp: usage?.sessions ?? null,
    region: oc ? env?.region ?? null : null,
    toolCalls: agg ? agg.toolCalls : null,
    workToolCalls: agg ? agg.workToolCalls : null,
    toolNames: agg ? agg.toolNames : null,
    subagentCalls: agg ? agg.subagentCalls : null,
    contextUsagePercentage: agg?.contextUsagePercentage ?? null,
    transcriptBytes: transcript?.bytes ?? null,
    transcriptPartial: transcript ? Boolean(transcript.partial) : null,
    estTokens: oc
      ? (usage ? { value: usage.tokens.total, isEstimate: false } : null)
      : transcript?.chars == null ? null : { value: Math.round(transcript.chars / 4), isEstimate: true },
    finalText: agg?.finalText ?? null,
    finalTextTruncated: agg?.finalTextTruncated ?? null,
    askedUser: agg?.askedUser ?? null,
    skillsMcpOk: agg?.skillsMcpOk ?? null,
    checks: checks || [],
    hiddenTests: aggregateHidden(checks),
    regressionTests: aggregateRegression(checks),
    contamination: meta.contamination ?? null,
    kiroCliVersion: env?.kiroCliVersion ?? null,
    modelListSnapshotPath: env?.modelListSnapshotPath ?? null,
    sessionModel,
    sessionId: agg?.sessionId ?? null,
    agent: arm.agent,
    agentEngine: config.agentEngine ?? null,
    modelNormalized: meta.modelNormalized ?? false,
    rewrittenAgents: meta.rewrittenAgents ?? [],
    mcpSha256: meta.mcpSha256 ?? null,
    isolation: meta.isolation ?? null,
    homeTripwireHits: meta.homeTripwireHits ?? null,
    inFlightAtStart: meta.inFlightAtStart ?? null,
    flags: [...new Set(flags)],
    infraError: meta.infraError ?? null,
    error,
    ...resultFields({ extraction: skills?.extraction ?? null, info: skills?.info ?? null, task, arm }),
    ...(autonomyFields({ task, conv, checks: checks || [], finalText: agg?.finalText ?? null, aggregateGroup }) ?? {}),
  };
}

function errorResult({ arm, task, replicate, config, env, message, meta, conv = null }) {
  return buildResult({
    arm, task, replicate, config,
    exec: { timedOut: false, exitCode: null, wallClockMs: null, error: message },
    agg: null, session: null, checks: [], transcript: null, env, meta, conv,
  });
}

function skippedResult({ arm, task, replicate, config, env, reason = 'budget reached' }) {
  return { ...errorResult({ arm, task, replicate, config, env, message: reason }), status: 'budget_skipped', creditsCensored: false, creditsLowerBound: null, ...(arm.runtime === 'opencode' ? { costCensored: false } : {}) };
}

function validateResult(result) {
  return validate(loadSchema('result'), result);
}

module.exports = { buildResult, errorResult, skippedResult, classifyStatus, validateResult, crossCheckCredits };
