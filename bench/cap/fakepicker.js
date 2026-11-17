// SPDX-License-Identifier: Apache-2.0
'use strict';

// A fake model for the selection test: given a request and the skill index (each skill's name and description), it
// picks the one skill whose description shares the most words with the request, or none. It stands in for the agent's
// choice, so `cap select --stub-behaviour fake` tests the whole path (pick, stream, read, score, confusion) with no
// model and no spend. It is a test double, never a measurement: a real model reads meaning, not shared words.
//
// shortcut: word overlap on descriptions only (words of 4+ letters, a short stop list, a trailing "s" dropped); upgrade
// to a scripted per-request answer file if a test needs a pick the overlap rule cannot express.

const { scanRepo } = require('./scan.js');

/** The fewest shared words a pick needs; fewer means the fake picks no skill. */
const MIN_OVERLAP = 2;
const STOP = new Set(['that', 'this', 'with', 'from', 'when', 'what', 'your', 'have', 'into', 'them', 'they', 'will', 'should', 'would', 'about', 'there', 'their', 'which', 'before', 'after', 'other', 'than', 'then', 'also', 'only', 'more', 'most', 'each', 'some', 'such', 'does', 'make', 'need', 'needs', 'used', 'using', 'uses', 'skill', 'skills', 'please', 'tell']);

/** The words of `text` the fake compares: lowercase, 4+ letters, not a stop word, a trailing "s" dropped. */
function wordsOf(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!STOP.has(w)) out.add(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  return out;
}

/**
 * The skill index of a tree: [{ name, description }] for every skill with a description.
 * @param {string} repo the repository root
 */
function catalogOf(repo) {
  return [...scanRepo(repo).values()].filter((c) => c.kind === 'skill' && c.description.present).map((c) => ({ name: c.name, description: c.description.text }));
}

/**
 * A picker: (prompt) => the picked skill's name, or null. The pick is the skill with the most shared words, at least
 * `minOverlap`; a tie goes to the name first in order, so the fake is deterministic.
 * @param {object} o
 * @param {{ name: string, description: string }[]} o.catalog the skill index
 * @param {number} [o.minOverlap] the fewest shared words a pick needs
 */
function createFakePicker({ catalog, minOverlap = MIN_OVERLAP }) {
  const index = [...catalog].sort((a, b) => (a.name < b.name ? -1 : 1)).map((s) => ({ name: s.name, words: wordsOf(s.description) }));
  return (prompt) => {
    const asked = wordsOf(prompt);
    let best = null;
    let bestScore = minOverlap - 1;
    for (const s of index) {
      let n = 0;
      for (const w of asked) if (s.words.has(w)) n += 1;
      if (n > bestScore) { best = s.name; bestScore = n; }
    }
    return best;
  };
}

module.exports = { MIN_OVERLAP, wordsOf, catalogOf, createFakePicker };
