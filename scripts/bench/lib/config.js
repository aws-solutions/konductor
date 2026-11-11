// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark settings, read from a settings file:
 *
 *   1. a settings file: bench/config.json (`defaultFile`, usually layout.configFile), or the file named by `file`
 *   2. `overrides`, an object of the same shape (the command line passes --max-usd this way); later wins
 *
 * The committed bench/config.example.json holds every setting at its default value. A person copies it to
 * bench/config.json (git-ignored) and edits it. With no settings file the load is refused with the `cp` command.
 *
 * The known settings are the key structure of this package's own bench/config.example.json, not of the `--root`
 * repository. The settings file must have every known setting: a missing one is refused by name, and so is a
 * setting the example does not have, so a typo cannot pass silently. In overrides, objects merge key by key and
 * arrays replace. `models.judges` is an open map: it may hold any seat name, and in overrides a seat set to null is
 * removed.
 */
'use strict';

const path = require('path');
const { readJsonFile, JsonFileError } = require('./read-file');
const { SEAT_NAME } = require('./names');
const { REPO_ROOT } = require('./layout');

/** The committed example: every setting at its default. Its key structure is the list of known settings. */
const EXAMPLE_CONFIG_FILE = path.join(
  REPO_ROOT,
  'bench',
  'config.example.json',
);
/** One POSIX shell word: single-quoted, with each embedded `'` written as `'\''`. */
const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
/**
 * The refusal when the settings file is not there: it names the full path of the file that was looked for, which
 * with `--root` is not the current folder, and the `cp` command that makes it from this package's example. Both
 * paths in the command are shell-quoted, so it can be pasted as is when a path holds a space or a quote.
 */
const missingConfigMessage = (file, example = EXAMPLE_CONFIG_FILE) =>
  `${file} not found: run cp ${shellQuote(example)} ${shellQuote(file)}, then edit it`;

const OPEN_MAPS = new Set(['models.judges']);
// Top-level settings this version does not have, each with the message a settings file that sets one gets in place
// of the generic "unknown setting".
const REPLACED_SETTINGS = Object.freeze({
  stop_usd: 'replaced by total_cap_usd',
  hard_cap_usd: 'replaced by total_cap_usd',
  orders_per_pair: 'removed: each answer is scored on its own',
  model_prices: 'removed: calls are charged at the cost the CLI reports',
  agent_for: 'removed: the agent comes from the agent specs',
  needs_tools: 'removed: not in the MVP',
});
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A settings problem: a missing, unreadable or invalid settings file, or settings that name no checklist writer. A
 * caller can tell it from a bug in the benchmark by its type, as with LayoutError and JsonFileError.
 */
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** A refusal shared by the settings file and the overrides, or null when `key` may be looked up as a setting. */
function refusedName(key, settingPath, parentPath) {
  if (key === '__proto__') return `${settingPath}: not a valid setting name`;
  if (!parentPath && Object.hasOwn(REPLACED_SETTINGS, key))
    return `${settingPath}: ${REPLACED_SETTINGS[key]}`;
  return null;
}

/**
 * Checks that the settings file `value` has exactly the key structure of `known` (the example): every known setting,
 * nothing else. An open map must be an object and may hold any key.
 */
