// SPDX-License-Identifier: Apache-2.0
/**
 * The run store: where a benchmark run keeps its records, and the rules that say whether a stored
 * record is still current. Plain JSON files under one run directory, readable by anyone who has
 * the directory. Nothing here calls a model or the network.
 *
 * Layout under the run directory (`<skill>`, `<task>` and `<seat>` are slugs, see slug.js):
 *
 *   pairs/<skill>/<task>/<arm>.json               one task run in one arm (with | without)
 *   judgments/<skill>/<task>/<seat>.<order>.json  one judge call (order: with-first | without-first)
 *   results/<skill>.json                          the aggregated result of a skill
 *
 * Every path is built from validated names and then checked to lie strictly inside the run
 * directory, so a task id or seat label cannot point outside it. A path whose parent chain holds a
 * symbolic link, or whose last part is one, is refused on write.
 *
 * Privacy. Directories the store creates have mode 0700 and files 0600, whatever the umask. A file
 * is written to a temporary name in its own directory and renamed into place, so a reader never
 * sees half a record. Modes are a POSIX feature; on Windows they have no effect.
 *
 * Record formats (field lists; every field is required, a record missing one is not current):
 *
 *   pair        provenance_version, skill, task_id, arm, answer, start, final, loaded,
 *               runner_fingerprint, inputs (pairInputs of provenance.js), and optionally
 *               check_results (see below)
 *   judgment    provenance_version, skill, task_id, seat, family, plugin, judge_model, order,
 *               judge_scale, prompt_version, prompt_sha256, sanitizer_version,
 *               sanitizer_rules_sha256, nonce, inputs (judgmentInputs), status, attempts, raw_text,
 *               parsed, usage, cost, error
 *   result      provenance_version, skill, decision_rule, rule_sha256, scale, judges, inputs
 *               (resultInputs), result (aggregateSkill output)
 *
 * Word-check results. `check_results` on a pair is an array with one entry per word check of the
 * task, in the task's order: `true` (the check passed on this arm's final workspace), `false`
 * (it failed) or `null` (it gave no verdict). The field is absent when the task has no word checks,
 * and an absent field is not the same as an empty array. It is covered by the pair's input digest,
 * so editing it makes the pair, and any result built from it, stale. The store only keeps and
 * compares it. Step 6 of the port plan fills it, by running the task's checks on the arm's final
 * snapshot; until then a pair carries it only when a caller supplies it.
 *
 * Freshness is strict. A stored record is current only when it carries the digest of the inputs a
 * caller computes now, and every field of its format. Nothing is reused on a missing field, an
 * unexpected type, another provenance version or another identity (skill, task, seat, order).
 *
 *  - `pairCurrent`      the pair's digest matches its own outputs and today's task request.
 *  - `judgmentDone`     current, and the reply was usable (`status` ok).
 *  - `judgmentSettled`  current, and either done or tried MAX_ATTEMPTS times without a usable
 *                       reply. A settled judgment is not retried; an unsettled one is.
 *  - `resultCurrent`    the result carries today's decision rule digest and today's input digest.
 *                       A result that is not current is rebuilt from the stored judgments, which
 *                       costs no model call.
 */
const fs = require('node:fs');
const path = require('node:path');

const { decisionRuleSha256 } = require('./decision-rule');
const { ORDERS } = require('./verdict');
const { ARMS, PROVENANCE_VERSION, isSha256, pairInputs, sha256 } = require('./provenance');
const { assertSlug, assertUnder, isSlug } = require('./slug');

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** How often one judge input is tried before a reply that is not usable stops being retried. */
const MAX_ATTEMPTS = 3;

/**
 * What a judgment record's `status` can be. `ok` is a usable reply. `unparsable` is a reply the
 * scale could not read. `refused`, `invalid` and `transient` are the statuses a grader plugin
 * returned for a call that gave no reply (see run/judge.js).
 */
const JUDGMENT_STATUS = Object.freeze({
  OK: 'ok',
  UNPARSABLE: 'unparsable',
  REFUSED: 'refused',
  INVALID: 'invalid',
  TRANSIENT: 'transient',
});

const NONCE_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---- private files -------------------------------------------------------------------------

