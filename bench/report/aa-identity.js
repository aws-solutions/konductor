// SPDX-License-Identifier: Apache-2.0
'use strict';

// The prompt prefix part of an arm's A/A identity, shared by the verdict, the orchestrator pass rule and the diligence
// scorecard so that all three pair the same arms.

/**
 * The prompt prefix (`run --arm-prefix`) part of an arm's identity. An arm with no prefix adds nothing, so its identity is
 * what it always was. An arm whose runs all carry the same hashed prefix adds that hash. Anything else (a prefix with no
 * hash, or runs that disagree) returns null: the arm has no identity and is never paired. Runs that carry oracle skills add
 * `|oracle`, so an oracle arm is never an A/A repeat of the same ref without them; forced-load runs add `|forced`.
 */
function prefixIdentity(rows) {
  const keys = new Set(rows.map((r) => (r.armPrefix ? r.armPrefix.sha256 || '?' : '')));
  if (keys.size !== 1) return null;
  const k = [...keys][0];
  if (k === '?') return null;
  const oracle = new Set(rows.map((r) => Boolean(r.oracle)));
  if (oracle.size !== 1) return null;
  // A konductor-forced arm (run --forced-must-load) is likewise never an A/A repeat of the organic arm at its ref.
  const forced = new Set(rows.map((r) => Boolean(r.forcedLoad)));
  if (forced.size !== 1) return null;
  return `${k ? `|prefix:${k}` : ''}${oracle.has(true) ? '|oracle' : ''}${forced.has(true) ? '|forced' : ''}`;
}

module.exports = { prefixIdentity };
