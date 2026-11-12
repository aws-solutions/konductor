// SPDX-License-Identifier: Apache-2.0
/**
 * The request-only checklist of reading A: a checklist written by a model that never sees the skill.
 *
 * Why. The rules checklist of reading B is built from the skill's rules, so the `with` answer holds the answer key:
 * it can meet items that only the skill's own conventions create. The request-only checklist is written from the
 * request text alone. The judges then score the same stored answers against it the way they score reading B, so the
 * gap it shows is the gap on what the requester asked for.
 *
 * What the writer is given (requestOnlyInput, buildPrompt). The request text, with any reference to the skill, a
 * skill file, a rule id or a `bench:` name stripped, and the NUMBER of items: the length of the task's rules
 * checklist, so both checklists of a task are the same length. The rules checklist's items, the task's title,
 * target section and why_skill_matters, rule ids, rule quotes, the skill name and SKILL.md are inputs of no function
 * here. A test proves it with a task that records every property read.
 *
 * File per task, layout.checklistFile(skill, batch, task):
 *   { kind, checklist_version, prompt_sha256, writer_model, request_sha256, items_sha256, skill, batch, task_id,
 *     item_count, copied_from?, request, items, attempt, usd, ms, created_at }
 * `request_sha256` is the digest of the stripped request the writer saw (the stored `request`), `items_sha256` the
 * digest of the stored `items` (provenance.js checklistSha256), `prompt_sha256` the digest of the writer prompt
 * file (prompts/checklist-prompt.request-only.v2.md). A file is current only when the version, the writer model,
 * the item count and the prompt and request digests match today's, the stored request and items match their own
 * digests, and the items pass the checks (checklistCurrent), so an edited request, items, template or writer model
 * makes it stale instead of silently reused. Two tasks with the same stripped request and item count (the dose
 * ladder's doses share their tasks) share one writer call; the later ones are written as copies, which name the task
 * they copy in `copied_from`.
 *
 * Retries. A failed call or a reply that fails the checks is retried, up to ATTEMPTS calls, with a growing pause.
 * A reply is read only when the call succeeded: a failed call's text is never parsed. When the provider blocks the
 * reply, one more call confirms the block (a retry gives the same block), and the task is reported as refused: a
 * person records it in the exclusions file with a reason and date, and it is left out of reading A only. A
 * credential error, a spend stop and a ledger error stop the job (finished checklists are kept), and so do 4 tasks in
 * a row whose every call failed with a temporary error (a timeout, throttling). A call that can never work (access
 * denied, an invalid model id) and a provider block are reported for their task and do not count toward that stop, so
 * a writer model that cannot be used makes one call per task, bounded by the spend limits.
 *
 * This module starts no process: the job passes the call in (createWriterCall over opencode.js judgeCall, which
 * books every call in the spend ledger).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { settledCost, reservationFor } = require('./ledger');
const { callCost } = require('./cost-profile');
const { CALL_KINDS } = require('./opencode');
const { pool } = require('./pool');
const { sha256, checklistSha256 } = require('./provenance');
const { JsonFileError, readJsonFile } = require('./read-file');
const { redact } = require('./redact');
const {
  ATTEMPTS,
  MAX_REFUSALS,
  SYSTEMIC_AFTER,
  CallError,
  classifyError,
  createBreaker,
  retryDelayMs,
} = require('./retry');
const { DEFAULT_SETTINGS } = require('./sanitize');
const { supersede } = require('./supersede');
const { topLevelKeys } = require('./judge-scale');

/** The `kind` of every checklist file. */
const CHECKLIST_KIND = 'request-checklist';
/** Bump when the checklist file's meaning changes; a file with another version is stale. */
const CHECKLIST_VERSION = 2;
/** Ledger label prefix of every call of this job. */
const STAGE = 'checklist';
/**
 * The item count a task may ask for. It is always the length of the task's rules checklist, which the task file
 * format holds to 5 to 8 items (formats.js LIMITS, which is not exported); a count outside that range means the task
 * did not pass the format checks. A test checks both validators at every boundary, so a change to one fails there.
 */
const ITEM_COUNT = Object.freeze({ min: 5, max: 8 });
/**
 * The length of one item, in characters after spacing is collapsed: the same limit as a rules checklist item
 * (formats.js LIMITS, checked against this one at its boundaries by a test).
 */
