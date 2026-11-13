// SPDX-License-Identifier: Apache-2.0
/**
 * Validators for the four skill-benchmark file formats:
 *
 *   validateRules      rules.json
 *   validateTasks      tasks-<batch>.json
 *   validateBuckets    tasks-<batch>.buckets.json
 *   validateExclusions bench/exclusions.json
 *
 * Every validator takes parsed JSON and returns { errors, warnings }: both are arrays of
 * strings, and a file is accepted when `errors` is empty. A reader rejects an unknown
 * `format_version`, a missing required field, a field of the wrong type and an extra field, so
 * a typo cannot pass silently. The optional second argument adds cross-file checks (the skill
 * folder name, SKILL.md text, the rules a task file was written from). It is never needed for
 * the single-file checks.
 *
 * Pure functions: no file or network access. loadChecked() is the one helper that reads a file.
 */
'use strict';

const { SAFE_SEGMENT, BATCH_NAME } = require('./names');
const { readJsonFile, JsonFileError } = require('./read-file');

const FORMAT_VERSION = 1;

/** The value limits of the file formats. */
const LIMITS = Object.freeze({
  minRules: 3,
  minScenarios: 5,
  // The shortest prompt of the frozen baselines is 47 words. A request still has to set up a situation, so a
  // prompt under 45 words is refused.
  minPromptWords: 45,
  minRubricItems: 5,
  maxRubricItems: 8,
  minItemChars: 12,
  maxItemChars: 400,
  minReasonChars: 20,
  // A quote of one or two common words ("the") would match inside almost any prompt, and every prompt would fail the
  // "names a rule's quote" check. 12 is the length of the shortest checklist item. The length is counted on the
  // trimmed text (normalizeForMatch), the value that is matched against prompts, so padding with spaces cannot pass.
  minQuoteChars: 12,
});

const RULE_CLASSES = Object.freeze(['useful', 'style', 'generic']);
/** The bucket each rule class counts in. */
const BUCKET_OF_CLASS = Object.freeze({
  useful: 'value',
  style: 'format',
  generic: 'guard',
});
const BUCKETS = Object.freeze(Object.values(BUCKET_OF_CLASS));

// At most 128 characters, the same limit as a skill name in the layout (names.js: SAFE_SEGMENT), so a skill the
// validators accept is one the layout can build a path from.
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// date, hour, minute, second; an optional fraction of a second is allowed and not captured
const ISO_UTC = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const LAST_HOUR = 23;
const LAST_MINUTE_OR_SECOND = 59; // no leap second 60: the timestamps are written by tools, not read from clocks
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---- small check combinators ------------------------------------------------------------------
// A check is (value, fieldPath, errors) => void. It pushes one message per problem and never throws.

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const joinPath = (parentPath, key) =>
  parentPath ? `${parentPath}.${key}` : key;
const isRealDay = (text) => {
  const epochMs = DAY.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  return (
    !Number.isNaN(epochMs) &&
    new Date(epochMs).toISOString().slice(0, 10) === text
  );
};

const createStringCheck =
  ({ min = 1, max = Infinity, pattern, hint, normalize } = {}) =>
  (value, fieldPath, errors) => {
    if (typeof value !== 'string')
      return void errors.push(`${fieldPath}: must be a string`);
    // With `normalize`, the length is that of the text a later check compares, not of the raw string.
    const counted = normalize ? normalize(value) : value;
    const length = [...counted].length;
    const note =
      length === [...value].length
        ? ''
        : ' (counted after trimming and collapsing repeated spaces)';
    if (!value.trim()) errors.push(`${fieldPath}: must not be blank`);
    else if (length < min)
      errors.push(
        `${fieldPath}: must be at least ${min} characters, got ${length}${note}`,
      );
    else if (length > max)
      errors.push(
        `${fieldPath}: must be at most ${max} characters, got ${length}${note}`,
      );
    else if (pattern && !pattern.test(value))
      errors.push(`${fieldPath}: ${hint}`);
  };
