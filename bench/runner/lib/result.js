// SPDX-License-Identifier: Apache-2.0
'use strict';

const { loadSchema, validate } = require('./schema.js');
const { resultFields, capInvocationOf } = require('./skills.js');
const { aggregateHidden, aggregateRegression, aggregateGroup } = require('./check-matcher.js');
const { autonomyFields } = require('./autonomy.js');
const { provenanceOf } = require('./runconfig.js');
const { kiroInstallHarness, isUsdRuntime } = require('./harness/runtime.js');
const { isComparableMode } = require('./isolate.js');
const { oracleResult } = require('./oracle.js');

const isolationOf = (mode) => (typeof mode === 'string' && mode && mode !== 'auto' ? mode : 'none');

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

// The result fields read straight from the parsed stream. `bench.js backfill` rewrites exactly these from a saved stream.
function streamFields(agg, orch = null) {
  return {
    turnDurationMs: agg?.turnDurationMs ?? null,
    credits: agg && agg.meteringEntries > 0 ? agg.credits : null,
    meteringEntries: agg ? agg.meteringEntries : null,
    toolCalls: agg ? agg.toolCalls : null,
    workToolCalls: agg ? agg.workToolCalls : null,
    toolNames: agg ? agg.toolNames : null,
    subagentCalls: agg ? agg.subagentCalls : null,
    orch,
    flags: agg?.nonCreditUnits?.length ? ['meteringUnit'] : [],
  };
}

/**
 * Builds a result.json object.
 * agg: aggregateStream output (null if the run died before any parsing).
 * session: summarizeSessionJson of the parent session, or null.
 * transcript: {chars, bytes, partial}, summed over the parent and subagent sessions.
 * usage: opencode only, {tokens, costUsd, modelCalls, sessions} summed over the parent and all subagent sessions.
 * skills: {extraction, info} from the harness (see skills.js), or null.
 * orch: spawns, depth, review flow and phase documents (see orch-metrics.js), or null.
 * conv: the autonomy conversation (see autonomy.newConversation), for tasks with an autonomy block.
 * meta: runner-side facts {agentStarted, flags, infraError, runError, modelNormalized, rewrittenAgents, mcpSha256,
 *   isolation, homeTripwireHits, inFlightAtStart, creditsSessionTotal}.
 */
function buildResult({ arm, task, replicate, config, exec, agg, session, usage = null, skills = null, orch = null, checks, transcript, env, meta = {}, conv = null }) {
  const runtime = arm.runtime ?? 'kiro-cli';
  const oc = isUsdRuntime(runtime);
  const flags = [...(meta.flags || [])];
  let status = classifyStatus({
    timedOut: exec.timedOut,
    exitCode: exec.exitCode,
    runFinishedStatus: agg?.runFinishedStatus ?? null,
  });
  let error = exec.error ?? null;
  if (meta.runError) error = [error, meta.runError].filter(Boolean).join(' | ');
  const sessionModel = session?.model ?? null;
  // A resumed conversation has one model entry per turn; any turn on another model invalidates the run.
  const expectedModel = config.canonicalModel ?? config.model;
  const wrongModel = [...new Set([...(session?.models ?? []), sessionModel].filter((m) => m && m !== expectedModel))];
  if (wrongModel.length) {
    flags.push('modelMismatch');
    if (status === 'success') status = 'error';
    error = [error, `parent session ran on ${wrongModel.join(', ')}, expected ${expectedModel}`].filter(Boolean).join(' | ');
  }
  const fromStream = streamFields(agg, orch);
  flags.push(...fromStream.flags);
  if (transcript?.partial) flags.push('transcriptPartial');
  if (meta.infraError && status === 'success') status = 'error';

  const { credits } = fromStream;
  const finished = (agg?.runFinishedStatus ?? null) !== null;
  const agentStarted = meta.agentStarted !== false;
  // A timeout is censored even when runFinished was seen: the kill can land before a late turn's metering event.
  const censored = agentStarted && (status === 'timeout' || (status === 'error' && !finished));
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
    turnDurationMs: fromStream.turnDurationMs,
    credits,
    creditsCensored,
    creditsLowerBound: creditsCensored ? credits ?? 0 : null,
    creditsCharged: null,
    creditsSessionTotal: meta.creditsSessionTotal ?? null,
    ...(meta.creditLimit != null ? { creditLimit: meta.creditLimit, creditOvershoot: meta.creditOvershoot ?? null } : {}),
    modelCalls: oc
      ? (usage ? { meteringEntries: usage.modelCalls, totalRequestCount: usage.modelCalls } : null)
      : agg
        ? { meteringEntries: fromStream.meteringEntries, totalRequestCount: session?.totalRequestCount ?? null }
        : null,
    tokens: usage?.tokens ?? null,
    costUsd: usage?.costUsd ?? null,
    costCensored: oc ? censored : null,
    costUsdCharged: null,
    sessionsRolledUp: usage?.sessions ?? null,
    region: oc ? env?.region ?? null : null,
    toolCalls: fromStream.toolCalls,
    workToolCalls: fromStream.workToolCalls,
    toolNames: fromStream.toolNames,
    subagentCalls: fromStream.subagentCalls,
    orch: fromStream.orch,
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
    ...(agg?.configuredModel ? { streamModel: agg.configuredModel } : {}),
    sessionId: agg?.sessionId ?? null,
    agent: arm.agent,
    agentEngine: config.agentEngine ?? null,
    modelNormalized: meta.modelNormalized ?? false,
    rewrittenAgents: meta.rewrittenAgents ?? [],
    mcpSha256: meta.mcpSha256 ?? null,
    isolation: isolationOf(meta.isolation),
    comparable: isComparableMode(meta.isolation),
    homeTripwireHits: meta.homeTripwireHits ?? null,
    inFlightAtStart: meta.inFlightAtStart ?? null,
    flags: [...new Set(flags)],
    infraError: meta.infraError ?? null,
    error,
    ...resultFields({ extraction: skills?.extraction ?? null, info: skills?.info ?? null, task, arm }),
    capInvocation: capInvocationOf({ agg, extraction: skills?.extraction ?? null, sops: skills?.info?.catalog?.sops ?? [] }),
    triggerQuery: task.triggerQuery ? { ...task.triggerQuery, rep: replicate } : null,
    variant: arm.variant ?? null,
    armPrefix: arm.prefixInfo ? { ...arm.prefixInfo } : null,
    oracle: oracleResult(arm, task),
    armConfig: arm.armConfig ?? null,
    ...(meta.claudeCode ? { claudeCode: meta.claudeCode } : {}),
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
  return { ...errorResult({ arm, task, replicate, config, env, message: reason }), status: 'budget_skipped', creditsCensored: false, creditsLowerBound: null, ...(isUsdRuntime(arm.runtime) ? { costCensored: false } : {}) };
}

function validateResult(result) {
  return validate(loadSchema('result'), result);
}

module.exports = { streamFields, buildResult, errorResult, skippedResult, classifyStatus, validateResult, crossCheckCredits };