const ITEM_CHARS = Object.freeze({ min: 12, max: 400 });
const REASON_CHARS = 300;

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;
const LICENSE_LINE_PATTERN =
  /^<!-- SPDX-License-Identifier: Apache-2\.0 -->\n\n/;

/**
 * A prompt file: { path, text, sha256 }. The license line is dropped, so the writer never sees it, and the sha is
 * the hash of the file bytes as stored, so any edit makes the checklists written with it stale. The placeholders
 * must be exactly `placeholders`. A new wording is a new file with the next version number, never an edit.
 */
function loadTemplate(file, placeholders) {
  const raw = fs.readFileSync(file);
  const text = raw
    .toString('utf8')
    .replace(LICENSE_LINE_PATTERN, '')
    .replace(/\n$/, '');
  const names = new Set(
    [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]),
  );
  if (
    names.size !== placeholders.length ||
    !placeholders.every((name) => names.has(name))
  )
    throw new Error(
      `${file}: the placeholders must be exactly ${placeholders.map((name) => `{{${name}}}`).join(', ')}`,
    );
  if (text.replace(PLACEHOLDER_PATTERN, '').includes('{{'))
    throw new Error(`${file}: malformed placeholder (a stray "{{")`);
  return { path: file, text, sha256: sha256(raw) };
}

const WRITER_TEMPLATE_FILE = path.join(
  PROMPTS_DIR,
  'checklist-prompt.request-only.v2.md',
);
const WRITER_TEMPLATE = loadTemplate(WRITER_TEMPLATE_FILE, [
  'request',
  'count',
]);
const WRITER_PROMPT_SHA256 = WRITER_TEMPLATE.sha256;

// ---- the request-only input ------------------------------------------------------------------------------------

const escapeRegExp = (text) =>
  String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_BOUNDARY_BEFORE = '(?<![A-Za-z0-9])';
const NAME_BOUNDARY_AFTER = '(?![A-Za-z0-9])';
const PLUGIN = DEFAULT_SETTINGS.plugin;

/**
 * The spellings of a skill name that must not reach the writer: the `bench:` name and,
 * for a name of two or more words, the identifier with hyphens or underscores. A name of one word ("verification")
 * is also an ordinary word, and the spaced form of a longer name ("code review") is ordinary language: neither is
 * stripped, because that would damage a request that is simply about code review. The task validator refuses a
 * request that uses either as a name.
 */
function skillNameVariants(skill) {
  const name = String(skill || '').trim();
  if (!name) return [];
  const words = name.split(/[-_\s]+/).filter(Boolean);
  const identifiers =
    words.length > 1 ? [name, words.join('-'), words.join('_')] : [];
  return [...new Set([...identifiers, `${PLUGIN}:${name}`])];
}

const nameRegExp = (name, flags) =>
  new RegExp(
    `${NAME_BOUNDARY_BEFORE}${escapeRegExp(name)}${NAME_BOUNDARY_AFTER}`,
    flags,
  );
const PLUGIN_NAME = new RegExp(
  `${NAME_BOUNDARY_BEFORE}${escapeRegExp(PLUGIN)}:[A-Za-z0-9][A-Za-z0-9._-]*`,
  'gi',
);
const SKILLS_PATH =
  /(?<![A-Za-z0-9])\.?(?:claude|konductor)\/skills\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/SKILL\.md)?/gi;
const SKILL_FILE =
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9._-]+\/)*SKILL\.md(?![A-Za-z0-9])/g;
const BARE_RULE_ID = /(?<=\brules?\s)#?r\d{1,3}(?![A-Za-z0-9])/gi;

/**
 * Removes from a request every reference to the skill, a skill file or a rule, and returns { text, removed }. It
 * takes out: the skill's identifier spellings (skillNameVariants), any `bench:<name>`, SKILL.md and paths to it, a
 * `.claude/skills/<name>` path, rule ids (`<skill>-r07`, an id given in `ruleIds`, or a bare `r07` after the word
 * rule). A reference that is all there is between a pair of parentheses takes the parentheses with it, and the
 * spaces and punctuation it leaves are closed; parentheses that held nothing to start with (the `()` of a function
 * name) stay. A valid task holds none of these (the task validator refuses them): this is the second line, not the
 * first.
 */