const checkBoolean = (value, fieldPath, errors) => {
  if (typeof value !== 'boolean')
    errors.push(`${fieldPath}: must be true or false`);
};
const createExactCheck = (expected) => (value, fieldPath, errors) => {
  if (value !== expected)
    errors.push(`${fieldPath}: must be ${JSON.stringify(expected)}`);
};
const createOneOfCheck = (allowedValues) => (value, fieldPath, errors) => {
  if (!allowedValues.includes(value))
    errors.push(
      `${fieldPath}: must be one of ${allowedValues.map((allowed) => JSON.stringify(allowed)).join(', ')}`,
    );
};
const createArrayCheck =
  (checkItem, { min = 0, max = Infinity } = {}) =>
  (value, fieldPath, errors) => {
    if (!Array.isArray(value))
      return void errors.push(`${fieldPath}: must be an array`);
    if (value.length < min)
      errors.push(
        `${fieldPath}: needs at least ${min} entries, got ${value.length}`,
      );
    else if (value.length > max)
      errors.push(
        `${fieldPath}: allows at most ${max} entries, got ${value.length}`,
      );
    value.forEach((item, index) =>
      checkItem(item, `${fieldPath}[${index}]`, errors),
    );
  };
/** An object with the named required fields and optional fields. Any other key is an error. */
const createShapeCheck = (requiredChecks, optionalChecks = {}) => {
  // Field lookups go through own keys of a table with no prototype, so an extra field named "constructor",
  // "toString" or "__proto__" is never mistaken for one of the format's fields.
  const knownFields = Object.assign(
    Object.create(null),
    requiredChecks,
    optionalChecks,
  );
  return (value, fieldPath, errors) => {
    if (!isPlainObject(value))
      return void errors.push(`${fieldPath || 'file'}: must be an object`);
    for (const [key, check] of Object.entries(requiredChecks)) {
      if (!Object.hasOwn(value, key))
        errors.push(`${joinPath(fieldPath, key)}: required field is missing`);
      else check(value[key], joinPath(fieldPath, key), errors);
    }
    for (const [key, check] of Object.entries(optionalChecks))
      if (Object.hasOwn(value, key))
        check(value[key], joinPath(fieldPath, key), errors);
    for (const key of Object.keys(value))
      if (!Object.hasOwn(knownFields, key))
        errors.push(`${joinPath(fieldPath, key)}: unknown field`);
  };
};
/** An object keyed by free-form names: key names must match `keyPattern`, values must pass `checkEntry`. */
const createRecordCheck =
  (checkEntry, keyPattern, keyHint) => (value, fieldPath, errors) => {
    if (!isPlainObject(value))
      return void errors.push(`${fieldPath}: must be an object`);
    for (const [key, entry] of Object.entries(value)) {
      if (keyPattern && !keyPattern.test(key))
        errors.push(`${joinPath(fieldPath, key)}: key ${keyHint}`);
      checkEntry(entry, joinPath(fieldPath, key), errors);
    }
  };

const checkSha256Hex = createStringCheck({
  pattern: SHA256,
  hint: 'must be 64 lowercase hex characters (SHA-256)',
});
const checkSkillName = createStringCheck({
  pattern: SKILL_NAME,
  hint: 'must be lowercase letters, digits and "-", at most 128 characters',
});
const BATCH_HINT =
  'must be lowercase letters, digits and "-", starting with a letter or digit';
const checkBatchName = createStringCheck({
  pattern: BATCH_NAME,
  hint: BATCH_HINT,
});
// A task id becomes a file name (answers, checklists, judgments), so it follows the layout's rule (names.js).
const TASK_ID_HINT =
  'must be a task id usable in a file name: letters, digits, ".", "_" and "-", starting with a letter or digit, no ".."';
const checkTaskId = createStringCheck({
  pattern: SAFE_SEGMENT,
  hint: TASK_ID_HINT,
});
const isRealTimestamp = (text) => {
  const match = ISO_UTC.exec(text);
  if (!match) return false;
  const [, day, hour, minute, second] = match;
  return (
    isRealDay(day) &&
    Number(hour) <= LAST_HOUR &&
    Number(minute) <= LAST_MINUTE_OR_SECOND &&
    Number(second) <= LAST_MINUTE_OR_SECOND
  );
};
const checkTimestamp = (value, fieldPath, errors) => {
  if (typeof value !== 'string' || !isRealTimestamp(value)) {
    errors.push(
      `${fieldPath}: must be a UTC ISO 8601 timestamp such as 2026-11-10T11:43:36Z`,
    );
  }
};
const checkDay = (value, fieldPath, errors) => {
  if (typeof value !== 'string' || !isRealDay(value))
    errors.push(`${fieldPath}: must be a real date written YYYY-MM-DD`);
};

