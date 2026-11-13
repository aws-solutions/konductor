// SPDX-License-Identifier: Apache-2.0
/**
 * The measured cost profile: what one call of each kind and model cost in earlier runs, as a mean, a median and a
 * 90th percentile (p90). The committed profile is bench/profiles/cost-observed.json (DEFAULT_PROFILE_FILE);
 * `bench.js cost-profile` rebuilds one from a spend ledger.
 *
 * Lookup for a call of `kind` (subject, judge or writer) and `model`: the exact (kind, model) entry, else the
 * (kind, "*") entry, else `estimate_usd_per_call[kind]` as the mean and that times ESTIMATE_P90_FACTOR as the p90.
 * `plan` checks the p90 total against the limits and the ledger reserves each call's p90, so a run is refused before
 * it starts rather than stopped in the middle. An entry with `cliReportsLow: true` is a model whose CLI reports less
 * than the call cost; the ledger charges it at least its mean.
 *
 * A profile that is broken is an error that names the file, never a silent fallback to the estimates.
 */
'use strict';

const path = require('path');
const { readJsonFile, JsonFileError } = require('./read-file');
const { REPO_ROOT } = require('./layout');

const DEFAULT_PROFILE_FILE = path.join(
  REPO_ROOT,
  'bench',
  'profiles',
  'cost-observed.json',
);
const SCHEMA_VERSION = 1;
const CALL_KINDS = Object.freeze(['subject', 'judge', 'writer']);
/** The (kind, "*") entry: the cost of a kind for every model that has no entry of its own. */
const ANY_MODEL = '*';
/** The p90 of a call priced at its estimate: the estimate does not know the spread, so it is padded for retries and long answers. */
const ESTIMATE_P90_FACTOR = 1.5;
/** Where a price came from: the model's own entry, the kind's "*" entry, or estimate_usd_per_call. */
const COST_SOURCES = Object.freeze({
  model: 'model',
  kind: 'kind',
  estimate: 'estimate',
});
const STAT_FIELDS = ['mean', 'median', 'p90'];
const COUNT_FIELDS = ['calls', 'failed'];
const ENTRY_FIELDS = [
  'kind',
  'model',
  ...COUNT_FIELDS,
  ...STAT_FIELDS,
  'cliReportsLow',
];
/** The only currency the amounts may be in. */
const UNIT = 'usd';

