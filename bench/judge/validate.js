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

module.exports = { parseJsonStrict, validateRubricReply, validatePairReply };
