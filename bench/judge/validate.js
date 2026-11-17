// SPDX-License-Identifier: Apache-2.0
'use strict';

const { validate } = require('../runner/lib/schema.js');

const RUBRIC_SCHEMA = {
  type: 'object',
  required: ['criteria'],
  properties: {
    criteria: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'verdict', 'evidence'],
        properties: {
          id: { type: 'string' },
          verdict: { enum: ['pass', 'partial', 'fail'] },
          evidence: { type: 'string' },
        },
      },
    },
  },
};

const PAIR_SCHEMA = {
  type: 'object',
  required: ['winner', 'reason'],
  properties: { winner: { enum: ['A', 'B', 'tie'] }, reason: { type: 'string' } },
};

const GRADE = { enum: [1, 2, 3, 4, 5] };
const GRADED_SCHEMA = {
  type: 'object',
  required: ['gradeA', 'gradeB', 'reason'],
  properties: { gradeA: GRADE, gradeB: GRADE, reason: { type: 'string' } },
};

// Strict: bare JSON, or JSON inside a single code fence. Prose around it is a failure.
function parseJsonStrict(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, error: `not valid JSON (${e.message.slice(0, 80)})` };
  }
}

// A quote mark inside a string closes it only when what follows can follow a JSON string: a closing bracket, a colon, the end,
// or a comma and then the next key or element.
function closesString(s, i) {
  let j = i + 1;
  while (j < s.length && /\s/.test(s[j])) j++;
  if (j >= s.length || '}]:'.includes(s[j])) return true;
  if (s[j] !== ',') return false;
  j++;
  while (j < s.length && /\s/.test(s[j])) j++;
  return j >= s.length || '"{['.includes(s[j]);
}

const JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

// Escapes a stray quote mark inside a string, and keeps as text a backslash JSON cannot read (\x, \s, \'). These are the two
// slips in judge replies saved so far: a quote wrapped in its own quote marks ("evidence":""text""), and code with backslashes
// copied into a quote (`'\x1b[?25l'`, `/[\s-]+/`). Everything outside strings is left alone.
function repairStrings(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) { if (c === '"') inString = true; out += c; continue; }
    if (c === '\\') {
      const n = text[i + 1];
      if (n !== undefined && JSON_ESCAPES.has(n)) { out += `${c}${n}`; i++; } else out += '\\\\';
      continue;
    }
    if (c === '"') {
      if (closesString(text, i)) { inString = false; out += c; } else out += '\\"';
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * parseJsonStrict, then one repair of the string slips repairStrings fixes. The reply's structure is never guessed: prose
 * around the JSON still fails, because in the saved replies that prose takes the answer back ("I need to re-evaluate").
 * `repaired` is true when the repair was needed; the caller still checks the value's shape.
 */
function parseJsonReply(text) {
  const strict = parseJsonStrict(text);
  if (strict.ok) return strict;
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(repairStrings(s)), repaired: true };
  } catch {
    return strict;
  }
}

function validateRubricReply(value, rubric) {
  const errors = validate(RUBRIC_SCHEMA, value);
  if (errors.length) return { ok: false, error: errors.slice(0, 3).join('; ') };
  const want = rubric.map((r) => r.id);
  const got = value.criteria.map((c) => c.id);
  const missing = want.filter((id) => !got.includes(id));
  const extra = got.filter((id) => !want.includes(id));
  const dups = got.filter((id, i) => got.indexOf(id) !== i);
  if (missing.length || extra.length || dups.length) {
    return { ok: false, error: `criteria ids must match the rubric exactly (missing: ${missing.join(',') || '-'}; unknown: ${extra.join(',') || '-'}; duplicate: ${dups.join(',') || '-'})` };
  }
  return { ok: true, criteria: value.criteria };
}

function validatePairReply(value) {
  const errors = validate(PAIR_SCHEMA, value);
  return errors.length ? { ok: false, error: errors.slice(0, 3).join('; ') } : { ok: true, winner: value.winner, reason: value.reason };
}

function validateGradedReply(value) {
  const errors = validate(GRADED_SCHEMA, value);
  return errors.length ? { ok: false, error: errors.slice(0, 3).join('; ') } : { ok: true, gradeA: value.gradeA, gradeB: value.gradeB, reason: value.reason };
}

module.exports = { parseJsonStrict, parseJsonReply, repairStrings, validateRubricReply, validatePairReply, validateGradedReply };