/**
 * Wraps a shape into a validator. A file with a `format_version` other than 1 is refused before
 * anything else is read, because the other rules belong to version 1. `crossCheck(data, context,
 * errors, warnings)` adds the checks that need more than one field; it only runs on a file whose shape is sound.
 */
function makeValidator(requiredFields, optionalFields, crossCheck) {
  const checkShape = createShapeCheck(
    { format_version: createExactCheck(FORMAT_VERSION), ...requiredFields },
    optionalFields,
  );
  return (data, context = {}) => {
    const errors = [];
    const warnings = [];
    if (
      isPlainObject(data) &&
      Object.hasOwn(data, 'format_version') &&
      data.format_version !== FORMAT_VERSION
    ) {
      errors.push(
        `format_version: unsupported value ${JSON.stringify(data.format_version)}; this reader supports ${FORMAT_VERSION}`,
      );
      return { errors, warnings };
    }
    checkShape(data, '', errors);
    if (!errors.length && crossCheck)
      crossCheck(data, context, errors, warnings);
    return { errors, warnings };
  };
}

/** `object[key]` only when `key` is an own key; a plain lookup also finds inherited names such as "constructor". */
const ownValue = (object, key) =>
  Object.hasOwn(object, key) ? object[key] : undefined;

const findDuplicates = (list) => [
  ...new Set(list.filter((entry, index) => list.indexOf(entry) !== index)),
];
/**
 * Groups of different strings that are the same once case is folded, each group sorted: ["T1", "t1"].
 * An exact repeat is not a group (findDuplicates reports it). File names built from such ids collide on a
 * file system that ignores case (macOS, Windows), so one task's answer would overwrite the other's.
 */
const findCaseOnlyDifferences = (list) => {
  const spellings = new Map();
  for (const entry of new Set(list)) {
    const folded = entry.toLowerCase();
    spellings.set(folded, [...(spellings.get(folded) || []), entry]);
  }
  return [...spellings.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort());
};
/** The ids of a group, each quoted, for an error message: "T1" and "t1". */
const quoteAll = (group) =>
  group.length === 2
    ? `"${group[0]}" and "${group[1]}"`
    : `${group
        .slice(0, -1)
        .map((id) => `"${id}"`)
        .join(', ')} and "${group[group.length - 1]}"`;
const countWords = (text) => text.trim().split(/\s+/).length;
const normalizeForMatch = (text) =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- does a prompt name the skill, a rule or a rule id -----------------------------
// Both helpers take text that went through normalizeForMatch(): lower case, single spaces.

/** `name` as a whole token: not inside a longer run of letters or digits ("adr" is not in "quadrant"). */
const hasToken = (text, name) =>
  new RegExp(`(?<![a-z0-9])${escapeRegExp(name)}(?![a-z0-9])`).test(text);

const QUOTE_MARKS = '["\'`\u201c\u201d\u2018\u2019]';
/**
 * Whether `text` names the skill.
 *
 * A hyphenated name ("code-review") is distinctive: any whole-token use names the skill. The spaced
 * form ("write a code review") is an ordinary request and is allowed.
 *
 * A single-word name ("verification", "constraints", "adr") is also an ordinary word, so a prompt
 * may use it freely ("add verification steps"). It names the skill only when it is used as a name:
 * wrapped in quote marks or backticks ("verification"), or next to the word skill ("skill
 * verification", "skill: verification", "skill called verification", "the verification skill").
 */
function namesSkill(text, skill) {
  if (skill.includes('-')) return hasToken(text, skill);
  const escapedSkill = escapeRegExp(skill);
  const forms = [
    `${QUOTE_MARKS}${escapedSkill}${QUOTE_MARKS}`,
    `(?<![a-z0-9])skills?(?::\\s*|\\s+)(?:(?:called|named)\\s+)?${escapedSkill}(?![a-z0-9])`,
    `(?<![a-z0-9])${escapedSkill}\\s+skills?(?![a-z0-9])`,
  ];
  return new RegExp(forms.join('|')).test(text);
}

// ---- rules file ----------------------------------------------------------------------------

