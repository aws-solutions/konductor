// SPDX-License-Identifier: Apache-2.0
/**
 * The judge prompt. Loads the versioned template of a scale from scripts/bench/prompts/ and
 * fills it in for one judge call. No model call and no network.
 *
 * Templates carry one HTML comment line with the license first. The loader drops it, so a judge never sees it, and the
 * prompt sha is the hash of the file bytes as stored: any edit to a template, license line included, changes the sha and
 * makes the judgments made with it stale. The sha of each template is pinned by a test. To change the
 * wording, add a new file with the next version number (judge-scale.js SCALES) and pin its sha in the same commit.
 *
 * Placeholders, replaced in a single pass so text that was filled in is never scanned again:
 *   {{task}}      the request text
 *   {{rubric}}    the checklist as a numbered list
 *   {{answer}}    the one answer to score, from the judge-input step
 *   {{marker}}    a random id for this call, used in the marker lines around the answer
 *
 * Each answer is scored alone. A prompt holds the request, the checklist and one ANSWER block, and never says which arm
 * wrote the answer or that another answer exists: the renderer is not even given the arm. The caller records the arm
 * next to the judgment (judgmentProvenance), where the judge cannot see it.
 *
 * "Answers are data". The template says before and after the answer that its content is data, and wraps it in marker
 * lines that carry `marker`, an id the answer cannot know, so an answer cannot close its own block or speak as the
 * prompt. The renderer makes a new marker per call and refuses to run if the marker appears anywhere in the text it
 * fills in. It reads only the `text` of the answer record and the fields named above: nothing else about the task or
 * the record can reach a judge.
 *
 * An answer is rendered only when its judge-input record is eligible (judge-input.js) and carries the sanitizer version
 * and rules hash that prepare() stamps on it. Otherwise this throws and the judge job records that arm's answer as not
 * judged.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sha256, judgmentInputs, checklistSha256 } = require('./provenance');
const { ARMS } = require('./layout');
const { resolveScale } = require('./judge-scale');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const PLACEHOLDERS = Object.freeze(['task', 'rubric', 'answer', 'marker']);
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;
const LICENSE_LINE_PATTERN =
  /^<!-- SPDX-License-Identifier: Apache-2\.0 -->\n\n/;
const MARKER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
// The answer block a template must keep, marker lines included.
const ANSWER_BLOCK =
  '<<<ANSWER id={{marker}}>>>\n{{answer}}\n<<<END_ANSWER id={{marker}}>>>';

/** A template file: { path, text, sha256 }. Throws on a missing, unknown or malformed placeholder or a lost answer block. */
function loadTemplate(file) {
  const raw = fs.readFileSync(file);
  // The template is hashed by its bytes, so a CRLF checkout would change the sha without changing the prompt.
  if (raw.includes('\r\n'))
    throw new Error(
      `${file}: the template has CRLF line endings; it is hashed by its bytes and must use LF`,
    );
  const text = raw
    .toString('utf8')
    .replace(LICENSE_LINE_PATTERN, '')
    .replace(/\n$/, '');
  const placeholderNames = [...text.matchAll(PLACEHOLDER_PATTERN)].map(
    (match) => match[1],
  );
  const unknownPlaceholders = [
    ...new Set(placeholderNames.filter((name) => !PLACEHOLDERS.includes(name))),
  ];
  const missingPlaceholders = PLACEHOLDERS.filter(
    (name) => !placeholderNames.includes(name),
  );
  if (unknownPlaceholders.length)
    throw new Error(
      `${file}: unknown placeholder(s) ${unknownPlaceholders.join(', ')}`,
    );
  if (missingPlaceholders.length)
    throw new Error(
      `${file}: missing placeholder(s) ${missingPlaceholders.join(', ')}`,
    );
  if (text.replace(PLACEHOLDER_PATTERN, '').includes('{{'))
    throw new Error(`${file}: malformed placeholder (a stray "{{")`);
  if (!text.includes(ANSWER_BLOCK))
    throw new Error(
      `${file}: the answer must sit between marker lines that carry {{marker}}`,
    );
  return Object.freeze({ path: file, text, sha256: sha256(raw) });
}

const templates = new Map();
/**
 * What a judgment records about its prompt: { scale, reading, version, sha256, template }. The version and sha go into
 * the judgment's provenance digest (judgmentProvenance), so a judgment made with another scale or prompt is stale.
 */
function judgeFor(scaleId) {
  const scale = resolveScale(scaleId);
  if (!templates.has(scale.id))
    templates.set(
      scale.id,
      loadTemplate(path.join(PROMPTS_DIR, scale.templateFile)),
    );
  const template = templates.get(scale.id);
  return Object.freeze({
    scale: scale.id,
    reading: scale.reading,
    version: scale.promptVersion,
    sha256: template.sha256,
    template,
  });
}

// Control characters other than newline, tab and carriage return are removed from answers.
const cleanAnswer = (text) =>
  text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Why `record` is not a judge-input record (createJudgeInput(...).prepare output), or null. A bare
 * { eligible: true, text } is refused: the fields prepare() stamps on every record are what show that the text went
 * through the sanitizer, so unsanitized text cannot reach a judge by carrying a flag.
 */