/** Creates `dir` and every missing parent with mode 0700. Existing directories keep their mode. */
function ensurePrivateDir(dir) {
  const missing = [];
  for (let at = path.resolve(dir); !fs.existsSync(at); at = path.dirname(at)) missing.push(at);
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  for (const made of missing) fs.chmodSync(made, DIR_MODE);
  return dir;
}

let tempCounter = 0;

/** Writes `text` to `file` with mode 0600: a temporary file in the same directory, then a rename. */
function writePrivateAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${tempCounter++}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: FILE_MODE, flag: 'wx' });
    fs.chmodSync(tmp, FILE_MODE);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Throws when `file`, or a directory between `root` and `file`, is a symbolic link. */
function assertNoLinks(root, file) {
  let at = file;
  while (at !== root && at !== path.dirname(at)) {
    let stat = null;
    try {
      stat = fs.lstatSync(at);
    } catch (_) {
      // not there yet: nothing to follow
    }
    if (stat && stat.isSymbolicLink()) throw new Error(`refusing to write through a link: ${at}`);
    at = path.dirname(at);
  }
}

/** The parsed JSON of a regular file, or null when it is missing, a link, or not valid JSON. */
const readJson = (file) => {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
};

// ---- record shapes --------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string';
const isWord = (v) => typeof v === 'string' && v.trim() !== '';
const isTextOrNull = (v) => v === null || typeof v === 'string';
const isObjectOrNull = (v) => v === null || isObject(v);

const PAIR_FIELDS = Object.freeze({
  provenance_version: Number.isInteger,
  skill: isSlug,
  task_id: isSlug,
  arm: (v) => ARMS.includes(v),
  answer: isText,
  start: isObject,
  final: isObject,
  loaded: (v) => typeof v === 'boolean',
  runner_fingerprint: isWord,
  inputs: isObject,
});

const JUDGMENT_FIELDS = Object.freeze({
  provenance_version: Number.isInteger,
  skill: isSlug,
  task_id: isSlug,
  seat: isSlug,
  family: isWord,
  plugin: isWord,
  judge_model: isWord,
  order: (v) => ORDERS.includes(v),
  judge_scale: isWord,
  prompt_version: Number.isInteger,
  prompt_sha256: isSha256,
  sanitizer_version: Number.isInteger,
  sanitizer_rules_sha256: isSha256,
  nonce: (v) => typeof v === 'string' && NONCE_RE.test(v),
  inputs: isObject,
  status: (v) => Object.values(JUDGMENT_STATUS).includes(v),
  attempts: (v) => Number.isInteger(v) && v >= 1,
  raw_text: isTextOrNull,
  parsed: isObjectOrNull,
  usage: isObjectOrNull,
  cost: isObjectOrNull,
  error: isTextOrNull,
});

const RESULT_FIELDS = Object.freeze({
  provenance_version: Number.isInteger,
  skill: isSlug,
  decision_rule: isWord,
  rule_sha256: isSha256,
  scale: isWord,
  judges: Array.isArray,
  inputs: isObject,
  result: isObject,
});

/** The most word checks one task may carry in a pair record. */
const MAX_CHECKS = 500;

/** True for an array of word-check results: `true`, `false` or `null` for each check. */
const isCheckResults = (v) =>
  Array.isArray(v) && v.length <= MAX_CHECKS && v.every((r) => r === true || r === false || r === null);

/**
 * Fields a pair may carry. Absent is allowed and means something (no word checks); present must be
 * well formed. `check_results`: one entry per check of the task, in the task's order.
 */
const PAIR_OPTIONAL_FIELDS = Object.freeze({
  check_results: isCheckResults,
});

/**
 * The first field of `rec` that is missing or of the wrong kind, as text; null when none is. A
 * field in `optional` may be absent, and when present must be of the right kind.
 */
function shapeProblem(rec, fields, optional = {}) {
  if (!isObject(rec)) return 'record is not an object';
  for (const [name, ok] of Object.entries(fields)) {
    if (!Object.hasOwn(rec, name)) return `missing field ${name}`;
    if (!ok(rec[name])) return `field ${name} is malformed`;
  }
  for (const [name, ok] of Object.entries(optional)) {
    if (Object.hasOwn(rec, name) && !ok(rec[name])) return `field ${name} is malformed`;
  }
  return null;
}