const checkText = createStringCheck();
/** A string that may be blank: text for the person who reviews a baseline, which no check or score reads. */
const checkNote = (value, fieldPath, errors) => {
  if (typeof value !== 'string') errors.push(`${fieldPath}: must be a string`);
};
const RULE = createShapeCheck({
  id: checkText,
  source_quote: createStringCheck({
    min: LIMITS.minQuoteChars,
    normalize: normalizeForMatch,
  }),
  class: createOneOfCheck(RULE_CLASSES),
  outcome: checkText,
  why: checkNote,
  scenario_hint: checkText,
});

/** context: { skill } the folder name, { skillMd } the SKILL.md text the quotes must appear in. */
const validateRules = makeValidator(
  {
    skill: checkSkillName,
    skill_md_sha256: checkSha256Hex,
    request_context: checkText,
    rules: createArrayCheck(RULE, { min: LIMITS.minRules }),
  },
  {},
  (rulesFile, context, errors, warnings) => {
    if (context.skill !== undefined && rulesFile.skill !== context.skill)
      errors.push(
        `skill: "${rulesFile.skill}" does not match the folder "${context.skill}"`,
      );
    const idPattern = new RegExp(`^${rulesFile.skill}-r\\d{2,}$`);
    rulesFile.rules.forEach((rule, index) => {
      if (!idPattern.test(rule.id))
        errors.push(
          `rules[${index}].id: must look like ${rulesFile.skill}-rNN, got "${rule.id}"`,
        );
      if (
        context.skillMd !== undefined &&
        !normalizeForMatch(context.skillMd).includes(
          normalizeForMatch(rule.source_quote),
        )
      ) {
        errors.push(
          `rules[${index}].source_quote: does not appear in SKILL.md`,
        );
      }
    });
    for (const id of findDuplicates(rulesFile.rules.map((rule) => rule.id)))
      errors.push(`rules: id "${id}" is used twice`);
    if (!rulesFile.rules.some((rule) => rule.class === 'generic'))
      warnings.push(
        'rules: no rule has class "generic", so the report will print "no guard data"',
      );
  },
);

// ---- task file -----------------------------------------------------------------------------

const SCENARIO = createShapeCheck(
  {
    id: checkTaskId,
    title: checkText,
    target_section: checkText,
    prompt: checkText,
    rubric: createArrayCheck(
      createStringCheck({ min: LIMITS.minItemChars, max: LIMITS.maxItemChars }),
      { min: LIMITS.minRubricItems, max: LIMITS.maxRubricItems },
    ),
  },
  { why_skill_matters: checkText },
);

/**
 * context: { skill, batch } expected values (the folder and the file name), { rules } the parsed rules
 * file. With rules, a prompt that names the skill, a rule id or a rule's quote is refused.
 */
const validateTasks = makeValidator(
  {
    skill: checkSkillName,
    batch: checkBatchName,
    generated_at: checkTimestamp,
    model: checkText,
    skills_version: checkText,
    rules_sha256: checkSha256Hex,
    scenarios: createArrayCheck(SCENARIO, { min: LIMITS.minScenarios }),
  },
  {},
  (tasksFile, context, errors) => {
    if (context.skill !== undefined && tasksFile.skill !== context.skill)
      errors.push(
        `skill: "${tasksFile.skill}" does not match the folder "${context.skill}"`,
      );
    if (context.batch !== undefined && tasksFile.batch !== context.batch)
      errors.push(
        `batch: "${tasksFile.batch}" does not match the file name, which says "${context.batch}"`,
      );
    for (const id of findDuplicates(
      tasksFile.scenarios.map((scenario) => scenario.id),
    ))
      errors.push(`scenarios: id "${id}" is used twice`);
    for (const group of findCaseOnlyDifferences(
      tasksFile.scenarios.map((scenario) => scenario.id),
    ))
      errors.push(
        `scenarios: ids ${quoteAll(group)} differ only in case; a file system that ignores case would give them one file`,
      );
    tasksFile.scenarios.forEach((scenario, index) => {
      const promptPath = `scenarios[${index}].prompt`;
      if (countWords(scenario.prompt) < LIMITS.minPromptWords)
        errors.push(
          `${promptPath}: needs at least ${LIMITS.minPromptWords} words, got ${countWords(scenario.prompt)}`,
        );
      const normalizedPrompt = normalizeForMatch(scenario.prompt);
      const reportNamed = (name) =>
        errors.push(
          `${promptPath}: names "${name}"; a prompt must not name the skill, a rule or a rule id`,
        );
      if (namesSkill(normalizedPrompt, tasksFile.skill))
        reportNamed(tasksFile.skill);
      for (const rule of context.rules ? context.rules.rules : []) {
        if (hasToken(normalizedPrompt, rule.id)) reportNamed(rule.id);
        // A quote is a phrase of the skill's own text, so it is matched verbatim (ignoring case and spacing).
        if (normalizedPrompt.includes(normalizeForMatch(rule.source_quote)))
          reportNamed(rule.source_quote);
      }
    });
  },
);