function stripReferences(text, { skill = '', ruleIds = [] } = {}) {
  let out = String(text === null || text === undefined ? '' : text);
  let removed = 0;
  const drop = (pattern) => {
    const wrapped = new RegExp(
      `\\(\\s*(?:${pattern.source})\\s*\\)|${pattern.source}`,
      pattern.flags,
    );
    out = out.replace(wrapped, () => {
      removed += 1;
      return '';
    });
  };
  const ids = [...new Set((ruleIds || []).map(String).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const id of ids) drop(new RegExp(escapeRegExp(id), 'gi'));
  // Paths first, so a skill name inside a path goes with the whole path.
  drop(SKILLS_PATH);
  drop(SKILL_FILE);
  if (skill) {
    drop(
      new RegExp(
        `${NAME_BOUNDARY_BEFORE}${escapeRegExp(skill)}-r\\d{1,3}${NAME_BOUNDARY_AFTER}`,
        'gi',
      ),
    );
    for (const variant of skillNameVariants(skill).sort(
      (a, b) => b.length - a.length,
    ))
      drop(nameRegExp(variant, 'gi'));
  }
  drop(PLUGIN_NAME);
  drop(BARE_RULE_ID);
  if (removed) {
    out = out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([.,;:!?)])/g, '$1')
      .replace(/[ \t]+\n/g, '\n');
  }
  return { text: out, removed };
}

/** What makes a text unsafe to hand to the writer; an empty list means clean. */
function findRequestProblems(text, { skill = '', ruleIds = [] } = {}) {
  const problems = [];
  const source = String(text);
  if (!source.trim()) problems.push('the request is empty');
  for (const variant of skillNameVariants(skill))
    if (nameRegExp(variant, 'i').test(source))
      problems.push(`the request still names the skill ("${variant}")`);
  for (const id of ruleIds || [])
    if (id && source.toLowerCase().includes(String(id).toLowerCase()))
      problems.push(`the request still holds the rule id ${id}`);
  if (/SKILL\.md/.test(source))
    problems.push('the request still mentions SKILL.md');
  if (
    new RegExp(
      `${NAME_BOUNDARY_BEFORE}${escapeRegExp(PLUGIN)}:[A-Za-z0-9]`,
      'i',
    ).test(source)
  )
    problems.push(`the request still holds a ${PLUGIN}: reference`);
  return problems;
}

/**
 * The one place a task is read for the writer. It reads `task.id`, `task.prompt` and the LENGTH of `task.rubric`,
 * nothing else: not an item, the title, target_section, why_skill_matters or anything a later format adds. `skill`
 * and `ruleIds` are used only to strip references from the request; they are not inputs of buildPrompt.
 * Throws when the stripped request is still not clean or the item count is outside ITEM_COUNT.
 * Returns { task_id, request, request_sha256, item_count, removed }.
 */
function requestOnlyInput(task, { skill = '', ruleIds = [] } = {}) {
  const taskId = task.id;
  const { text, removed } = stripReferences(task.prompt, { skill, ruleIds });
  const problems = findRequestProblems(text, { skill, ruleIds });
  if (problems.length) throw new Error(`${taskId}: ${problems.join('; ')}`);
  const rubric = task.rubric;
  const itemCount = Array.isArray(rubric) ? rubric.length : null;
  if (
    !Number.isInteger(itemCount) ||
    itemCount < ITEM_COUNT.min ||
    itemCount > ITEM_COUNT.max
  )
    throw new Error(
      `${taskId}: the rules checklist has ${itemCount === null ? 'no' : itemCount} items; a request-only checklist is written for ${ITEM_COUNT.min} to ${ITEM_COUNT.max}`,
    );
  return {
    task_id: taskId,
    request: text,
    request_sha256: sha256(text),
    item_count: itemCount,
    removed,
  };
}

// ---- the prompt and its reply ----------------------------------------------------------------------------------

/**
 * The writer prompt for one request. Its only inputs are the request text and the item count, so nothing else can
 * be in it. Single-pass substitution: a request that holds the text "{{count}}" is not expanded.
 */
