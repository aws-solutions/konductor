// SPDX-License-Identifier: Apache-2.0
/**
 * Content-addressed digests for benchmark records.
 *
 * `sha256` hashes a string or Buffer by its bytes, and any other value by its JSON form with
 * object keys sorted at every depth, so two equal values hash the same whatever order their keys
 * were written in. Array order matters. Paths, times and directory names are never part of a
 * digest, so the same inputs give the same digest in any checkout. Everything here is pure and
 * dependency-free apart from node:crypto.
 *
 * Three records carry an input digest. A stored record is current only when it holds the digest
 * of the inputs a caller computes now (see store.js); nothing is reused on a missing field.
 *
 *  - `pairInputs`: one task run in one arm. Covers the task id and request, the arm, the
 *    `runner_fingerprint`, the stored outputs (reply, start and final workspace) and, when the
 *    pair has them, its word-check results.
 *  - `judgmentInputs`: one judge call. Covers the template, the sanitizer rules, the rendered
 *    prompt (the request, the checklist and both cleaned answers with their changed files), the
 *    order and the seat. It leaves out the per-call marker id, which is random and is stored next
 *    to the digest; with it in, every prompt would hash anew and no stored reply could be found.
 *  - `resultInputs`: one skill result. Covers the decision rule digest, the task set, the pairs
 *    and every judgment that fed it.
 *
 * `runner_fingerprint` is an opaque string a runner plugin supplies to say what produced a run
 * (its id, version and the settings that change what it answers). Core only compares it.
 */
const crypto = require('node:crypto');

/** Bump when the shape of a digested record changes. Records of another version are not current. */
const PROVENANCE_VERSION = 1;

/** The two arms of a pair. */
const ARMS = Object.freeze(['with', 'without']);

const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_FINGERPRINT_LENGTH = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Returns a copy of `value` with the keys of every nested object in sorted order. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

/** Hex SHA-256 of a string, a Buffer, or the stable JSON form of any other value. */
function sha256(value) {
  const input =
    typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** True for a 64-character lower-case hex string. */
const isSha256 = (value) => typeof value === 'string' && SHA256_RE.test(value);

/** Throws unless `value` is a non-empty single-line string of at most 200 characters. */
function assertFingerprint(value) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_FINGERPRINT_LENGTH ||
    CONTROL_CHARS.test(value)
  ) {
    throw new Error(
      `runner_fingerprint must be a non-empty single-line string of at most ${MAX_FINGERPRINT_LENGTH} characters`,
    );
  }
  return value;
}

function assertText(value, what) {
  if (typeof value !== 'string') throw new TypeError(`${what} must be a string`);
  return value;
}

function assertOneOf(value, list, what) {
  if (!list.includes(value)) {
    throw new Error(`${what} must be one of ${list.join(', ')}, got ${JSON.stringify(String(value))}`);
  }
  return value;
}

