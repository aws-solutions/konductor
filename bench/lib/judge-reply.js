// SPDX-License-Identifier: Apache-2.0
/**
 * Reading a judge's reply text. The judge is told to answer with one JSON object. `parseReply`
 * finds that object in the stored `raw_text` and hands it to the scale's own parser
 * (judge-scale.js), so what counts as a usable reply is decided in core and never by the plugin
 * that fetched the text. It is pure: the same text always gives the same result, which is what
 * lets a stored reply be read again later with no model call.
 *
 * The object is the text from the first `{` to the last `}`. Prose or a code fence around it is
 * tolerated. A reply with no object, an object that is not valid JSON, or two objects (the slice
 * between them is not valid JSON) is unusable: the judge was told to give one, and guessing which
 * of two it meant would be a choice the judge did not make. A reply longer than MAX_REPLY_CHARS is
 * unusable.
 *
 * The result has the shape of every scale's `parse`: `{ winner, score_a, score_b, reason, problem }`
 * plus the item labels on the items scale. `winner` is null and `problem` says why when the reply
 * is unusable.
 */
const { resolveScale } = require('./judge-scale');

/** The longest reply text that is read. A longer one is stored cut and is unusable. */
const MAX_REPLY_CHARS = 100000;

const unusable = (problem) => ({
  winner: null,
  score_a: null,
  score_b: null,
  reason: null,
  problem,
});

/** The JSON object in `text`, or `{ problem }` saying why there is none. */
function extractObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return { problem: 'the reply holds no JSON object' };
  let value;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return { problem: 'the reply is not one valid JSON object' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { problem: 'the reply is not one valid JSON object' };
  }
  return { value };
}

/**
 * Reads `rawText` on the scale `scaleId`. `rubricLength`, when given, is the number of checklist
 * items; the items scale refuses a reply with another number of labels. An unknown scale throws.
 */
function parseReply(scaleId, rawText, { rubricLength = null } = {}) {
  const scale = resolveScale(scaleId);
  if (typeof rawText !== 'string' || rawText.trim() === '') return unusable('the reply is empty');
  if (rawText.length > MAX_REPLY_CHARS) {
    return unusable(`the reply is longer than ${MAX_REPLY_CHARS} characters`);
  }
  const found = extractObject(rawText);
  if (found.problem) return unusable(found.problem);
  return scale.parse(found.value, { rubricLength });
}

module.exports = { MAX_REPLY_CHARS, extractObject, parseReply };
