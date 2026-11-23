// SPDX-License-Identifier: Apache-2.0
'use strict';

// The one spend count. Every ledger reader in the bench (runner/lib/credit-ledger.js, cap/paidcall.js and the bash
// chains' scripts/lib/ledger.js) reads its JSON lines and counts a line's credits here, so an unknown cost is counted
// the same way everywhere: never as 0. Requires nothing from the bench.

const fs = require('node:fs');

/** The owner's spend rule: a call of unknown cost counts at 15 credits at least. */
const UNKNOWN_FLOOR = 15;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The JSON lines of `file`: { exists, entries, bad }. A missing file reads as none; a line that is not JSON is counted in `bad`. */
function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { exists: false, entries: [], bad: 0 }; }
  const out = { exists: true, entries: [], bad: 0 };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.entries.push(JSON.parse(line)); } catch { out.bad++; }
  }
  return out;
}

/** The known credit cost of a ledger line (its charge, else its credits), or null when it has none. */
const knownCredits = (entry) => (finite(entry.charged) ? entry.charged : finite(entry.credits) ? entry.credits : null);

/**
 * The credits a ledger line counts at: its known cost, else the larger of UNKNOWN_FLOOR and `maxSeen` (the highest
 * known cost of a line read before it). A USD line with no credit figure adds no credits.
 */
function creditsOf(entry, maxSeen = 0) {
  const known = knownCredits(entry);
  if (known !== null) return known;
  return entry.unit === 'usd' ? 0 : Math.max(UNKNOWN_FLOOR, maxSeen);
}

module.exports = { UNKNOWN_FLOOR, readJsonl, knownCredits, creditsOf };
