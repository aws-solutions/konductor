// SPDX-License-Identifier: Apache-2.0
'use strict';

// Loading a criteria pack and linting it: schema, anchors and cross-references.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validate } = require('../../runner/lib/schema.js');
const { DETECTOR_DATA } = require('./detect.js');

const PACK_DIR = path.join(__dirname, '..', '..', 'criteria');
const LEVELS = ['fail', 'partial', 'pass'];
// Words that stand in for an observation. An anchor that needs one of them is not anchored.
const VAGUE = ['good', 'bad', 'clean', 'well', 'poor', 'poorly', 'adequate', 'adequately', 'appropriate', 'appropriately', 'reasonable', 'reasonably', 'sufficient', 'sufficiently', 'proper', 'properly', 'nice', 'nicely', 'clear', 'clearly', 'readable', 'elegant', 'robust', 'comprehensive', 'thorough', 'thoroughly', 'sensible', 'decent', 'solid', 'excellent'];

const PACK_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'id', 'artifactTypes', 'dimensions', 'criteria'],
  properties: {
    schemaVersion: { enum: [1] },
    id: { type: 'string', minLength: 1 },
    minAddedCodeLines: { type: 'integer', minimum: 0 },
    taskArtifacts: { type: 'object' },
    artifactTypes: { type: 'object' },
    dimensions: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' } } } },
    criteria: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'dimension', 'appliesTo', 'weight', 'question', 'levels'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          dimension: { type: 'string' },
          appliesTo: { type: 'array', minItems: 1, items: { type: 'string' } },
          weight: { type: 'number', minimum: 1 },
          question: { type: 'string', minLength: 1 },
          levels: { type: 'object', required: LEVELS, properties: { fail: { type: 'string' }, partial: { type: 'string' }, pass: { type: 'string' } } },
          evidence: { type: 'object', required: ['minQuotes', 'quote'], properties: { minQuotes: { enum: [1, 2] }, quote: { type: 'string', minLength: 1 } } },
          auto: { type: 'object', required: ['detector', 'partialAt', 'failAt'], properties: { detector: { enum: ['typography', 'filler', 'long-sentences', 'vague-terms', 'leftovers', 'weakened-tests'] }, partialAt: { type: 'integer', minimum: 1 }, failAt: { type: 'integer', minimum: 1 } } },
        },
      },
    },
  },
};

const sentences = (s) => (String(s).match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
// "e.g." style stops are not used in anchors, so a plain sentence count is enough; text in quotes may hold a full stop.
const sentenceCount = (s) => sentences(String(s).replace(/'[^']*'/g, 'Q')).length;

const isTerms = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x);
const isRegexList = (v) => isTerms(v) && v.every((x) => { try { new RegExp(x, 'i'); return true; } catch { return false; } });

// The list a detector reads must exist and compile: term lists are plain strings, pattern groups are lists of regular expressions.
function dataProblems(detector, key, value) {
  const at = `${key} (read by the ${detector} detector)`;
  if (key === 'fillerTerms' || key === 'vagueTerms') return isTerms(value) ? [] : [`${at} must be a non-empty list of strings`];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at} must be an object of pattern lists`];
  const groups = Object.entries(value);
  if (!groups.length || groups.some(([, list]) => !isRegexList(list))) return [`${at}: every group must be a non-empty list of valid regular expressions`];
  if (key === 'weakenedTestPatterns' && !(value.declaration && value.skip)) return [`${at} needs the groups declaration and skip`];
  return [];
}

/** Every problem with a pack as messages; empty means it is usable. Includes the anchor lint. */
function validatePack(pack) {
  const errors = validate(PACK_SCHEMA, pack);
  if (errors.length) return errors.slice(0, 5);
  const out = [];
  const dims = new Set(pack.dimensions.map((d) => d.id));
  const types = new Set(Object.keys(pack.artifactTypes));
  const seen = new Set();
  for (const c of pack.criteria) {
    const at = `criterion ${c.id}`;
    if (seen.has(c.id)) out.push(`${at}: duplicate id`);
    seen.add(c.id);
    if (!dims.has(c.dimension)) out.push(`${at}: dimension "${c.dimension}" is not declared`);
    for (const t of c.appliesTo) if (!types.has(t)) out.push(`${at}: appliesTo "${t}" is not an artifact type of the pack`);
    for (const lv of LEVELS) {
      const text = c.levels[lv];
      const n = sentenceCount(text);
      if (n < 1 || n > 2) out.push(`${at}: ${lv} anchor must be 1 or 2 sentences (has ${n})`);
      const vague = text.toLowerCase().match(/[a-z]+/g).filter((w) => VAGUE.includes(w));
      if (vague.length) out.push(`${at}: ${lv} anchor uses vague word(s) ${[...new Set(vague)].join(', ')}`);
    }
    if (new Set(LEVELS.map((lv) => c.levels[lv].toLowerCase())).size < 3) out.push(`${at}: two levels have the same anchor text`);
    if (/[\u2013\u2014]/.test(JSON.stringify(c))) out.push(`${at}: contains an em or en dash`);
    if (!c.evidence && !c.auto) out.push(`${at}: needs an evidence rule or an auto detector`);
    if (c.evidence && c.auto) out.push(`${at}: has both an evidence rule and an auto detector`);
    if (c.auto) {
      if (c.auto.failAt <= c.auto.partialAt) out.push(`${at}: failAt must be above partialAt`);
      for (const [lv, n] of [['partial', c.auto.partialAt], ['fail', c.auto.failAt]]) if (!new RegExp(`\\b${n}\\b`).test(c.levels[lv])) out.push(`${at}: the ${lv} anchor does not state the threshold ${n} that the detector uses`);
    }
  }
  for (const detector of new Set(pack.criteria.map((c) => c.auto?.detector).filter(Boolean))) {
    const key = DETECTOR_DATA[detector];
    if (key) out.push(...dataProblems(detector, key, pack[key]));
  }
  for (const d of dims) if (!pack.criteria.some((c) => c.dimension === d)) out.push(`dimension ${d} has no criterion`);
  for (const [task, list] of Object.entries(pack.taskArtifacts || {})) {
    if (!Array.isArray(list)) out.push(`taskArtifacts.${task} must be an array`);
    else for (const t of list) if (!types.has(t)) out.push(`taskArtifacts.${task}: "${t}" is not an artifact type of the pack`);
  }
  return out;
}

/** The pack named by --criteria-pack. Throws with the lint messages when it is not usable. */
function loadPack(name = 'quality', dir = PACK_DIR) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(name))) throw new Error(`--criteria-pack "${name}" is not a pack name`);
  const file = path.join(dir, `${name}-pack.json`);
  if (!fs.existsSync(file)) throw new Error(`--criteria-pack: no pack "${name}" (expected ${file})`);
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validatePack(pack);
  if (errors.length) throw new Error(`criteria pack ${name} is not valid:\n- ${errors.join('\n- ')}`);
  return { ...pack, revision: packRevision(pack) };
}

// Identifies what a judge was shown. A record made against another revision is stale and the report leaves it out.
function packRevision(pack) {
  const { revision, ...rest } = pack;
  void revision;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 12);
}

module.exports = { PACK_DIR, LEVELS, VAGUE, validatePack, loadPack, packRevision };