function buildPrompt({ request, itemCount }) {
  if (!Number.isInteger(itemCount) || itemCount < 1)
    throw new TypeError('buildPrompt: itemCount must be a whole number');
  const values = {
    request: String(request).trim(),
    count: `exactly ${itemCount}`,
  };
  return WRITER_TEMPLATE.text.replace(
    PLACEHOLDER_PATTERN,
    (_match, name) => values[name],
  );
}

/**
 * Every fault of a list of items, in this order: the count, then each item's length, then each repeat (ignoring
 * case). Each fault is { kind: 'count' | 'length' | 'repeat', index (0-based, items only), length ('length' only),
 * text }.
 */
function itemIssues(items, { itemCount }) {
  const issues = [];
  if (items.length !== itemCount)
    issues.push({
      kind: 'count',
      text: `${items.length} items, want exactly ${itemCount}`,
    });
  items.forEach((item, index) => {
    if (item.length < ITEM_CHARS.min || item.length > ITEM_CHARS.max)
      issues.push({
        kind: 'length',
        index,
        length: item.length,
        text: `item ${index + 1} has ${item.length} characters, want ${ITEM_CHARS.min} to ${ITEM_CHARS.max}`,
      });
  });
  const seen = new Set();
  items.forEach((item, index) => {
    const key = item.toLowerCase();
    if (seen.has(key))
      issues.push({
        kind: 'repeat',
        index,
        text: `item ${index + 1} repeats an earlier item`,
      });
    seen.add(key);
  });
  return issues;
}

const itemProblems = (items, { itemCount }) =>
  itemIssues(items, { itemCount }).map((issue) => issue.text);

// One fence around the whole trimmed reply, read the way the judge reply parser reads it (judge-scale.js): a fenced
// reply is read like the same reply without the fence, and a repeated key is refused.
const WHOLE_REPLY_FENCE = /^```(?:json)?[ \t]*\n([\s\S]*)\n[ \t]*```$/;

/**
 * Reads a writer reply: { items, problems }. `items` is null when the reply is not one JSON object whose only field
 * is an `items` array of strings; each item has its spacing collapsed. The caller has already checked that the call
 * succeeded: an error text is never passed here.
 */
function readReply(text, { itemCount }) {
  const malformed = (problem) => ({ items: null, problems: [problem] });
  const trimmed = String(text || '').trim();
  if (!trimmed) return malformed('the reply is empty');
  const fence = WHOLE_REPLY_FENCE.exec(trimmed);
  const body = fence ? fence[1] : trimmed;
  let reply;
  try {
    reply = JSON.parse(body);
  } catch {
    return malformed('the reply is not one JSON object');
  }
  if (
    !reply ||
    typeof reply !== 'object' ||
    Array.isArray(reply) ||
    !Array.isArray(reply.items) ||
    Object.keys(reply).length !== 1
  )
    return malformed(
      'the reply is not a JSON object with only an "items" array',
    );
  // JSON.parse keeps the last of two equal keys, so a second "items" would replace the first one unseen.
  const keys = topLevelKeys(body);
  if (new Set(keys).size !== keys.length)
    return malformed('the reply repeats the "items" field');
  if (!reply.items.every((item) => typeof item === 'string'))
    return malformed('every item must be a string');
  const items = reply.items.map((item) => item.replace(/\s+/g, ' ').trim());
  return { items, problems: itemProblems(items, { itemCount }) };
}

// ---- files -----------------------------------------------------------------------------------------------------

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isSha256 = (value) =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isCountOrNull = (value) =>
  value === null || (Number.isFinite(value) && value >= 0);
const RECORD_FIELDS = Object.freeze({
  kind: (value) => value === CHECKLIST_KIND,
  checklist_version: Number.isInteger,
  prompt_sha256: isSha256,
  writer_model: isText,
  request_sha256: isSha256,
  items_sha256: isSha256,
  skill: isText,
  batch: isText,
  task_id: isText,
  item_count: Number.isInteger,
  request: isText,
  items: (value) =>
    Array.isArray(value) && value.length > 0 && value.every(isText),
  attempt: (value) => value === null || Number.isInteger(value),
  usd: (value) => Number.isFinite(value) && value >= 0,
  ms: isCountOrNull,
  created_at: isText,
});
const OPTIONAL_RECORD_FIELDS = Object.freeze({
  copied_from: isText,
});

