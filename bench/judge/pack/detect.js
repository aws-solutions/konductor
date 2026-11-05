// SPDX-License-Identifier: Apache-2.0
'use strict';

// Deterministic criteria for written content: counts of typography marks, filler terms and long sentences in the added prose.

const QUOTE_SEPARATOR = ' @@ ';

const FENCE = /^\s*(```|~~~)/;

/** The added prose lines of the given files: fenced code, inline code, tables and URLs left out. */
function proseOf(stats, rels) {
  const keep = new Set(rels);
  const out = [];
  for (const f of stats.filter((x) => keep.has(x.rel))) {
    let fenced = false;
    for (const o of f.ops) {
      if (o.op === '-') continue;
      if (FENCE.test(o.text)) { fenced = !fenced; continue; }
      if (fenced || o.op !== '+') continue;
      if (/^\s*\|/.test(o.text)) continue;
      out.push(o.text.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' '));
    }
  }
  return out.join('\n');
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DASHES = /[\u2013\u2014]| -- /g;
const CURLY = /[\u2018\u2019\u201C\u201D]/g;

const DETECTORS = {
  typography: (text) => [...text.matchAll(DASHES), ...text.matchAll(CURLY)].map((m) => m[0].trim() || '--'),
  filler: (text, pack) => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${pack.fillerTerms.map(escapeRe).join('|')})(?![\\p{L}\\p{N}-])`, 'giu');
    return [...text.matchAll(re)].map((m) => m[0].toLowerCase());
  },
  'long-sentences': (text) => text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length > 35).map((x) => `${x.split(/\s+/).slice(0, 8).join(' ')}...`),
};

/** A deterministic criterion scored from counts. The evidence lists what was counted, so a person can audit it. */
function autoResult(criterion, pack, prose) {
  const hits = DETECTORS[criterion.auto.detector](prose, pack);
  const n = hits.length;
  const verdict = n >= criterion.auto.failAt ? 'fail' : n >= criterion.auto.partialAt ? 'partial' : 'pass';
  const shown = [...new Set(hits)].slice(0, 5).join(QUOTE_SEPARATOR);
  return { id: criterion.id, dimension: criterion.dimension, status: 'auto', verdict, verdictRaw: verdict, count: n, evidence: n ? `${n} found: ${shown}` : '0 found', evidenceFound: true };
}

function autoCriteria(pack, items) {
  return items.filter((i) => i.status === 'auto').map((i) => autoResult(i.criterion, pack, i.prose));
}

module.exports = { QUOTE_SEPARATOR, proseOf, DETECTORS, autoCriteria };