function checkStructure(known, value, parentPath, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${parentPath || 'config'}: must be an object`);
    return;
  }
  for (const [key, setting] of Object.entries(value)) {
    const settingPath = parentPath ? `${parentPath}.${key}` : key;
    const refusal = refusedName(key, settingPath, parentPath);
    if (refusal) errors.push(refusal);
    else if (!Object.hasOwn(known, key))
      errors.push(`${settingPath}: unknown setting`);
    else if (OPEN_MAPS.has(settingPath)) {
      if (!isPlainObject(setting))
        errors.push(`${settingPath}: must be an object`);
      else if (Object.hasOwn(setting, '__proto__'))
        errors.push(`${settingPath}.__proto__: not a valid setting name`);
    } else if (isPlainObject(known[key]))
      checkStructure(known[key], setting, settingPath, errors);
  }
  for (const key of Object.keys(known))
    if (!Object.hasOwn(value, key))
      errors.push(
        `${parentPath ? `${parentPath}.${key}` : key}: missing; copy it from bench/config.example.json`,
      );
}

function mergeInto(base, overrides, parentPath, errors) {
  if (!isPlainObject(overrides)) {
    errors.push(`${parentPath || 'config'}: must be an object`);
    return base;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const settingPath = parentPath ? `${parentPath}.${key}` : key;
    const refusal = refusedName(key, settingPath, parentPath);
    if (refusal) errors.push(refusal);
    else if (OPEN_MAPS.has(parentPath)) {
      // An entry is added or replaced by value, and removed by null.
      if (value === null) delete merged[key];
      else merged[key] = value;
    } else if (!Object.hasOwn(base, key))
      errors.push(`${settingPath}: unknown setting`);
    else
      merged[key] = isPlainObject(base[key])
        ? mergeInto(base[key], value, settingPath, errors)
        : value;
  }
  return merged;
}

function validateSettings(config, errors) {
  const checkNonEmptyString = (value, settingPath) => {
    if (typeof value !== 'string' || !value.trim())
      errors.push(`${settingPath}: must be a non-empty string`);
  };
  const checkPositiveNumber = (value, settingPath) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      errors.push(`${settingPath}: must be a number above 0`);
  };
  checkNonEmptyString(config.models.subject, 'models.subject');
  const seats = Object.entries(config.models.judges);
  if (!seats.length)
    errors.push('models.judges: needs at least one judge seat');
  for (const [seat, id] of seats) {
    if (!SEAT_NAME.test(seat))
      errors.push(
        `models.judges.${seat}: not a valid seat name; use lowercase letters, digits, "_" and "-", starting with a letter or digit, at most 64 characters (no ".")`,
      );
    checkNonEmptyString(id, `models.judges.${seat}`);
  }
  if (config.models.rubric_writer !== null)
    checkNonEmptyString(config.models.rubric_writer, 'models.rubric_writer');
  // The checklist writer is rubric_writer, else the `anthropic` seat's model (rubricWriterModel). With neither, no
  // checklist could be written, so this is a settings error that names the field.
  else if (!Object.hasOwn(config.models.judges, 'anthropic'))
    errors.push(
      'models.rubric_writer: set it, or keep an "anthropic" judge seat (the checklist writer uses that seat\'s model)',
    );
  for (const key of ['max_usd', 'total_cap_usd'])
    checkPositiveNumber(config[key], key);
  if (!errors.length && !(config.max_usd <= config.total_cap_usd)) {
    errors.push(
      `limits: need max_usd <= total_cap_usd, got ${config.max_usd}, ${config.total_cap_usd}`,
    );
  }
  if (
    typeof config.confirm_above_usd !== 'number' ||
    !Number.isFinite(config.confirm_above_usd) ||
    config.confirm_above_usd < 0
  )
    errors.push('confirm_above_usd: must be a number, 0 or more');
  if (config.aws_profile !== null)
    checkNonEmptyString(config.aws_profile, 'aws_profile');
  checkNonEmptyString(config.aws_region, 'aws_region');
  for (const [callKind, price] of Object.entries(
    config.estimate_usd_per_call,
  )) {
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0)
      errors.push(
        `estimate_usd_per_call.${callKind}: must be a number, 0 or more`,
      );
  }
}

const deepFreeze = (object) => {
  if (object && typeof object === 'object')
    Object.values(object).forEach(deepFreeze);
  return Object.freeze(object);
};

/**
 * Reads a settings file. Bad content and a failed system call are both a ConfigError that names the file: bad
 * content keeps the reader's message, and a failed call flattens the system error (its code) into the message.
 * `missing`, when given, is the whole message for a file that is not there (ENOENT). Anything else thrown is a bug
 * and is rethrown as is.
 */
function readConfigFile(file, { missing = null } = {}) {
  try {
    return readJsonFile(file);
  } catch (error) {
    if (error instanceof JsonFileError) throw new ConfigError(error.message);
    // Only a failed system call is a settings problem; anything else thrown while reading is a bug.
    if (typeof error?.code !== 'string') throw error;
    if (missing && error.code === 'ENOENT') throw new ConfigError(missing);
    throw new ConfigError(
      `${file}: cannot read the config file (${error.code})`,
    );
  }
}

let knownSettings = null;
/** The key structure of the committed example, read once. */
function readKnownSettings() {
  if (!knownSettings) knownSettings = readConfigFile(EXAMPLE_CONFIG_FILE);
  return knownSettings;
}

/**
 * The settings in force, frozen. `file` is an explicit choice; otherwise `defaultFile` (usually layout.configFile)
 * is read. Either must exist: a missing default file is refused with its full path and the `cp` command. Throws one
 * ConfigError that lists every problem of the first stage that finds any: unknown, missing or misplaced settings in
 * the file, then unknown or misplaced settings in the overrides, then invalid values, then the order of the two spend
 * limits.
 */
function loadConfig({ defaultFile, file, overrides } = {}) {
  const source =
    file || defaultFile || path.join(REPO_ROOT, 'bench', 'config.json');
  const errors = [];
  // Read once: a default file that is not there gets the `cp` line, whenever the read finds it missing.
  let config = readConfigFile(source, {
    missing: file ? null : missingConfigMessage(path.resolve(source)),
  });
  checkStructure(readKnownSettings(), config, '', errors);
  if (!errors.length && overrides)
    config = mergeInto(config, overrides, '', errors);
  if (!errors.length) validateSettings(config, errors);
  if (errors.length)
    throw new ConfigError(
      `invalid benchmark settings (${source}):\n${errors.map((message) => `  - ${message}`).join('\n')}`,
    );
  return deepFreeze(JSON.parse(JSON.stringify(config)));
}

/** The model that writes the request-only checklists: models.rubric_writer, else the `anthropic` seat's model. */
function rubricWriterModel(config) {
  const modelId = config.models.rubric_writer ?? config.models.judges.anthropic;
  if (!modelId)
    throw new ConfigError(
      'no checklist writer: set models.rubric_writer or keep an "anthropic" judge seat',
    );
  return modelId;
}

/** Judge seat names in config order. */
const seatsOf = (config) => Object.keys(config.models.judges);

module.exports = {
  EXAMPLE_CONFIG_FILE,
  ConfigError,
  missingConfigMessage,
  loadConfig,
  rubricWriterModel,
  seatsOf,
};
