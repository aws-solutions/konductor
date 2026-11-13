// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads a strands-evals experiment file: {"cases": [{name, session_id, input, expected_output, expected_trajectory, metadata, ...}],
// "evaluators": [{evaluator_type, rubric}]}. The generator leaves most fields untyped, so anything may be null or any shape;
// this module only checks the outer structure and renames the fields. It never interprets them.

const fs = require('node:fs');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseExperiment(raw, sourceFile = null) {
  if (!isObject(raw)) {
    const got = raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw;
    throw new Error(`experiment must be a JSON object with a "cases" array, got ${got}`);
  }
  if (!Array.isArray(raw.cases)) throw new Error('experiment has no "cases" array');
  const cases = raw.cases.map((c, i) => {
    if (!isObject(c)) throw new Error(`case ${i} must be an object, got ${c === null ? 'null' : Array.isArray(c) ? 'an array' : typeof c}`);
    return {
      name: typeof c.name === 'string' ? c.name : '',
      sessionId: typeof c.session_id === 'string' ? c.session_id : null,
      input: c.input ?? null,
      expectedOutput: c.expected_output ?? null,
      expectedTrajectory: c.expected_trajectory ?? null,
      metadata: c.metadata ?? null,
    };
  });
  const evaluators = (Array.isArray(raw.evaluators) ? raw.evaluators : [])
    .filter(isObject)
    .map((e) => ({ evaluatorType: typeof e.evaluator_type === 'string' ? e.evaluator_type : null, rubric: typeof e.rubric === 'string' ? e.rubric : null }));
  return { sourceFile, cases, evaluators };
}

function loadExperiment(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`cannot read experiment file ${file}: ${e.message}`); }
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`experiment file ${file} is not valid JSON: ${e.message}`); }
  try { return parseExperiment(raw, file); } catch (e) { throw new Error(`${file}: ${e.message}`); }
}

module.exports = { loadExperiment, parseExperiment };
