// SPDX-License-Identifier: Apache-2.0
'use strict';

const { tokens } = require('../../skilleval/lib/util.js');

const DEFAULT_THRESHOLD = 0.6;

function jaccardSets(x, y) {
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

/**
 * Token Jaccard over the inputs. A later case points at the first earlier case it matches; entries that are null or blank are
 * skipped on both sides, so an invalid input never becomes the original of another.
 * @param {(string|null)[]} inputs
 * @param {number} [threshold]
 * @returns {({of: number, similarity: number}|null)[]}
 */
function findDuplicates(inputs, threshold = DEFAULT_THRESHOLD) {
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError('threshold must be in (0, 1]');
  const sets = inputs.map((s) => (typeof s === 'string' && s.trim() ? new Set(tokens(s)) : null));
  const kept = [];
  return sets.map((set, i) => {
    if (!set) return null;
    for (const j of kept) {
      const similarity = jaccardSets(sets[j], set);
      if (similarity >= threshold) return { of: j, similarity: Math.round(similarity * 100) / 100 };
    }
    kept.push(i);
    return null;
  });
}

module.exports = { findDuplicates, DEFAULT_THRESHOLD };