/** A profile file that cannot be used. The message starts with the file. */
class CostProfileError extends Error {
  constructor(file, problems) {
    super(
      `${file}: not a usable cost profile:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
    );
    this.name = 'CostProfileError';
    this.file = file;
    this.problems = problems;
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isAmount = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The problems of one entry, each naming it by index. */
function entryProblems(entry, index, seen) {
  const where = `entries[${index}]`;
  if (!isPlainObject(entry)) return [`${where}: must be an object`];
  const problems = [];
  if (!CALL_KINDS.includes(entry.kind))
    problems.push(
      `${where}.kind: must be one of ${CALL_KINDS.join(', ')}, got ${JSON.stringify(entry.kind)}`,
    );
  if (typeof entry.model !== 'string' || !entry.model.trim())
    problems.push(`${where}.model: must be a non-empty string`);
  for (const field of STAT_FIELDS)
    if (!isAmount(entry[field]))
      problems.push(`${where}.${field}: must be a finite number, 0 or more`);
  if (isAmount(entry.mean) && isAmount(entry.p90) && entry.p90 < entry.mean)
    problems.push(
      `${where}.p90: must be at least the mean, got p90 ${entry.p90} and mean ${entry.mean}`,
    );
  for (const field of COUNT_FIELDS)
    if (
      field in entry &&
      !(Number.isInteger(entry[field]) && entry[field] >= 0)
    )
      problems.push(`${where}.${field}: must be a whole number, 0 or more`);
  if ('cliReportsLow' in entry && typeof entry.cliReportsLow !== 'boolean')
    problems.push(`${where}.cliReportsLow: must be true or false`);
  // A "*" entry prices every model of its kind that has no entry, so a floor there would charge them all.
  if (entry.model === ANY_MODEL && entry.cliReportsLow === true)
    problems.push(
      `${where}.cliReportsLow: not allowed on a "${ANY_MODEL}" entry; mark the model's own entry`,
    );
  for (const field of Object.keys(entry))
    if (!ENTRY_FIELDS.includes(field))
      problems.push(`${where}.${field}: unknown field`);
  const key = `${entry.kind}\u0000${entry.model}`;
  if (seen.has(key))
    problems.push(
      `${where}: a second entry for kind ${JSON.stringify(entry.kind)} and model ${JSON.stringify(entry.model)}`,
    );
  seen.add(key);
  return problems;
}

/** The problems of a parsed profile document, empty when it can be used. */
function profileProblems(document) {
  if (!isPlainObject(document)) return ['must be a JSON object'];
  const problems = [];
  if (document.schemaVersion !== SCHEMA_VERSION)
    problems.push(
      `schemaVersion: must be ${SCHEMA_VERSION}, got ${JSON.stringify(document.schemaVersion)}`,
    );
  if (document.unit !== UNIT)
    problems.push(
      `unit: must be ${JSON.stringify(UNIT)}, got ${JSON.stringify(document.unit)}`,
    );
  if (!Array.isArray(document.entries)) {
    problems.push('entries: must be an array');
    return problems;
  }
  const seen = new Set();
  document.entries.forEach((entry, index) =>
    problems.push(...entryProblems(entry, index, seen)),
  );
  return problems;
}

/**
 * Reads and checks the profile in `file` (DEFAULT_PROFILE_FILE when none is given). Returns the parsed document,
 * frozen, with `file` beside its own fields. Throws CostProfileError for content that breaks the rules, and the read
 * error (it names the file) for a file that cannot be read or parsed.
 */
function loadProfile(file = DEFAULT_PROFILE_FILE) {
  let document;
  try {
    document = readJsonFile(file);
  } catch (error) {
    if (error instanceof JsonFileError) throw error;
    throw new CostProfileError(file, [
      `cannot read the file (${error.code || error.message})`,
    ]);
  }
  const problems = profileProblems(document);
  if (problems.length) throw new CostProfileError(file, problems);
  const entries = document.entries.map((entry) => Object.freeze({ ...entry }));
  return Object.freeze({ ...document, entries: Object.freeze(entries), file });
}

let committedProfile = null;
/** The committed profile, read and checked once per process. */
function defaultProfile() {
  if (!committedProfile) committedProfile = loadProfile(DEFAULT_PROFILE_FILE);
  return committedProfile;
}

/**
 * The price of one call: { mean, p90, source, cliReportsLow }. `source` is `model` (the exact entry), `kind` (the
 * kind's "*" entry) or `estimate` (`estimates[kind]`, from estimate_usd_per_call, with a p90 of that times
 * ESTIMATE_P90_FACTOR). An unknown kind is a TypeError, so a typo cannot price a call at nothing.
 */
function costFor(profile, kind, model, estimates) {
  if (!CALL_KINDS.includes(kind))
    throw new TypeError(
      `costFor: kind must be one of ${CALL_KINDS.join(', ')}, got ${JSON.stringify(kind)}`,
    );
  const find = (modelKey) =>
    profile.entries.find(
      (entry) => entry.kind === kind && entry.model === modelKey,
    );
  const exact = find(model);
  const pooled = exact ? null : find(ANY_MODEL);
  const entry = exact || pooled;
  if (entry)
    return {
      mean: entry.mean,
      p90: entry.p90,
      source: exact ? COST_SOURCES.model : COST_SOURCES.kind,
      cliReportsLow: entry.cliReportsLow === true,
    };
  const estimate = estimates?.[kind];
  if (!isAmount(estimate))
    throw new TypeError(
      `costFor: no profile entry for ${kind} ${model} and estimate_usd_per_call.${kind} is not a number`,
    );
  return {
    mean: estimate,
    p90: estimate * ESTIMATE_P90_FACTOR,
    source: COST_SOURCES.estimate,
    cliReportsLow: false,
  };
}

/** costFor with the settings' estimates as the fallback, against the committed profile unless `profile` is given. */
const callCost = (config, kind, model, profile = defaultProfile()) =>
  costFor(profile, kind, model, config.estimate_usd_per_call);

module.exports = {
  DEFAULT_PROFILE_FILE,
  SCHEMA_VERSION,
  CALL_KINDS,
  ANY_MODEL,
  ESTIMATE_P90_FACTOR,
  COST_SOURCES,
  CostProfileError,
  profileProblems,
  loadProfile,
  defaultProfile,
  costFor,
  callCost,
};