// ---- bucket sidecar ------------------------------------------------------------------------

const ITEM_NUMBER = /^[1-9]\d*$/;

/** context: { rules } parsed rules file, { tasks } parsed task file (both optional extra cross-checks). */
const validateBuckets = makeValidator(
  {
    skill: checkSkillName,
    batch: checkBatchName,
    rules: createRecordCheck(
      createShapeCheck({
        class: createOneOfCheck(RULE_CLASSES),
        kept: checkBoolean,
        bucket: createOneOfCheck(BUCKETS),
      }),
    ),
    scenarios: createRecordCheck(
      createRecordCheck(
        createShapeCheck({
          bucket: createOneOfCheck(BUCKETS),
          rule_id: checkText,
        }),
        ITEM_NUMBER,
        'must be an item number counted from 1',
      ),
      SAFE_SEGMENT,
      TASK_ID_HINT,
    ),
  },
  {},
  (bucketsFile, context, errors) => {
    for (const [ruleId, rule] of Object.entries(bucketsFile.rules)) {
      if (rule.bucket !== BUCKET_OF_CLASS[rule.class])
        errors.push(
          `rules.${ruleId}.bucket: class "${rule.class}" counts in "${BUCKET_OF_CLASS[rule.class]}", got "${rule.bucket}"`,
        );
    }
    for (const [scenarioId, items] of Object.entries(bucketsFile.scenarios)) {
      const itemNumbers = Object.keys(items)
        .map(Number)
        .sort((a, b) => a - b);
      if (itemNumbers.some((itemNumber, index) => itemNumber !== index + 1))
        errors.push(
          `scenarios.${scenarioId}: items must be numbered 1..n with no gap`,
        );
      for (const [itemNumber, item] of Object.entries(items)) {
        const rule = ownValue(bucketsFile.rules, item.rule_id);
        const itemPath = `scenarios.${scenarioId}.${itemNumber}`;
        if (!rule)
          errors.push(`${itemPath}.rule_id: "${item.rule_id}" is not in rules`);
        else if (!rule.kept)
          errors.push(
            `${itemPath}.rule_id: rule "${item.rule_id}" was dropped (kept is false) and may have no item`,
          );
        else if (item.bucket !== rule.bucket)
          errors.push(
            `${itemPath}.bucket: "${item.bucket}" differs from the bucket of rule "${item.rule_id}", "${rule.bucket}"`,
          );
      }
    }
    if (context.rules) {
      const expectedRuleIds = context.rules.rules.map((rule) => rule.id).sort();
      const actualRuleIds = Object.keys(bucketsFile.rules).sort();
      // Compared as lists: joined with a comma, one key that holds six ids ("a,b,c,d,e,f") would equal six keys.
      if (
        expectedRuleIds.length !== actualRuleIds.length ||
        expectedRuleIds.some((id, index) => id !== actualRuleIds[index])
      )
        errors.push(
          `rules: must list exactly the rules of the rules file (${expectedRuleIds.length}), got ${actualRuleIds.length}`,
        );
      for (const rule of context.rules.rules)
        if (
          ownValue(bucketsFile.rules, rule.id) &&
          bucketsFile.rules[rule.id].class !== rule.class
        )
          errors.push(
            `rules.${rule.id}.class: differs from the rules file ("${rule.class}")`,
          );
      if (context.rules.skill !== bucketsFile.skill)
        errors.push(
          `skill: "${bucketsFile.skill}" differs from the rules file ("${context.rules.skill}")`,
        );
    }
    if (context.tasks) {
      if (context.tasks.skill !== bucketsFile.skill)
        errors.push(
          `skill: "${bucketsFile.skill}" differs from the task file ("${context.tasks.skill}")`,
        );
      if (context.tasks.batch !== bucketsFile.batch)
        errors.push(
          `batch: "${bucketsFile.batch}" differs from the task file ("${context.tasks.batch}")`,
        );
      const taskIds = context.tasks.scenarios.map((scenario) => scenario.id);
      for (const id of taskIds)
        if (!ownValue(bucketsFile.scenarios, id))
          errors.push(`scenarios.${id}: missing; every task needs an entry`);
      for (const id of Object.keys(bucketsFile.scenarios))
        if (!taskIds.includes(id))
          errors.push(`scenarios.${id}: no such task in the task file`);
      for (const scenario of context.tasks.scenarios) {
        const itemCount = ownValue(bucketsFile.scenarios, scenario.id)
          ? Object.keys(bucketsFile.scenarios[scenario.id]).length
          : scenario.rubric.length;
        if (itemCount !== scenario.rubric.length)
          errors.push(
            `scenarios.${scenario.id}: has ${itemCount} items, the rubric has ${scenario.rubric.length}`,
          );
      }
    }
  },
);

