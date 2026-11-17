// SPDX-License-Identifier: Apache-2.0
'use strict';

// One classifier for "the agent could not log in". It is shared by result building (a run that never started a turn
// costs nothing) and the driver (a run of consecutive auth failures stops the chunk).

const AUTH_PATTERNS = [
  /not logged in/i,
  /authentication failed/i,
  /token (?:has |is |was )?(?:already )?expired/i,
  /refresh callback returned/i,
  /please log ?in/i,
  // AWS (Bedrock) answers an expired or revoked session with these; Claude Code prints them as the run's error.
  /security token included in the request is (?:expired|invalid)/i,
  /\bExpiredToken(?:Exception)?\b/,
  /could not load (?:aws )?credentials/i,
];

const DEFAULT_MAX_AUTH_FAILURES = 3;
// Exit code of `bench.js run` when the chunk stopped on login failures (5 is the all-runs-errored flag).
const AUTH_EXIT_CODE = 6;

const SNIPPET_CHARS = 200;
const SCAN_CHARS = 200000;

/** The first line of the given texts that looks like a login failure, trimmed; null when none does. */
function authFailureText(...texts) {
  for (const t of texts) {
    if (typeof t !== 'string' || !t) continue;
    for (const line of t.slice(0, SCAN_CHARS).split('\n')) {
      if (AUTH_PATTERNS.some((p) => p.test(line))) return line.trim().slice(0, SNIPPET_CHARS);
    }
  }
  return null;
}

/**
 * True when the stream holds no sign that a turn ran: no metering, no tool call, no finished run, no turn duration, no
 * final text. A missing aggregate (nothing parsed) counts as never started.
 */
function neverStartedTurn(agg) {
  if (!agg) return true;
  return (agg.runFinishedStatus ?? null) === null && !agg.meteringEntries && !agg.toolCalls && agg.turnDurationMs == null && !agg.finalText;
}

/**
 * True when the agent reported a finished run that failed before it called any tool. Claude Code does this when the
 * first model request is refused (an expired AWS token): its result line has a duration and an error text.
 */
function failedBeforeAnyTool(agg) {
  return Boolean(agg) && agg.runFinishedStatus === 'error' && !agg.toolCalls && !agg.meteringEntries;
}

/**
 * The matching message when a run failed to log in, else null. A timeout is a real timeout, not an auth failure.
 * A run that never started a turn is matched against `texts` (stderr and the stream). A run that finished with an
 * error before any tool call is matched against its error texts and stderr only, not the stream, so a model that
 * merely prints "not logged in" is not an auth failure. A run that called a tool is never classified.
 */
function classifyAuthFailure({ agg, exec, texts = [] }) {
  if (exec?.timedOut) return null;
  if (!(exec?.exitCode !== 0 || exec?.error)) return null;
  if (neverStartedTurn(agg)) return authFailureText(exec?.error, ...texts);
  if (!failedBeforeAnyTool(agg)) return null;
  return authFailureText(exec?.error, ...(Array.isArray(agg.errors) ? agg.errors : []), agg.finalText, texts[0]);
}

/** The consecutive-auth-failure limit: --max-auth-failures, else BENCH_MAX_AUTH_FAILURES, else 3. Throws on anything but a positive integer. */
function maxAuthFailuresOf(flag, envValue) {
  const raw = flag !== undefined ? flag : envValue;
  if (raw === undefined || raw === '') return DEFAULT_MAX_AUTH_FAILURES;
  if (raw === true || !/^[1-9]\d*$/.test(String(raw))) throw new Error(`${flag !== undefined ? '--max-auth-failures' : 'BENCH_MAX_AUTH_FAILURES'} must be a positive integer`);
  return Number(raw);
}

module.exports = {
  DEFAULT_MAX_AUTH_FAILURES, AUTH_EXIT_CODE, maxAuthFailuresOf, AUTH_PATTERNS, authFailureText, neverStartedTurn, failedBeforeAnyTool, classifyAuthFailure };
