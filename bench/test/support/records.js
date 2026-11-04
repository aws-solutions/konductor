// SPDX-License-Identifier: Apache-2.0
/**
 * Builders for synthetic stored records, shared by the store, judge and pipeline tests. Nothing
 * here is a real run: names, models and families are placeholders.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PROVENANCE_VERSION, pairInputs, judgmentInputs, sha256 } = require('../../lib/provenance');

const SKILL = 'toy-skill';
const FINGERPRINT = 'replay-runner@1';

/** A temporary directory that the test removes when it ends. */
function tempDir(t, prefix = 'bench-store-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A stored pair record with a correct digest. */
function makePair({
  skill = SKILL,
  taskId = 'task-1',
  arm = 'with',
  request = 'Add a flag.',
  fingerprint = FINGERPRINT,
  answer = 'Done.',
  start = {},
  final = {},
  loaded = arm === 'with',
  checkResults,
} = {}) {
  return {
    provenance_version: PROVENANCE_VERSION,
    skill,
    task_id: taskId,
    arm,
    answer,
    start,
    final,
    loaded,
    runner_fingerprint: fingerprint,
    ...(checkResults === undefined ? {} : { check_results: checkResults }),
    inputs: pairInputs({
      taskId,
      arm,
      request,
      runnerFingerprint: fingerprint,
      answer,
      start,
      final,
      loaded,
      checkResults,
    }),
  };
}

const TEMPLATE = Object.freeze({ version: 2, sha256: 'a'.repeat(64) });
const SANITIZER = Object.freeze({ version: 2, hash: 'b'.repeat(64) });

/** The `expected` argument of the judgment freshness checks, with a digest over a fake prompt. */
function expectedJudgment({
  skill = SKILL,
  taskId = 'task-1',
  seat = 'seat-a',
  order = 'with-first',
  model = '<provider>/<model-1>',
  prompt = 'rendered prompt',
  request = 'Add a flag.',
  rubric = ['Names the flag.'],
  template = TEMPLATE,
  sanitizer = SANITIZER,
  scale = 'overall',
} = {}) {
  return {
    skill,
    taskId,
    seat,
    order,
    model,
    inputs: judgmentInputs({ request, rubric, prompt, template, scale, sanitizer, order, seat }),
  };
}

/** A stored judgment record for `expected`. `fields` overrides any field. */
function makeJudgment(expected = expectedJudgment(), fields = {}) {
  const parsed = { winner: 'A', score_a: 4, score_b: 2, reason: 'a', problem: null };
  return {
    provenance_version: PROVENANCE_VERSION,
    skill: expected.skill,
    task_id: expected.taskId,
    seat: expected.seat,
    family: 'family-a',
    plugin: 'replay',
    judge_model: expected.model,
    order: expected.order,
    judge_scale: expected.inputs.judge_scale,
    prompt_version: expected.inputs.prompt_version,
    prompt_sha256: expected.inputs.prompt_sha256,
    sanitizer_version: expected.inputs.sanitizer_version,
    sanitizer_rules_sha256: expected.inputs.sanitizer_rules_sha256,
    nonce: 'nonce-0001',
    inputs: expected.inputs,
    status: 'ok',
    attempts: 1,
    raw_text: JSON.stringify({ winner: 'A', score_a: 4, score_b: 2, reason: 'a' }),
    parsed,
    usage: null,
    cost: null,
    error: null,
    ...fields,
  };
}

/** A stored result record whose input digest is `inputs.result_input_sha256`. */
function makeResult({ skill = SKILL, rule, inputs, result = { verdict: {} } }) {
  return {
    provenance_version: PROVENANCE_VERSION,
    skill,
    decision_rule: 'paired-t/v1',
    rule_sha256: rule,
    scale: 'overall',
    judges: [],
    inputs,
    result,
  };
}

module.exports = {
  SKILL,
  FINGERPRINT,
  TEMPLATE,
  SANITIZER,
  tempDir,
  makePair,
  expectedJudgment,
  makeJudgment,
  makeResult,
  sha256,
};
