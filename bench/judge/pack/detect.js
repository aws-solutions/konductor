// SPDX-License-Identifier: Apache-2.0
'use strict';

// Deterministic criteria: counts of typography marks, filler and vague terms, long sentences, debug leftovers and weakened
// tests in what the agent added. Each detector reads one kind of text (DETECTOR_SOURCE); the gate builds it.

const QUOTE_SEPARATOR = ' @@ ';

const FENCE = /^\s*(```|~~~)/;

/** The added prose lines of the given files: fenced code, inline code and URLs left out; tables left out unless asked for. */
function proseOf(stats, rels, { tables = false } = {}) {
  const keep = new Set(rels);
  const out = [];
  for (const f of stats.filter((x) => keep.has(x.rel))) {
    let fenced = false;
    for (const o of f.ops) {
      if (o.op === '-') continue;
      if (FENCE.test(o.text)) { fenced = !fenced; continue; }
      if (fenced || o.op !== '+') continue;
      if (/^\s*\|/.test(o.text) && (!tables || /^\s*\|[\s:|-]+\|?\s*$/.test(o.text))) continue;
      out.push(o.text.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' '));
    }
  }
  return out.join('\n');
}

/** The lines the agent added to the given code files, one per line. */
function addedCodeOf(stats, rels) {
  const keep = new Set(rels);
  return stats.filter((f) => keep.has(f.rel)).flatMap((f) => f.ops.filter((o) => o.op === '+').map((o) => o.text)).join('\n');
}

/** The changed lines of test files (`+` or `-` first) and one `D path` line per deleted test file. */
function testDiffOf(stats, rels, deletedTests = []) {
  const keep = new Set(rels);
  const lines = stats.filter((f) => keep.has(f.rel)).flatMap((f) => f.ops.filter((o) => o.op !== ' ').map((o) => `${o.op}${o.text}`));
  return [...lines, ...deletedTests.map((p) => `D ${p}`)].join('\n');
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DASHES = /[\u2013\u2014]| -- /g;
const CURLY = /[\u2018\u2019\u201C\u201D]/g;
const WORD_EDGE = ['(?<![\\p{L}\\p{N}-])', '(?![\\p{L}\\p{N}-])'];
const termRegex = (terms) => new RegExp(`${WORD_EDGE[0]}(?:${terms.map(escapeRe).join('|')})${WORD_EDGE[1]}`, 'giu');
const compileAll = (list) => list.map((p) => new RegExp(p, 'i'));

// A requirement statement: it says shall, must, should or will, or it starts with an id such as REQ-3 or FR2.
const STATEMENT = /\b(?:shall|must|should|will)\b|\b[A-Z]{2,5}-?\d+\b/;
const ID = /\b[A-Z]{2,5}-?\d+\b/g;
// A line that talks about a vague term (flags it) does not use it.
const FLAGGING = /\b(?:ambigu\w*|vague|undefined|unclear|unspecified|unquantified|clarif\w*|not defined|no number|needs? (?:a |an )?(?:number|value|target|definition))\b/i;
// Sections about the request itself, not requirements: the vague terms there are quoted on purpose.
const REQUEST_SECTION = /assum|question|ambigu|conflict|gap|clarif|risk|scope|glossary|decision|stakeholder|request/i;

/** Units to test for a number: a table row whole, a prose line one sentence at a time. */
function statementUnits(line) {
  const bare = line.replace(ID, ' ').replace(/^\s*(?:[-*]\s+|\d+[.)]\s+)/, '');
  return /^\s*\|/.test(line) ? [bare] : bare.split(/(?<=[.!?])\s+/);
}

const DETECTORS = {
  typography: (text) => [...text.matchAll(DASHES), ...text.matchAll(CURLY)].map((m) => m[0].trim() || '--'),
  filler: (text, pack) => [...text.matchAll(new RegExp(`${WORD_EDGE[0]}(?:${pack.fillerTerms.map(escapeRe).join('|')})${WORD_EDGE[1]}`, 'giu'))].map((m) => m[0].toLowerCase()),
  'long-sentences': (text) => text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length > 35).map((x) => `${x.split(/\s+/).slice(0, 8).join(' ')}...`),
  'vague-terms': (text, pack) => {
    const re = termRegex(pack.vagueTerms);
    const hits = [];
    let skip = false;
    for (const line of text.split('\n')) {
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)/);
      if (heading) { skip = REQUEST_SECTION.test(heading[1]); continue; }
      if (skip || !STATEMENT.test(line) || FLAGGING.test(line)) continue;
      const plain = line.replace(/"[^"]*"|\u201C[^\u201D]*\u201D/g, ' ');
      for (const unit of statementUnits(plain)) {
        if (/\d/.test(unit)) continue;
        for (const m of unit.matchAll(re)) hits.push(m[0].toLowerCase());
      }
    }
    return hits;
  },
  leftovers: (text, pack) => {
    const groups = Object.values(pack.leftoverPatterns).map(compileAll);
    return text.split('\n').filter((line) => groups.some((g) => g.some((re) => re.test(line)))).map((l) => l.trim().slice(0, 60));
  },
  'weakened-tests': (text, pack) => {
    const declaration = compileAll(pack.weakenedTestPatterns.declaration);
    const skip = compileAll(pack.weakenedTestPatterns.skip);
    const hits = [];
    let removed = 0;
    let added = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('D ')) { hits.push(`deleted ${line.slice(2)}`); continue; }
      const body = line.slice(1);
      if (line[0] === '+' && skip.some((re) => re.test(body))) hits.push(`skipped: ${body.trim().slice(0, 50)}`);
      if (declaration.some((re) => re.test(body))) { if (line[0] === '-') removed++; else added++; }
    }
    // A rewritten test shows as one removed and one added declaration; only the net loss counts.
    for (let i = 0; i < removed - added; i++) hits.push('removed a test declaration');
    return hits;
  },
};

// What the gate builds for each detector: prose of the document types the criterion applies to (tables kept or not),
// the added lines of changed code and tests, or the changed lines of test files.
const DETECTOR_SOURCE = {
  typography: 'prose', filler: 'prose', 'long-sentences': 'prose', 'vague-terms': 'prose-tables', leftovers: 'added-code', 'weakened-tests': 'test-diff',
};
// The pack list each detector reads, checked by the pack lint.
const DETECTOR_DATA = { filler: 'fillerTerms', 'vague-terms': 'vagueTerms', leftovers: 'leftoverPatterns', 'weakened-tests': 'weakenedTestPatterns' };

/** A deterministic criterion scored from counts. The evidence lists what was counted, so a person can audit it. */
function autoResult(criterion, pack, text) {
  const hits = DETECTORS[criterion.auto.detector](text, pack);
  const n = hits.length;
  const verdict = n >= criterion.auto.failAt ? 'fail' : n >= criterion.auto.partialAt ? 'partial' : 'pass';
  const shown = [...new Set(hits)].slice(0, 5).join(QUOTE_SEPARATOR);
  return { id: criterion.id, dimension: criterion.dimension, status: 'auto', verdict, verdictRaw: verdict, count: n, evidence: n ? `${n} found: ${shown}` : '0 found', evidenceFound: true };
}

function autoCriteria(pack, items) {
  return items.filter((i) => i.status === 'auto').map((i) => autoResult(i.criterion, pack, i.text));
}

module.exports = { QUOTE_SEPARATOR, proseOf, addedCodeOf, testDiffOf, DETECTORS, DETECTOR_SOURCE, DETECTOR_DATA, autoCriteria };
