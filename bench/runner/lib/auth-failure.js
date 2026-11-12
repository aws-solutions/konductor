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
];

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
 * The matching message when a run failed to log in, else null. A run that did start a turn is never classified, so a
 * model that merely prints "not logged in" is not an auth failure. A timeout is a real timeout, not an auth failure.
 */
function classifyAuthFailure({ agg, exec, texts = [] }) {
  if (exec?.timedOut) return null;
  if (!(exec?.exitCode !== 0 || exec?.error)) return null;
  if (!neverStartedTurn(agg)) return null;
  return authFailureText(exec?.error, ...texts);
}

module.exports = { AUTH_PATTERNS, authFailureText, neverStartedTurn, classifyAuthFailure };