/**
 * The checklist file at `file`, or null when it is absent, not JSON, or not a checklist record: a missing or mistyped
 * field, or a field this format does not have. Any other read failure (an I/O error, a folder where the file should
 * be) is thrown: it says nothing about the file, and reading it as absent would have the next plan pay for a
 * checklist that is already there. Whether the file is current is checklistCurrent's question.
 */
function readChecklistFile(file) {
  let record;
  try {
    record = readJsonFile(file);
  } catch (error) {
    if (error instanceof JsonFileError || (error && error.code === 'ENOENT'))
      return null;
    throw error;
  }
  if (!isPlainObject(record)) return null;
  for (const [field, isValid] of Object.entries(RECORD_FIELDS))
    if (!Object.hasOwn(record, field) || !isValid(record[field])) return null;
  for (const field of Object.keys(record))
    if (
      !Object.hasOwn(RECORD_FIELDS, field) &&
      !(
        Object.hasOwn(OPTIONAL_RECORD_FIELDS, field) &&
        OPTIONAL_RECORD_FIELDS[field](record[field])
      )
    )
      return null;
  return record;
}

/**
 * True when `record` was written for `input` (requestOnlyInput) by `model` with today's writer prompt and version,
 * its stored request and items still match their digests, and the items pass the checks for the item count.
 */
function checklistCurrent(record, input, model) {
  return (
    !!record &&
    record.kind === CHECKLIST_KIND &&
    record.checklist_version === CHECKLIST_VERSION &&
    record.prompt_sha256 === WRITER_PROMPT_SHA256 &&
    record.writer_model === model &&
    record.task_id === input.task_id &&
    record.request_sha256 === input.request_sha256 &&
    record.request_sha256 === sha256(record.request) &&
    record.items_sha256 === checklistSha256(record.items) &&
    record.item_count === input.item_count &&
    itemProblems(record.items, { itemCount: input.item_count }).length === 0
  );
}

const roundUsd = (usd) => Number(Number(usd || 0).toFixed(6));

/** The file content of an accepted checklist. `copiedFrom` is the task id whose reply it reuses, for a copy. */
function checklistRecord({
  job,
  items,
  model,
  attempt = null,
  usd = 0,
  ms = null,
  copiedFrom = null,
  now = () => new Date(),
}) {
  return {
    kind: CHECKLIST_KIND,
    checklist_version: CHECKLIST_VERSION,
    prompt_sha256: WRITER_PROMPT_SHA256,
    writer_model: model,
    request_sha256: job.input.request_sha256,
    items_sha256: checklistSha256(items),
    skill: job.skill,
    batch: job.batch,
    task_id: job.input.task_id,
    item_count: job.input.item_count,
    ...(copiedFrom ? { copied_from: copiedFrom } : {}),
    request: job.input.request,
    items,
    attempt,
    usd: roundUsd(usd),
    ms,
    created_at: now().toISOString(),
  };
}

/**
 * Writes a checklist record to `file` through a temporary file in the same folder (file 0600, folders 0700). A file
 * already there is set aside as `<file>.superseded-<time>` first: checklists are evidence.
 */