/** Throws unless `snapshot` is a plain object from path to text, the shape workspaceChanges reads. */
function assertSnapshot(snapshot, what) {
  const proto = snapshot === null || typeof snapshot !== 'object' ? null : Object.getPrototypeOf(snapshot);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${what} must be a plain object from path to file text`);
  }
  for (const [file, text] of Object.entries(snapshot)) {
    if (typeof text !== 'string') {
      throw new TypeError(`${what}: the content of ${JSON.stringify(file)} must be a string`);
    }
  }
  return snapshot;
}

/**
 * What decides how a run answers: the task and its request, the arm, and the runner. Returns the
 * inputs plus `subject_input_sha256`, their digest.
 */
function subjectInputs({ taskId, arm, request, runnerFingerprint }) {
  assertOneOf(arm, ARMS, 'arm');
  const inputs = {
    provenance_version: PROVENANCE_VERSION,
    task_id: assertText(taskId, 'taskId'),
    arm,
    request_sha256: sha256(assertText(request, 'request')),
    runner_fingerprint: assertFingerprint(runnerFingerprint),
  };
  return { ...inputs, subject_input_sha256: sha256(inputs) };
}

/**
 * Throws unless `results` is an array with one entry per word check: `true` (passed), `false`
 * (failed) or `null` (no verdict). An empty array is allowed and means the task has no checks.
 */
function assertCheckResults(results) {
  if (!Array.isArray(results) || !results.every((r) => r === true || r === false || r === null)) {
    throw new TypeError('check_results must be an array of true, false or null, one per check');
  }
  return results;
}

/**
 * The inputs of a stored pair record: `subjectInputs` plus a digest of each stored output, and
 * `pair_input_sha256` over all of it. `loaded` is part of the digest because it decides whether
 * the pair counts.
 *
 * `checkResults` is optional. When given, its digest is part of the pair digest, so editing a
 * word-check result makes the pair, and the skill result built from it, stale. When omitted the
 * inputs carry no `check_results_sha256` field at all, so a pair without word checks keeps the
 * digest it had before the field existed. An empty array is not the same as omitted.
 */
function pairInputs({
  taskId,
  arm,
  request,
  runnerFingerprint,
  answer,
  start,
  final,
  loaded,
  checkResults,
}) {
  if (typeof loaded !== 'boolean') throw new TypeError('loaded must be a boolean');
  const inputs = {
    ...subjectInputs({ taskId, arm, request, runnerFingerprint }),
    answer_sha256: sha256(assertText(answer, 'answer')),
    start_sha256: sha256(assertSnapshot(start, 'start')),
    final_sha256: sha256(assertSnapshot(final, 'final')),
    loaded,
    ...(checkResults === undefined
      ? {}
      : { check_results_sha256: sha256(assertCheckResults(checkResults)) }),
  };
  return { ...inputs, pair_input_sha256: sha256(inputs) };
}

/**
 * The inputs of one judge call. `prompt` is the prompt rendered with a fixed marker id, so it holds
 * the request, the checklist and both cleaned answers with their changed files but not the
 * per-call marker. Returns the inputs plus `judge_input_sha256`, their digest.
 *
 *   template   { version, sha256 }  the prompt template in use
 *   sanitizer  { version, hash }    SANITIZER_VERSION and RULES_HASH of sanitize.js
 */
function judgmentInputs({ request, rubric, prompt, template, scale, sanitizer, order, seat }) {
  if (!Array.isArray(rubric)) throw new TypeError('rubric must be an array');
  if (!template || !Number.isInteger(template.version) || !isSha256(template.sha256)) {
    throw new TypeError('template needs an integer version and a sha256');
  }
  if (!sanitizer || !Number.isInteger(sanitizer.version) || !isSha256(sanitizer.hash)) {
    throw new TypeError('sanitizer needs an integer version and a hash');
  }
  const inputs = {
    provenance_version: PROVENANCE_VERSION,
    request_sha256: sha256(assertText(request, 'request')),
    rubric_sha256: sha256(rubric),
    rendered_prompt_sha256: sha256(assertText(prompt, 'prompt')),
    prompt_version: template.version,
    prompt_sha256: template.sha256,
    judge_scale: assertText(scale, 'scale'),
    sanitizer_version: sanitizer.version,
    sanitizer_rules_sha256: sanitizer.hash,
    order: assertText(order, 'order'),
    seat: assertText(seat, 'seat'),
  };
  return { ...inputs, judge_input_sha256: sha256(inputs) };
}

/**
 * The inputs of a skill result. Any change to one of them changes `result_input_sha256`, so the
 * result is rebuilt.
 *
 *   tasks      [{ id, target_section }]  the task set
 *   pairs      stored pair records       each contributes its pair digest and `loaded`
 *   judgments  stored judgment records   each contributes its input digest, status and reply
 *   judges     [{ seat, model }]         the planned seats
 */
function resultInputs({ skill, ruleSha256, pruneBlockedReason = null, tasks, pairs, judgments, judges }) {
  if (!isSha256(ruleSha256)) throw new TypeError('ruleSha256 must be a sha256 hex digest');
  const inputs = {
    provenance_version: PROVENANCE_VERSION,
    skill: assertText(skill, 'skill'),
    rule_sha256: ruleSha256,
    prune_blocked_reason: pruneBlockedReason || null,
    tasks: tasks.map((t) => [t.id, t.target_section ?? null]).sort(),
    judges: judges.map((j) => [j.seat, j.model]).sort(),
    pairs: pairs
      .map((p) => [p.task_id, p.arm, p.inputs.pair_input_sha256, p.loaded === true])
      .sort(),
    judgments: judgments
      .map((j) => [j.inputs.judge_input_sha256, j.status, sha256(j.raw_text ?? '')])
      .sort(),
  };
  return { ...inputs, result_input_sha256: sha256(inputs) };
}

module.exports = {
  PROVENANCE_VERSION,
  ARMS,
  stable,
  sha256,
  isSha256,
  assertFingerprint,
  subjectInputs,
  pairInputs,
  judgmentInputs,
  resultInputs,
};
