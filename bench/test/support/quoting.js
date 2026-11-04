// SPDX-License-Identifier: Apache-2.0
/**
 * A rough measure of how much of a skill's wording a rubric item repeats, for tests of the control
 * task files. It is a stand-in for the task schema's quoting rule, not a copy of it, and it is
 * stricter in one way: callers compare the result with a limit below the schema's.
 *
 * Both texts are lower-cased and split into words; a trailing `ing`, `ed`, `es`, `s` or `ly` is
 * dropped from words of five or more letters. Two numbers come back:
 *  - `run`: the longest stretch of consecutive words the two texts share;
 *  - `chain`: the most skill words the item repeats in the skill's order, ignoring small words and
 *    allowing up to two other words between two repeated ones in either text.
 */
const SMALL_WORDS = new Set(
  (
    'a an the of to in on at for by with from into onto upon and or but nor so if then than that ' +
    'this these those it its is are was were be been being am do does did has have had will would ' +
    'shall should can could may might must also just very really quite rather simply only still ' +
    'even already yet about as over under per via you your we our they their he she his her them ' +
    'us me i my any each every all some such there here what which who whom when where while how why'
  ).split(' '),
);

const SUFFIXES = ['ing', 'ed', 'es', 's', 'ly'];

function stem(word) {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

const wordsOf = (text) =>
  (text.normalize('NFKC').toLowerCase().replace(/['\u2019]/g, '').match(/[\p{L}\p{N}]+/gu) || []).map(stem);

const SMALL_STEMS = new Set([...SMALL_WORDS, ...[...SMALL_WORDS].map(stem)]);

/** Longest run of consecutive words that appears in both arrays. */
function longestSharedRun(a, b) {
  let best = 0;
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = previous[j - 1] + 1;
        if (row[j] > best) best = row[j];
      }
    }
    previous = row;
  }
  return best;
}

/** Longest chain of item words found in the skill in the same order, with at most `gap` words between. */
function longestChain(item, skill, gap = 2) {
  const known = new Set(skill);
  const words = item.filter((w) => known.has(w));
  const where = new Map();
  skill.forEach((w, j) => where.set(w, [...(where.get(w) || []), j]));
  const reach = gap + 1;
  const chain = new Map();
  const stride = skill.length + 1;
  let best = 0;
  for (let i = 0; i < words.length; i += 1) {
    for (const j of where.get(words[i])) {
      let length = 1;
      for (let di = 1; di <= reach && di <= i; di += 1) {
        for (let dj = 1; dj <= reach && dj <= j; dj += 1) {
          const earlier = chain.get((i - di) * stride + (j - dj));
          if (earlier !== undefined && earlier + 1 > length) length = earlier + 1;
        }
      }
      chain.set(i * stride + j, length);
      if (length > best) best = length;
    }
  }
  return best;
}

/** `{ run, chain }` for one rubric item against one skill text. */
function sharedWording(item, skillText) {
  const itemWords = wordsOf(item);
  const skillWords = wordsOf(skillText);
  const content = (words) => words.filter((w) => !SMALL_STEMS.has(w));
  return {
    run: Math.max(longestSharedRun(itemWords, skillWords), longestSharedRun(content(itemWords), content(skillWords))),
    chain: longestChain(content(itemWords), content(skillWords)),
  };
}

module.exports = { wordsOf, sharedWording };
