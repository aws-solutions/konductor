// SPDX-License-Identifier: Apache-2.0
/**
 * Hashes and input digests for the skill benchmark.
 *
 * Every stored judgment records the inputs it was made from and a digest of them. Work is stale
 * when today's digest differs from the stored one, and stale work is never reused. A digest covers
 * content only: no absolute path, time or directory name, so the same inputs resume across checkouts.
 *
 * The OpenCode version is recorded next to a digest but is NOT part of it, so a CLI version change
 * alone does not make work stale.
 */
'use strict';

const crypto = require('crypto');
const { readFile } = require('./read-file');
const { ARMS } = require('./layout');

const PROVENANCE_VERSION = 1;

/** The same value with every object's keys sorted, so equal data hashes equal whatever the key order. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])]),
    );
  }
  return value;
}

/** SHA-256 in lowercase hex of a string or Buffer as given, or of any other value as stable JSON. */
const sha256 = (value) =>
  crypto
    .createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(sortKeysDeep(value)),
    )
    .digest('hex');

/** SHA-256 of a file's bytes: the `skill_md_sha256` of a rules file and the `rules_sha256` of a task file. */
const fileSha256 = (file) => sha256(readFile(file));

/** Hash of a checklist (an array of items), for the judgment record. */
const checklistSha256 = (items) => sha256({ items });

function requireFields(kind, fields) {
  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    if (fieldValue === undefined || fieldValue === null || fieldValue === '')
      throw new Error(`${kind} inputs: ${fieldName} is required`);
  }
}

/** The digested fields plus the digest, and `extraFields` recorded beside them but left out of the digest. */
function withDigest(fields, extraFields = {}) {
  return { ...fields, ...extraFields, input_sha256: sha256(fields) };
}

/**
 * Inputs of a judgment. Each answer is judged on its own, so a judgment belongs to one arm and `answerSha256`
 * is the hash of that arm's stored answer only: redoing the other arm's answer leaves this digest unchanged.
 * The arm is part of the digest, so a judgment can never be reused for the other arm's answer.
 */
function judgmentInputs({
  arm,
  answerSha256,
  checklistSha256: checklist,
  judgePromptSha256,
  judgeModel,
  sanitizerVersion,
  sanitizerRulesSha256,
  openCodeVersion,
}) {
  if (!ARMS.includes(arm))
    throw new Error(`judgment inputs: arm must be one of ${ARMS.join(', ')}`);
  // Sanitizer versions start at 1, so 0 or a fraction is a caller bug, not a version.
  if (
    sanitizerVersion !== undefined &&
    sanitizerVersion !== null &&
    !(Number.isInteger(sanitizerVersion) && sanitizerVersion >= 1)
  )
    throw new Error(
      `judgment inputs: sanitizer_version must be a whole number, 1 or more, got ${JSON.stringify(sanitizerVersion)}`,
    );
  const fields = {
    provenance_version: PROVENANCE_VERSION,
    kind: 'judgment',
    arm,
    answer_sha256: answerSha256,
    checklist_sha256: checklist,
    judge_prompt_sha256: judgePromptSha256,
    judge_model: judgeModel,
    sanitizer_version: sanitizerVersion,
    sanitizer_rules_sha256: sanitizerRulesSha256,
  };
  requireFields('judgment', fields);
  return withDigest(fields, { opencode_version: openCodeVersion ?? null });
}

module.exports = {
  sortKeysDeep,
  sha256,
  fileSha256,
  checklistSha256,
  judgmentInputs,
};