const assertShape = (rec, fields, what, optional) => {
  const problem = shapeProblem(rec, fields, optional);
  if (problem) throw new Error(`${what} record: ${problem}`);
  return rec;
};

// ---- freshness ------------------------------------------------------------------------------

/**
 * True when a stored pair is current. `expected` is `{ skill, taskId, arm, request }`: who the
 * pair should be and the task request as it is now. The pair's digest is recomputed from the
 * pair's own outputs and today's request and must equal the stored one, so an edited request, an
 * edited reply or snapshot, a changed `loaded` flag or a changed fingerprint all make it stale.
 */
function pairCurrent(rec, expected) {
  if (!expected || shapeProblem(rec, PAIR_FIELDS, PAIR_OPTIONAL_FIELDS)) return false;
  if (rec.provenance_version !== PROVENANCE_VERSION) return false;
  if (rec.skill !== expected.skill || rec.task_id !== expected.taskId || rec.arm !== expected.arm) {
    return false;
  }
  let now;
  try {
    now = pairInputs({
      taskId: rec.task_id,
      arm: rec.arm,
      request: expected.request,
      runnerFingerprint: rec.runner_fingerprint,
      answer: rec.answer,
      start: rec.start,
      final: rec.final,
      loaded: rec.loaded,
      checkResults: rec.check_results,
    });
  } catch (_) {
    return false;
  }
  return (
    isSha256(rec.inputs.pair_input_sha256) &&
    rec.inputs.pair_input_sha256 === now.pair_input_sha256 &&
    sha256(rec.inputs) === sha256(now)
  );
}

/**
 * True when a judgment record carries, and equals, everything `expected` says it should be made
 * with. `expected` is `{ skill, taskId, seat, order, model, inputs }` where `inputs` is the
 * `judgmentInputs` result for the call as it would be made now. Besides the digest, the template
 * version and sha, the sanitizer version and hash and the scale are each compared on their own, so
 * a record that was edited by hand to carry a digest it never earned is still caught.
 */
function judgmentMatches(rec, expected) {
  if (!expected || !isObject(expected.inputs) || !isSha256(expected.inputs.judge_input_sha256)) {
    return false;
  }
  if (shapeProblem(rec, JUDGMENT_FIELDS)) return false;
  const want = expected.inputs;
  return (
    rec.provenance_version === PROVENANCE_VERSION &&
    rec.skill === expected.skill &&
    rec.task_id === expected.taskId &&
    rec.seat === expected.seat &&
    rec.order === expected.order &&
    rec.judge_model === expected.model &&
    rec.prompt_version === want.prompt_version &&
    rec.prompt_sha256 === want.prompt_sha256 &&
    rec.sanitizer_version === want.sanitizer_version &&
    rec.sanitizer_rules_sha256 === want.sanitizer_rules_sha256 &&
    rec.judge_scale === want.judge_scale &&
    rec.inputs.judge_input_sha256 === want.judge_input_sha256 &&
    sha256(rec.inputs) === sha256(want)
  );
}

/** True when the judgment is current and its reply was usable. */
function judgmentDone(rec, expected) {
  return (
    judgmentMatches(rec, expected) &&
    rec.status === JUDGMENT_STATUS.OK &&
    rec.raw_text !== null &&
    rec.parsed !== null
  );
}

/**
 * True when the judgment is current and needs no further call: it is done, or it has been tried
 * `limit` times without a usable reply. A settled judgment that is not done counts in the result
 * as a refused or missing score; it is not asked for again.
 */
function judgmentSettled(rec, expected, limit = MAX_ATTEMPTS) {
  if (!judgmentMatches(rec, expected)) return false;
  return judgmentDone(rec, expected) || rec.attempts >= limit;
}

/**
 * True when a stored result is current: it carries the decision rule digest of this code and the
 * input digest the caller expects now. Without `expectedInputs` there is nothing to compare, so
 * the result is not current.
 */