function writeChecklistFile(file, record, { now = Date.now } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  supersede(file, now);
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

// ---- planning --------------------------------------------------------------------------------------------------

const roundEstimate = (usd) => Number(usd.toFixed(4));

/**
 * Projected USD of one writer call: the upper estimate (p90) of the writer model in the cost profile, the figure
 * `plan` uses and the ledger reserves. Offline.
 */
const estimateCall = (config, model) => ({
  usd: callCost(config, 'writer', model).p90,
});

/** Tasks that share a stripped request and an item count share one writer call. */
const copyKey = (input) => `${input.request_sha256}:${input.item_count}`;

/**
 * Every task of the job, in order: { skill, batch, task_id, file, input, state, est, copy_of, problem, rule_ids }.
 *   state  'done'     a current file written by `model` is on disk
 *          'pending'  a call is needed
 *          'copy'     same request and item count as an earlier task of the job: written from that task's
 *                     checklist, no call
 *          'blocked'  the request is not clean or the item count is out of range; nothing is written
 * `sets` is [{ skill, batch, tasks, ruleIds }]: the tasks of one batch, and the rule ids to strip (never given to the
 * writer). `layout` is createLayout(...) for the run.
 */
function planChecklists({ sets, layout, model, config }) {
  const jobs = [];
  const firstByKey = new Map();
  for (const { skill, batch, tasks, ruleIds = [] } of sets) {
    for (const task of tasks) {
      const job = {
        skill,
        batch,
        task_id: task.id,
        file: layout.checklistFile(skill, batch, task.id),
        input: null,
        state: 'pending',
        est: null,
        copy_of: null,
        problem: null,
        rule_ids: ruleIds,
      };
      jobs.push(job);
      try {
        job.input = requestOnlyInput(task, { skill, ruleIds });
      } catch (error) {
        job.state = 'blocked';
        job.problem = redact(error.message, { maxChars: REASON_CHARS });
        continue;
      }
      const key = copyKey(job.input);
      if (checklistCurrent(readChecklistFile(job.file), job.input, model)) {
        job.state = 'done';
        // A later task with the same request is served from this file, not from a new call.
        if (!firstByKey.has(key)) firstByKey.set(key, job);
      } else if (firstByKey.has(key)) {
        job.state = 'copy';
        job.copy_of = firstByKey.get(key).task_id;
      } else {
        firstByKey.set(key, job);
        job.est = estimateCall(config, model);
      }
    }
  }
  return jobs;
}

/**
 * Counts and projected cost of a plan. `projected_usd` is one call per pending task; `worst_case_usd` and
 * `max_calls` count every attempt of every pending task. Copies and done tasks cost nothing.
 */
function projection(jobs) {
  const calls = jobs.filter((job) => job.state === 'pending');
  const projected = calls.reduce((sum, job) => sum + job.est.usd, 0);
  return {
    total: jobs.length,
    done: jobs.filter((job) => job.state === 'done').length,
    pending: calls.length,
    copies: jobs.filter((job) => job.state === 'copy').length,
    blocked: jobs.filter((job) => job.state === 'blocked').length,
    calls: calls.length,
    projected_usd: roundEstimate(projected),
    worst_case_usd: roundEstimate(projected * ATTEMPTS),
    max_calls: calls.length * ATTEMPTS,
  };
}

/** Tasks still to write (a call or a copy). */
const remainingOf = (jobs) =>
  jobs.filter((job) => job.state === 'pending' || job.state === 'copy').length;

// ---- running ---------------------------------------------------------------------------------------------------

/**
 * The USD the ledger charges a finished judgeCall of `callKind` with `model` (ledger.js settledCost, from the call's
 * cost profile entry): the cost the CLI reported, at least the mean for a model whose CLI reports low, the mean
 * when the call reported no usable cost, or 0 when it ended before a model step started (`result.modelStarted`
 * false). `costProfile` is the profile the call was priced from (the committed one by default), so the job books
 * what the ledger charged. An unknown `callKind` or a missing model is a TypeError, so a typo cannot settle against
 * an undefined price.
 */
function bookedUsd(result, config, callKind = 'judge', model, costProfile) {
  if (!CALL_KINDS.includes(callKind))
    throw new TypeError(
      `bookedUsd: callKind must be one of ${CALL_KINDS.join(', ')}, got ${JSON.stringify(callKind)}`,
    );
  if (typeof model !== 'string' || !model)
    throw new TypeError('bookedUsd: model must be a non-empty model id');
  const price = reservationFor(config, callKind, model, costProfile);
  return settledCost({
    reportedUsd: result.reportedUsd,
    usage: result.usage,
    reservedUsd: price.usd,
    meanUsd: price.options.meanUsd,
    cliReportsLow: price.options.cliReportsLow,
    modelStarted: result.modelStarted !== false,
  }).usd;
}

/**
 * The call the job passes to writeChecklists: one opencode.js judgeCall with the writer model, booked in the
 * ledger, under `credentialGuard` and the judge call timeout, with the job's exported `credentials` passed to the
 * process and the call priced and booked from `costProfile` (the committed one when not given). `judgeCall` is
 * injected so this module starts no process. Returns { ok, text, usd, ms, error }; `error` is the redacted error and
 * stderr of a failed call.
 */
function createWriterCall({
  judgeCall,
  ledger,
  config,
  model,
  credentialGuard = null,
  credentials = null,
  costProfile,
  timeoutMs = config.judge_timeout_ms,
}) {
  return async (job, attempt, prompt) => {
    const result = await judgeCall({
      ledger,
      config,
      modelId: model,
      prompt,
      label: `${STAGE} ${job.skill}/${job.batch}/${job.task_id} #${attempt}`,
      timeoutMs,
      callKind: 'writer',
      credentialGuard,
      credentials,
      ...(costProfile === undefined ? {} : { costProfile }),
    });
    return {
      ok: result.ok,
      text: result.text,
      usd: bookedUsd(result, config, 'writer', model, costProfile),
      ms: result.ms ?? null,
      error: result.ok
        ? null
        : [result.error, result.stderr].filter(Boolean).join(' | ') ||
          'call failed',
    };
  };
}

/** A one-line, cut and redacted copy of `text` for a reason or a log line. `redactor` is the run's own redactor. */
const shortReason = (text, redactor = redact) =>
  redactor(String(text || '').replace(/\s+/g, ' '), {
    maxChars: REASON_CHARS,
  });
const credentialStop = (message, attempt) =>
  new CallError(
    'credential',
    `AWS credentials missing or expired: ${message}`,
    attempt,
  );

/**
 * Writes the checklists of the pending tasks, `concurrency` at a time, then the copies. Dependencies are injected so
 * the rules can be tested without a model:
 *   call(job, attempt, prompt) -> { ok, text, usd, ms, error }   (createWriterCall)
 *   write(file, record)                                          (default writeChecklistFile)
 * A reply is read ONLY when the call's ok flag is true. A failed call or a rejected reply is retried up to
 * `attempts` calls with a growing pause (`delayMs(attempt)`). A provider block is tried `maxRefusals` times, then the
 * task is refused. A failure the provider says can never work is not retried. A fatal error (a credential failure,
 * a spend stop, a ledger error) stops every worker and is thrown after they settle; `systemicAfter` tasks in a row
 * whose every call failed throw SystemicFailureError, which is fatal too. Finished files are kept.
 * Returns { written, copied, failed, refused, usd }: task ids written and copied, and { task_id, reason } for each
 * task that failed or was refused. `redact` cleans the message of that SystemicFailureError (default: the module
 * redactor); the job passes a run redactor that also removes the credential values it handed out.
 */
async function writeChecklists({
  jobs,
  call,
  write = writeChecklistFile,
  model,
  concurrency = 1,
  attempts = ATTEMPTS,
  maxRefusals = MAX_REFUSALS,
  systemicAfter = SYSTEMIC_AFTER,
  delayMs = retryDelayMs,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
  now = () => new Date(),
  redact: redactFailure = redact,
}) {
  const breaker = createBreaker({
    after: systemicAfter,
    redact: redactFailure,
  });
  const written = [];
  const copied = [];
  const failed = [];
  const refused = [];
  let usdTotal = 0;
  const accepted = new Map();
  // Copies whose source is already done on disk are served from that file.
  for (const job of jobs.filter((entry) => entry.state === 'done')) {
    const record = readChecklistFile(job.file);
    if (record && !accepted.has(copyKey(job.input)))
      accepted.set(copyKey(job.input), {
        items: record.items,
        from: job.task_id,
      });
  }

  const runOne = async (job) => {
    const itemCount = job.input.item_count;
    const prompt = buildPrompt({ request: job.input.request, itemCount });
    let spent = 0;
    let anyOk = false;
    let refusals = 0;
    let lastKind = null;
    let lastReason = 'no call was made';
    let items = null;
    let acceptedAt = null;
    const fail = (list, reason) => {
      list.push({ task_id: job.task_id, reason });
      log(`${job.task_id}: NOT written (${reason}); USD ${spent.toFixed(4)}`);
    };

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(delayMs(attempt));
      let result;
      try {
        result = await call(job, attempt, prompt);
      } catch (error) {
        if (error && error.fatal) throw error;
        const message = shortReason(error && error.message, redactFailure);
        if (classifyError(error) === 'credential')
          throw credentialStop(message, attempt);
        // A call that throws before it starts (an unsafe model id, a prompt too long to pass) fails the same way
        // every time, so it is not retried.
        fail(failed, `the call could not be made: ${message}`);
        return;
      }
      const usd = Number(result.usd) || 0;
      spent += usd;
      usdTotal += usd;
      if (!result.ok) {
        const message = shortReason(result.error || 'call failed');
        const kind = classifyError(new Error(message));
        if (kind === 'credential') throw credentialStop(message, attempt);
        lastKind = kind;
        lastReason = message;
        if (kind === 'refusal' && ++refusals >= maxRefusals) break;
        if (kind === 'permanent') break;
        continue;
      }
      anyOk = true;
      const reply = readReply(result.text, { itemCount });
      if (!reply.problems.length) {
        items = reply.items;
        acceptedAt = { attempt, ms: result.ms ?? null };
        break;
      }
      lastKind = 'rejected';
      lastReason = `reply rejected: ${reply.problems.slice(0, 4).join('; ')}`;
    }

    if (!items) {
      if (anyOk) breaker.recordSuccess();
      else if (lastKind === 'transient') breaker.recordFailure(lastReason);
      if (lastKind === 'refusal' && refusals >= maxRefusals)
        fail(
          refused,
          `the provider blocked the reply ${refusals} times: ${lastReason}`,
        );
      else fail(failed, lastReason);
      return;
    }
    breaker.recordSuccess();
    const record = checklistRecord({
      job,
      items,
      model,
      attempt: acceptedAt.attempt,
      usd: spent,
      ms: acceptedAt.ms,
      now,
    });
    // The reply is paid for and passed every check. One more try covers a passing I/O error; when it fails again the
    // items go to the log, so the paid reply is not lost with the failed write.
    let saveError = null;
    for (let tries = 0; tries < 2; tries++) {
      try {
        write(job.file, record);
        saveError = null;
        break;
      } catch (error) {
        saveError = error;
      }
    }
    if (saveError) {
      log(
        `${job.task_id}: the accepted checklist could not be saved; its items: ${redactFailure(JSON.stringify(items), { maxChars: Infinity })}`,
      );
      fail(failed, shortReason(saveError.message || saveError, redactFailure));
      return;
    }
    if (!accepted.has(copyKey(job.input)))
      accepted.set(copyKey(job.input), { items, from: job.task_id });
    written.push(job.task_id);
    log(
      `${job.task_id}: ${items.length} items written; USD ${spent.toFixed(4)}`,
    );
  };

  const pending = jobs.filter((job) => job.state === 'pending');
  const results = await pool(pending, concurrency, runOne);
  results.forEach((result, index) => {
    if (result.error)
      failed.push({
        task_id: pending[index].task_id,
        reason: shortReason(
          result.error.message || result.error,
          redactFailure,
        ),
      });
  });
  for (const job of jobs.filter((entry) => entry.state === 'copy')) {
    const source = accepted.get(copyKey(job.input));
    if (!source) {
      failed.push({
        task_id: job.task_id,
        reason: `the task it copies (${job.copy_of}) has no checklist`,
      });
      continue;
    }
    try {
      write(
        job.file,
        checklistRecord({
          job,
          items: source.items,
          model,
          copiedFrom: source.from,
          now,
        }),
      );
    } catch (error) {
      failed.push({
        task_id: job.task_id,
        reason: shortReason(error && error.message, redactFailure),
      });
      continue;
    }
    copied.push(job.task_id);
    log(`${job.task_id}: copied from ${source.from} (same request)`);
  }
  return {
    written,
    copied,
    failed,
    refused,
    usd: Number(usdTotal.toFixed(4)),
  };
}

module.exports = {
  CHECKLIST_KIND,
  CHECKLIST_VERSION,
  STAGE,
  ITEM_COUNT,
  ITEM_CHARS,
  PROMPTS_DIR,
  WRITER_TEMPLATE_FILE,
  WRITER_TEMPLATE,
  WRITER_PROMPT_SHA256,
  loadTemplate,
  skillNameVariants,
  stripReferences,
  findRequestProblems,
  requestOnlyInput,
  buildPrompt,
  itemIssues,
  itemProblems,
  readReply,
  readChecklistFile,
  checklistCurrent,
  checklistRecord,
  writeChecklistFile,
  estimateCall,
  planChecklists,
  projection,
  remainingOf,
  bookedUsd,
  createWriterCall,
  writeChecklists,
};
