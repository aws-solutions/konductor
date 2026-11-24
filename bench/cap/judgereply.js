// SPDX-License-Identifier: Apache-2.0
// Ported from Michael Lin's scripts/bench/lib/judge-scale.js `parseReply` and `topLevelKeys` (aws-solutions/konductor
// pull request #235), same repository and Apache-2.0 licence. The strict rules are his; the reply field is `labels`
// here, because the cap judge prompt (kiroprovider.js judgePrompt) asks for {"labels": [...]}.
'use strict';

/**
 * The strict reader of a judge's reply. A lenient reader would score a reply the prompt did not ask for (the old reader
 * took the text from the first `{` to the last `}` and upper-cased each label). The whole reply must be one JSON object
 * with `labels` (and optionally a string `reason`), holding exactly one upper-case label per checklist item, in order.
 * Prose around the JSON, two objects, a lower-case label, a missing or extra label, an unknown field and a field given
 * twice are all invalid, with a reason and a `kind` from INVALID_KINDS. One leniency: a single code fence around the
 * whole reply (bare or tagged `json`) is removed, because it adds no text and no second object and models add it often.
 */

const LABELS = Object.freeze(['MET', 'PARTIAL', 'MISSING']);
const REPLY_FIELDS = Object.freeze(['labels', 'reason']);
/** Why a reply is invalid, as a code a run can count. */
const INVALID_KINDS = Object.freeze(['empty', 'not_json', 'not_object', 'fields', 'labels']);

// One fence around the whole trimmed reply: the opening line is ``` or ```json and nothing else, the closing line is ```.
// A line ends in \n or \r\n (a reply from a CRLF host), and the carriage return is not part of the body.
const WHOLE_REPLY_FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```$/;

const invalid = (kind, why) => ({ valid: false, kind, invalid: why });

/**
 * The keys of the top-level object in `json`, in order and with repeats. JSON.parse keeps only the last of two equal
 * keys, so a repeat is found here instead. Text that is not valid JSON is not scanned for structure, but a string that
 * is never closed (a reply cut off by a token limit) throws a SyntaxError that names where it starts, so no input can
 * make the scan run on.
 */
function topLevelKeys(json) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (char === '"') {
      let end = i + 1;
      while (end < json.length && json[end] !== '"') end += json[end] === '\\' ? 2 : 1;
      if (end >= json.length) throw new SyntaxError(`topLevelKeys: the string that starts at offset ${i} is not closed`);
      if (depth === 1) {
        let next = end + 1;
        while (/\s/.test(json[next])) next++;
        if (json[next] === ':') keys.push(JSON.parse(json.slice(i, end + 1)));
      }
      i = end;
    } else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
  }
  return keys;
}

/** Why `labels` is not `count` upper-case labels, or null when it is. */
function labelProblem(labels, count) {
  if (!Array.isArray(labels)) return 'labels must be an array of labels';
  if (labels.length !== count) return `labels has ${labels.length} labels, expected ${count}`;
  const bad = labels.findIndex((l) => typeof l !== 'string' || !LABELS.includes(l));
  return bad < 0 ? null : `labels[${bad}] is not one of ${LABELS.join(', ')}`;
}

/**
 * The reply of a judge as { valid: true, labels, reason, normalized }, or { valid: false, kind, invalid: <why> }.
 * `count` is the length of the checklist the judge was shown. `normalized` is 'fence' when one code fence around the
 * whole reply was removed, else null.
 */
function parseReply(text, count) {
  if (!Number.isInteger(count) || count < 1) throw new TypeError('itemCount must be a whole number, 1 or more');
  if (typeof text !== 'string' || !text.trim()) return invalid('empty', 'the reply is empty');
  const trimmed = text.trim();
  const fence = WHOLE_REPLY_FENCE.exec(trimmed);
  const body = fence ? fence[1] : trimmed;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return invalid('not_json', 'the reply is not one JSON object (prose around it, a fence with more than the object, two objects or broken JSON)');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid('not_object', 'the reply is not a JSON object');
  const unexpected = Object.keys(parsed).filter((f) => !REPLY_FIELDS.includes(f));
  if (unexpected.length) return invalid('fields', `unexpected field(s): ${unexpected.join(', ')}`);
  // Two "labels" in one object would let the last array win, whatever the first one said.
  const keys = topLevelKeys(body);
  const repeated = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (repeated.length) return invalid('fields', `repeated field(s): ${repeated.join(', ')}`);
  const problem = labelProblem(parsed.labels, count);
  if (problem) return invalid('labels', problem);
  if (parsed.reason !== undefined && typeof parsed.reason !== 'string') return invalid('fields', 'reason must be a string');
  return { valid: true, labels: parsed.labels, reason: parsed.reason ?? null, normalized: fence ? 'fence' : null };
}

/** The labels of the reply `text` to a checklist of `count` items; throws the reason when the reply is invalid. */
function labelsOf(text, count) {
  const r = parseReply(text, count);
  if (!r.valid) throw new Error(r.invalid);
  return r.labels;
}

module.exports = { LABELS, INVALID_KINDS, topLevelKeys, parseReply, labelsOf };
