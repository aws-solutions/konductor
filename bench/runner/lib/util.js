// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small helpers used across bench, one tested copy each (DEBT D-23). A module that needs one requires it from here
// instead of writing its own one-liner.

const crypto = require('node:crypto');
const fs = require('node:fs');
// The one seeded generator of the repository (main's statistics scripts); bench draws from it too.
const { mulberry32 } = require('../../../tests/scripts/stats.js');

/** The sha256 of a string or buffer, as hex. */
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** The parsed JSON file; throws when it is missing or not JSON. */
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The parsed JSON file, or null when it is missing or not JSON. */
const readJsonOrNull = (file) => { try { return readJson(file); } catch { return null; } };

/** The text of a file, or null when it cannot be read. */
const readTextOrNull = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

/** Groups `items` into a Map by `keyOf(item)`, keys in first-seen order. */
function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const k = keyOf(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

/** A copy of `items` in the order `rand` gives (Fisher-Yates). */
function shuffle(items, rand) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A copy of `list` in a seeded order: the same `seed` always gives the same order. */
const seededShuffle = (list, seed) => shuffle(list, mulberry32(seed));

module.exports = { sha256, readJson, readJsonOrNull, readTextOrNull, groupBy, mulberry32, shuffle, seededShuffle };
