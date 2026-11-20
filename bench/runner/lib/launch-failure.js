// SPDX-License-Identifier: Apache-2.0
'use strict';

// "The agent binary could not be started": the run ended within seconds, without a turn in its stream, because the exec
// step failed (exit 127, a missing or non-executable file, a spawn error). It happens to every later run of a chunk when
// the kiro-cli install is replaced or removed underneath it. Like a login failure, such a run costs nothing and is infra.

const { neverStartedTurn } = require('./auth-failure.js');

const MAX_LAUNCH_WALL_MS = 5000;
// 127: command not found / no such file. 126: found but not executable.
const NOT_FOUND_EXIT = 127;
const NOT_EXECUTABLE_EXIT = 126;
const LAUNCH_PATTERNS = [/No such file or directory/i, /Permission denied/i, /\bENOENT\b/, /\bEACCES\b/, /command not found/i];

const SNIPPET_CHARS = 200;
const SCAN_CHARS = 200000;

/** The first line of the given texts that looks like an exec failure, trimmed; null when none does. */
function launchFailureText(...texts) {
  for (const t of texts) {
    if (typeof t !== 'string' || !t) continue;
    for (const line of t.slice(0, SCAN_CHARS).split('\n')) {
      if (LAUNCH_PATTERNS.some((p) => p.test(line))) return line.trim().slice(0, SNIPPET_CHARS);
    }
  }
  return null;
}

/**
 * The matching message when the agent binary failed to launch, else null. Needs a failed process that ended quickly with
 * no turn in the stream. Exit 127 is enough by itself; exit 126 or a spawn error (no exit code) also needs an exec
 * message, so an agent that prints "Permission denied" from one of its own tools is never classified.
 */
function classifyLaunchFailure({ agg, exec, texts = [] }) {
  if (!exec || exec.timedOut) return null;
  if (!(exec.exitCode !== 0 || exec.error)) return null;
  if (!neverStartedTurn(agg)) return null;
  if (!Number.isFinite(exec.wallClockMs) || exec.wallClockMs >= MAX_LAUNCH_WALL_MS) return null;
  const text = launchFailureText(exec.error, ...texts);
  if (exec.exitCode === NOT_FOUND_EXIT) return text ?? 'exit code 127 (command not found)';
  if (exec.exitCode === NOT_EXECUTABLE_EXIT || exec.exitCode === null) return text;
  return null;
}

// Kiro CLI with --require-mcp-startup exits 3 when an MCP server did not start (docs/history/STEP0-FINDINGS.md). Under a plant arm that
// server is the plant shim, so the run never reached the gateway: launch failure `plantStartup` (8.5).
const MCP_STARTUP_EXIT = 3;

/** A `plantStartup` message when a plant run's Kiro CLI exited 3 without starting a turn, else null. No wall-clock bound: the MCP start may take its own timeout. */
function classifyPlantStartup({ agg, exec }) {
  if (!exec || exec.timedOut || exec.exitCode !== MCP_STARTUP_EXIT || !neverStartedTurn(agg)) return null;
  return 'plantStartup: kiro-cli exit 3, the plant MCP server did not start';
}

module.exports = { MAX_LAUNCH_WALL_MS, LAUNCH_PATTERNS, launchFailureText, classifyLaunchFailure, classifyPlantStartup };
