// SPDX-License-Identifier: Apache-2.0
'use strict';

// Turns a parsed experiment into scenario candidates for review. Every field the generator wrote is a proposal: the importer
// filters and normalizes, it does not decide what the agent should do.

const { extractTools } = require('./tool-names.js');
const { checkInput, checkExpectedOutput } = require('./validity.js');
const { findDuplicates, DEFAULT_THRESHOLD } = require('./dedup.js');
const { parseRules, checkRules } = require('./rules.js');

const REJECT_CODES = new Set(['input:empty', 'input:placeholder', 'input:chatter', 'input:title-like', 'input:too-short', 'duplicate']);
const STATUSES = ['ok', 'needs-edit', 'reject'];

const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');

const isEmptyTrajectory = (t) => t == null || (Array.isArray(t) && t.length === 0);

const outputText = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * @param {ReturnType<import('./experiment.js').parseExperiment>} experiment
 * @param {object} opts
 * @param {string[]} opts.tools declared tool names
 * @param {object[]} [opts.rules] rules from loadRules/parseRules
 * @param {number} [opts.batches] number of generation batches (topics) the cases were produced in, in order
 * @param {number} [opts.duplicateThreshold]
 * @param {object} [opts.source] provenance copied onto every candidate (version, model, contextSha256, taskDescription)
 */
function buildCandidates(experiment, opts = {}) {
  const { tools, batches, source = {}, duplicateThreshold = DEFAULT_THRESHOLD } = opts;
  if (batches !== undefined && !(Number.isInteger(batches) && batches >= 1)) throw new RangeError('batches must be a positive integer');
  const given = opts.rules ?? [];
  const rules = given.every((r) => r && r.kind) ? given : parseRules(given, { tools });
  const n = experiment.cases.length;

  const checked = experiment.cases.map((c) => checkInput(c.input, { taskDescription: source.taskDescription }));
  const ids = experiment.cases.map((c, i) => `${slug(c.name) || 'case'}-${i}`);
  const dups = findDuplicates(checked.map((r) => (r.ok ? r.input : null)), duplicateThreshold);

  const candidates = experiment.cases.map((c, i) => {
    const inputCheck = checked[i];
    const extraction = extractTools(c.expectedTrajectory, tools);
    const output = checkExpectedOutput(c.expectedOutput);
    const reasons = [...inputCheck.reasons];
    const add = (code, text) => reasons.push({ code, text });

    if (inputCheck.multiTurn) add('input:multi-turn', 'the input holds more than one speaker-labelled turn');
    if (dups[i]) add('duplicate', `near-duplicate of ${ids[dups[i].of]} (token overlap ${dups[i].similarity})`);
    if (extraction.steps > 0) {
      if (extraction.quality === 'extracted') add('trajectory:not-clean', `tool names were recovered from a mixed or prose trajectory, not only call strings or dicts that name a tool (${extraction.notes.join('; ') || 'list, prose or noisy steps'})`);
      else if (extraction.quality === 'none') add('trajectory:unreadable', 'the trajectory has steps but no declared tool name could be found');
    }
    if (extraction.undeclared.length) add('tool:undeclared', `the trajectory names tools the agent does not declare: ${extraction.undeclared.join(', ')}`);
    if (output.placeholderOutput) add('output:placeholder', `the expected output holds unfilled placeholders: ${output.matches.join(' ')}`);
    if (inputCheck.ok) for (const v of checkRules(rules, { tools: extraction.tools, input: inputCheck.input })) add(v.code, v.text);

    const status = reasons.some((r) => REJECT_CODES.has(r.code)) ? 'reject' : reasons.length ? 'needs-edit' : 'ok';
    const candidate = {
      id: ids[i],
      input: inputCheck.input,
      inputNormalized: inputCheck.normalized,
      ...(inputCheck.normalized ? { rawInput: typeof c.input === 'string' ? c.input : null } : {}),
      expectedOutputText: outputText(c.expectedOutput),
      proposedTools: extraction.tools,
      trajectoryQuality: extraction.quality,
      trajectoryNotes: extraction.notes,
      undeclaredTools: extraction.undeclared,
      multiTurn: inputCheck.multiTurn,
      placeholderOutput: output.placeholderOutput,
      duplicateOf: dups[i] ? ids[dups[i].of] : null,
      ...(batches ? { batchIndex: Math.min(batches - 1, Math.floor(i / (n / batches))), batchInferred: true } : {}),
      generatorMetadata: c.metadata,
      generatorTrajectory: c.expectedTrajectory,
      status,
      reasons,
      source: { ...source, generator: 'strands-evals', sourceFile: experiment.sourceFile, caseIndex: i, sessionId: c.sessionId },
    };
    return candidate;
  });

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byReason = {};
  const byQuality = { clean: 0, structured: 0, extracted: 0, none: 0 };
  for (const c of candidates) {
    byStatus[c.status]++;
    byQuality[c.trajectoryQuality]++;
    for (const code of new Set(c.reasons.map((r) => r.code))) byReason[code] = (byReason[code] ?? 0) + 1;
  }
  const rubrics = experiment.evaluators.map((e) => e.rubric).filter((r) => typeof r === 'string' && r.trim());
  return {
    candidates,
    summary: { total: n, byStatus, byReason, byQuality, trajectoriesGenerated: experiment.cases.some((c) => !isEmptyTrajectory(c.expectedTrajectory)) },
    rubricHint: rubrics.length ? rubrics.map((r) => r.trim()).join('\n\n') : null,
  };
}

module.exports = { buildCandidates, REJECT_CODES };
