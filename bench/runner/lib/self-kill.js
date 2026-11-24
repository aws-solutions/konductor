// SPDX-License-Identifier: Apache-2.0
'use strict';
// An agent that kills its own runtime (DEBT D-243): on t5-qa-sync-strategy the agent ran `pkill -f "node -"` to stop a
// hung probe, the pattern also matched kiro-cli's own node, and kiro-cli exited on SIGTERM. That is the agent's own act,
// a run result, not an infrastructure failure, so the runner flags it and the infra check does not count it.
const fs = require('node:fs');
const path = require('node:path');

const KILL_RE = /\b(pkill|killall|kill)\b/;
const INTERRUPTED = 'interrupted before it reported a result';
const SELF_KILL_FLAG = 'agentSelfKill';
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }; // a missing file reads as empty

/**
 * Whether a run with `status` in run folder `dir` killed itself: it errored, its stderr shows a SIGTERM exit, and its
 * last interrupted shell call (kiro-cli stream) holds a kill command.
 */
function isSelfKill(dir, status) {
  if (status !== 'error' || !/SIGTERM/.test(readText(path.join(dir, 'stderr.txt')))) return false;
  let last = null;
  for (const line of readText(path.join(dir, 'stream.jsonl')).split('\n')) {
    if (!line.includes(INTERRUPTED)) continue;
    try { last = JSON.parse(line).data?.update ?? last; } catch { /* a cut line */ }
  }
  return Boolean(last && KILL_RE.test(String(last.rawInput?.command ?? '')));
}

/** Sets `agentSelfKill` and the flag on result `r` when the run in `dir` killed itself. Returns `r`. */
function markSelfKill(r, dir) {
  if (!isSelfKill(dir, r.status)) return r;
  r.agentSelfKill = true;
  r.flags = [...(r.flags || []).filter((f) => f !== SELF_KILL_FLAG), SELF_KILL_FLAG];
  return r;
}

module.exports = { isSelfKill, markSelfKill, SELF_KILL_FLAG };
