// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small text helpers for the capability audit: description tokens, Jaccard similarity and word shingles.

const STOP = new Set((
  'a an and are as at be but by can do for from has have how if in into is it its not of on or so that the their then there these this to '
  + 'use used uses using when whenever with you your will would should must may also any all each per via than too very more most such what which who while '
  + 'after before during about over under both only same other its one two'
).split(' '));

const words = (text) => String(text).toLowerCase().match(/[a-z0-9_]+/g) ?? [];

/** The content words of a description: lower case, at least three letters, no stop words. */
function descTokens(text) {
  return new Set(words(text).filter((w) => w.length >= 3 && /^[a-z]/.test(w) && !STOP.has(w)));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The set of k-word windows of a text. Text shorter than k words has none. */
function shingles(text, k = 8) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}

/** Share of `material` shingles that also occur in `source`. */
function overlapFraction(material, source) {
  if (!material.size) return 0;
  let n = 0;
  for (const s of material) if (source.has(s)) n++;
  return n / material.size;
}

const CUE = /\buse\s+(?:this\s+|it\s+)?(?:skill\s+)?(?:when|for|after|before|if|to|whenever|during)\b/i;

/** Finder keywords: the content words of the clause after the "use when" cue (else the first sentence), at most `max`. */
function cueKeywords(description, max = 8) {
  const m = CUE.exec(description);
  const clause = m ? description.slice(m.index + m[0].length) : description;
  const sentence = clause.split(/\.(?:\s|$)/)[0];
  return [...new Set(words(sentence).filter((w) => w.length >= 3 && /^[a-z]/.test(w) && !STOP.has(w)))].slice(0, max);
}

module.exports = { descTokens, jaccard, shingles, overlapFraction, cueKeywords, CUE, words, STOP };