// ---- exclusions file -----------------------------------------------------------------------

const checkScales = (value, fieldPath, errors) => {
  if (Array.isArray(value) && value.includes('items')) {
    return void errors.push(
      `${fieldPath}: "items" (reading B) cannot be excluded; a task cannot be hidden from the reading that measures rule-following`,
    );
  }
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'outcome')
    errors.push(`${fieldPath}: must be exactly ["outcome"]`);
};
const EXCLUSION = createShapeCheck({
  id: checkTaskId,
  scales: checkScales,
  reason: createStringCheck({ min: LIMITS.minReasonChars }),
  date: checkDay,
});

const validateExclusions = makeValidator(
  {
    batches: createRecordCheck(
      createShapeCheck({ scenarios: createArrayCheck(EXCLUSION) }),
      BATCH_NAME,
      'must be a batch name: lowercase letters, digits and "-", starting with a letter or digit',
    ),
  },
  {},
  (exclusionsFile, context, errors) => {
    for (const [batch, entry] of Object.entries(exclusionsFile.batches)) {
      for (const id of findDuplicates(
        entry.scenarios.map((scenario) => scenario.id),
      ))
        errors.push(`batches.${batch}.scenarios: task "${id}" is listed twice`);
      for (const group of findCaseOnlyDifferences(
        entry.scenarios.map((scenario) => scenario.id),
      ))
        errors.push(
          `batches.${batch}.scenarios: tasks ${quoteAll(group)} differ only in case; a file system that ignores case would treat them as one`,
        );
    }
  },
);

// ---- reading a file ---------------------------------------------------------------------------

const VALIDATORS = Object.freeze({
  rules: validateRules,
  tasks: validateTasks,
  buckets: validateBuckets,
  exclusions: validateExclusions,
});

class FormatError extends Error {
  constructor(file, kind, errors) {
    super(
      `${file}: not a valid ${kind} file\n${errors.map((message) => `  - ${message}`).join('\n')}`,
    );
    this.name = 'FormatError';
    this.file = file;
    this.errors = errors;
  }
}

/**
 * Parses `file` and checks it as `kind` ('rules', 'tasks', 'buckets' or 'exclusions'). Bad content throws
 * FormatError; a file that cannot be read throws the system error from `fs`, with `path` set.
 */
function loadChecked(kind, file, context = {}) {
  const validate = Object.hasOwn(VALIDATORS, kind) && VALIDATORS[kind];
  if (!validate) throw new Error(`unknown file kind "${kind}"`);
  let data;
  try {
    data = readJsonFile(file);
  } catch (error) {
    // Bad content says why itself (a syntax error, a repeated key). A read failure (missing, permission denied,
    // a folder) is not a format problem, so the system error goes on with its code and path.
    if (!(error instanceof JsonFileError)) throw error;
    throw new FormatError(file, kind, [error.detail]);
  }
  const { errors, warnings } = validate(data, context);
  if (errors.length) throw new FormatError(file, kind, errors);
  return { data, warnings };
}

module.exports = {
  BUCKETS,
  FormatError,
  validateRules,
  validateTasks,
  validateBuckets,
  validateExclusions,
  loadChecked,
};