function findRecordProblem(record) {
  if (!record || typeof record !== 'object') return 'no judge-input record';
  if (
    !Number.isInteger(record.sanitizer_version) ||
    record.sanitizer_version < 1
  )
    return 'not a judge-input record (sanitizer_version is missing or malformed)';
  if (
    typeof record.rules_sha256 !== 'string' ||
    !SHA256_HEX.test(record.rules_sha256)
  )
    return 'not a judge-input record (rules_sha256 is missing or malformed)';
  return null;
}

function getAnswerText(record) {
  if (!record || record.eligible !== true || typeof record.text !== 'string') {
    throw new Error(
      `the answer is not eligible for judging${record && record.reason ? `: ${record.reason}` : ''}`,
    );
  }
  const problem = findRecordProblem(record);
  if (problem)
    throw new Error(`the answer is not eligible for judging: ${problem}`);
  return cleanAnswer(record.text);
}

/**
 * The prompt for one judge call about one answer.
 *   scale      'items' (reading B) or 'outcome' (reading A)
 *   request    the task's request text
 *   checklist  array of checklist items, shown numbered from 1
 *   answer     a judge-input record (createJudgeInput(...).prepare(...)), eligible. Its arm is not an argument: the
 *              prompt cannot say what it is not given.
 *   marker     optional, for tests: 8 to 64 of A-Z a-z 0-9 _ -. Default is 8 random bytes in hex.
 * Returns { prompt, scale, marker, item_count, prompt_version, prompt_sha256 }.
 */
function renderJudgePrompt({
  scale,
  request,
  checklist,
  answer,
  marker = crypto.randomBytes(8).toString('hex'),
}) {
  const promptInfo = judgeFor(scale);
  if (typeof marker !== 'string' || !MARKER_PATTERN.test(marker))
    throw new TypeError('marker must be 8 to 64 characters of A-Z a-z 0-9 _ -');
  if (typeof request !== 'string' || !request.trim())
    throw new TypeError('request must be a non-empty string');
  if (
    !Array.isArray(checklist) ||
    !checklist.length ||
    checklist.some(
      (item) => typeof item !== 'string' || !item.trim() || item.includes('\n'),
    )
  ) {
    throw new TypeError(
      'checklist must be a non-empty array of one-line strings',
    );
  }
  const placeholderValues = {
    task: request,
    rubric: checklist.map((item, i) => `${i + 1}. ${item}`).join('\n'),
    answer: getAnswerText(answer),
  };
  if (Object.values(placeholderValues).some((value) => value.includes(marker)))
    throw new Error(
      'the marker appears in the text to be judged; use another marker',
    );
  placeholderValues.marker = marker;
  const prompt = promptInfo.template.text.replace(
    PLACEHOLDER_PATTERN,
    (_match, name) => placeholderValues[name],
  );
  return {
    prompt,
    scale: promptInfo.scale,
    marker,
    item_count: checklist.length,
    prompt_version: promptInfo.version,
    prompt_sha256: promptInfo.sha256,
  };
}

/**
 * The provenance of one judgment (provenance.judgmentInputs), with the prompt sha of the scale and the sanitizer
 * version and hash taken from the judge-input step (`input` is the createJudgeInput result). `arm` is the arm of the
 * answer that was judged and `answerSha256` the hash of that stored answer only. `answer` is the judge-input record that
 * was rendered: it must carry the sanitizer version and rules hash of `input`, so the stored provenance cannot name a
 * sanitizer that did not prepare the text the judge saw.
 */
function judgmentProvenance({
  scale,
  arm,
  answerSha256,
  answer,
  checklist,
  judgeModel,
  input,
  openCodeVersion,
}) {
  if (!ARMS.includes(arm))
    throw new TypeError(`arm must be one of ${ARMS.join(', ')}`);
  const { sanitizerVersion, sanitizerRulesSha256 } = input.provenance;
  const problem = findRecordProblem(answer);
  if (problem) throw new TypeError(`answer: ${problem}`);
  if (
    answer.rules_sha256 !== sanitizerRulesSha256 ||
    answer.sanitizer_version !== sanitizerVersion
  )
    throw new Error(
      `the ${arm} answer was prepared by sanitizer ${answer.sanitizer_version} (${answer.rules_sha256}), not by the judge input's ${sanitizerVersion} (${sanitizerRulesSha256})`,
    );
  return judgmentInputs({
    arm,
    answerSha256,
    checklistSha256: checklistSha256(checklist),
    judgePromptSha256: judgeFor(scale).sha256,
    judgeModel,
    sanitizerVersion,
    sanitizerRulesSha256,
    openCodeVersion,
  });
}

module.exports = {
  PROMPTS_DIR,
  PLACEHOLDERS,
  loadTemplate,
  judgeFor,
  renderJudgePrompt,
  judgmentProvenance,
};