function resultCurrent(rec, expectedInputs) {
  if (!isObject(expectedInputs) || !isSha256(expectedInputs.result_input_sha256)) return false;
  if (shapeProblem(rec, RESULT_FIELDS)) return false;
  const rule = decisionRuleSha256();
  return (
    rec.provenance_version === PROVENANCE_VERSION &&
    rec.rule_sha256 === rule &&
    expectedInputs.rule_sha256 === rule &&
    rec.inputs.provenance_version === PROVENANCE_VERSION &&
    rec.inputs.rule_sha256 === rule &&
    rec.inputs.result_input_sha256 === expectedInputs.result_input_sha256 &&
    sha256(rec.inputs) === sha256(expectedInputs)
  );
}

// ---- the store ------------------------------------------------------------------------------

/**
 * Opens the store rooted at `runDir`. Nothing is created until the first write. The returned
 * object has the path helpers (`paths`), readers that return a record or null (a missing or
 * unreadable file is null), and writers that validate the record's shape and derive the file from
 * the record's own identity fields, so a record can only be written where it says it belongs.
 */
function openStore(runDir) {
  if (typeof runDir !== 'string' || runDir.trim() === '') {
    throw new TypeError('openStore needs a run directory');
  }
  const root = path.resolve(runDir);
  const under = (...parts) => assertUnder(root, path.join(root, ...parts));

  const paths = {
    pair: (skill, taskId, arm) => {
      if (!ARMS.includes(arm)) throw new Error(`invalid arm ${JSON.stringify(String(arm))}`);
      return under(
        'pairs',
        assertSlug(skill, 'skill'),
        assertSlug(taskId, 'task id'),
        `${arm}.json`,
      );
    },
    judgment: (skill, taskId, seat, order) => {
      if (!ORDERS.includes(order)) throw new Error(`invalid order ${JSON.stringify(String(order))}`);
      return under(
        'judgments',
        assertSlug(skill, 'skill'),
        assertSlug(taskId, 'task id'),
        `${assertSlug(seat, 'seat')}.${order}.json`,
      );
    },
    result: (skill) => under('results', `${assertSlug(skill, 'skill')}.json`),
  };

  const write = (file, rec) => {
    const dir = path.dirname(file);
    if (!fs.existsSync(root)) ensurePrivateDir(root);
    assertNoLinks(root, file);
    ensurePrivateDir(dir);
    assertNoLinks(root, file);
    writePrivateAtomic(file, `${JSON.stringify(rec, null, 2)}\n`);
    return file;
  };

  return {
    root,
    paths,
    readPair: (skill, taskId, arm) => readJson(paths.pair(skill, taskId, arm)),
    readJudgment: (skill, taskId, seat, order) =>
      readJson(paths.judgment(skill, taskId, seat, order)),
    readResult: (skill) => readJson(paths.result(skill)),
    writePair: (rec) => {
      assertShape(rec, PAIR_FIELDS, 'pair', PAIR_OPTIONAL_FIELDS);
      return write(paths.pair(rec.skill, rec.task_id, rec.arm), rec);
    },
    writeJudgment: (rec) => {
      assertShape(rec, JUDGMENT_FIELDS, 'judgment');
      return write(paths.judgment(rec.skill, rec.task_id, rec.seat, rec.order), rec);
    },
    writeResult: (rec) => {
      assertShape(rec, RESULT_FIELDS, 'result');
      return write(paths.result(rec.skill), rec);
    },
    /** Every readable judgment record of a skill, in path order. Unreadable files are skipped. */
    listJudgments: (skill) => {
      const base = under('judgments', assertSlug(skill, 'skill'));
      if (!fs.existsSync(base)) return [];
      const out = [];
      for (const task of fs.readdirSync(base).filter(isSlug).sort()) {
        const dir = path.join(base, task);
        if (!fs.lstatSync(dir).isDirectory()) continue;
        for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
          const rec = readJson(assertUnder(root, path.join(dir, name)));
          if (rec) out.push(rec);
        }
      }
      return out;
    },
  };
}

module.exports = {
  DIR_MODE,
  FILE_MODE,
  MAX_ATTEMPTS,
  JUDGMENT_STATUS,
  PAIR_FIELDS,
  PAIR_OPTIONAL_FIELDS,
  JUDGMENT_FIELDS,
  RESULT_FIELDS,
  shapeProblem,
  ensurePrivateDir,
  writePrivateAtomic,
  pairCurrent,
  judgmentMatches,
  judgmentDone,
  judgmentSettled,
  resultCurrent,
  openStore,
};
