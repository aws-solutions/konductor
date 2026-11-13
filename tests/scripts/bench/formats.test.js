// SPDX-License-Identifier: Apache-2.0
// Contract tests for the four file-format validators (scripts/bench/lib/formats.js). Three sweeps check every
// field of every format (required, no extra fields, right type). One table per format then checks the value rules.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const formats = require('../../../scripts/bench/lib/formats');
const {
  createLayout,
  LayoutError,
} = require('../../../scripts/bench/lib/layout');
const helpers = require('./helpers');

/** kind -> [validator, builder of a good document, the context that makes the good document pass]. */
const KINDS = {
  rules: [formats.validateRules, helpers.goodRules, { skill: helpers.SKILL }],
  tasks: [
    formats.validateTasks,
    helpers.goodTasks,
    { skill: helpers.SKILL, batch: 'b1' },
  ],
  buckets: [
    formats.validateBuckets,
    helpers.goodBuckets,
    { rules: helpers.goodRules(), tasks: helpers.goodTasks() },
  ],
  exclusions: [formats.validateExclusions, helpers.goodExclusions, {}],
};
/** Objects keyed by free-form names (not fixed fields): they accept any key and may be empty. */
const RECORDS = {
  buckets: /^(rules|scenarios|scenarios\.[^.]+)$/,
  exclusions: /^batches$/,
};
/** Fields that take any string, the empty one too: notes for the person who reviews a baseline. */
const NOTE_FIELDS = /^rules\.\d+\.why$/;

const INHERITED_NAMES = [
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
];
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const getValueAt = (document, fieldPath) =>
  fieldPath
    ? fieldPath.split('.').reduce((node, key) => node[key], document)
    : document;
/** Dotted paths of every node below `document` (array items by index). */
const listPaths = (document, parentPath = '') =>
  Object.entries(document).flatMap(([key, value]) => [
    parentPath ? `${parentPath}.${key}` : key,
    ...(value && typeof value === 'object'
      ? listPaths(value, parentPath ? `${parentPath}.${key}` : key)
      : []),
  ]);

for (const [kind, [validate, buildGood, baseContext]] of Object.entries(
  KINDS,
)) {
  const document = buildGood();
  const objectPaths = [
    '',
    ...listPaths(document).filter(
      (fieldPath) =>
        isObject(getValueAt(document, fieldPath)) &&
        !RECORDS[kind]?.test(fieldPath),
    ),
  ];
  test(`${kind}: every object refuses an unknown field and requires each of its fields`, () => {
    for (const objectPath of objectPaths) {
      const buildPathUnder = (key) =>
        objectPath ? `${objectPath}.${key}` : key;
      assert.match(
        validate(
          helpers.edit(document, buildPathUnder('zz_extra'), 1),
          baseContext,
        ).errors.join(),
        /zz_extra: unknown field/,
        `unknown field under "${objectPath}"`,
      );
      for (const key of Object.keys(getValueAt(document, objectPath))) {
        assert.match(
          validate(
            helpers.edit(document, buildPathUnder(key), undefined),
            baseContext,
          ).errors.join(),
          new RegExp(`${key}: required field is missing`),
          `"${buildPathUnder(key)}" removed`,
        );
      }
    }
  });
  // These names exist on every object, so a lookup with `in` finds them even though no format has such a field.
  // `edit` defines each one as an own key, the way JSON.parse does.
  test(`${kind}: an extra field named after an inherited property is refused in every object`, () => {
    for (const objectPath of objectPaths)
      for (const extraName of INHERITED_NAMES)
        assert.match(
          validate(
            helpers.edit(
              document,
              objectPath ? `${objectPath}.${extraName}` : extraName,
              1,
            ),
            baseContext,
          ).errors.join(),
          new RegExp(`${extraName}: unknown field`),
          `"${extraName}" under "${objectPath}"`,
        );
  });
  test(`${kind}: every field refuses a value of the wrong type, and a file that is not an object is refused`, () => {
    for (const fieldPath of listPaths(document).filter(
      (candidate) => !RECORDS[kind]?.test(candidate),
    ))
      // A note field takes any string, the empty one too; it is still refused as an object.
      for (const badValue of NOTE_FIELDS.test(fieldPath) ? [{}] : [{}, ''])
        assert.notDeepEqual(
          validate(helpers.edit(document, fieldPath, badValue), baseContext)
            .errors,
          [],
          `"${fieldPath}" replaced by ${JSON.stringify(badValue)}`,
        );
    for (const badValue of [null, [], 'text', 7])
      assert.match(
        validate(badValue, baseContext).errors.join(),
        /must be an object/,
      );
  });
}

/** Several bad (or good) values for one path, run as one table row. */
const damageWithValues = (fieldPath, ...values) => ({
  many: fieldPath,
  values,
});

/**
 * One test per row [name, damage, expected, context]. damage is null (none), [path, value] for helpers.edit, damageWithValues(path, ...values),
 * or a function that changes the document in place. expected is a regex for the errors, or null for "accepted".
 * context is added to the kind's default context.
 */
function defineTable(kind, rows) {
  const [validate, buildGood, baseContext] = KINDS[kind];
  for (const [name, damage, expected, context] of rows) {
    test(`${kind}: ${expected ? 'rejects' : 'accepts'} ${name}`, () => {
      for (const change of damage?.many
        ? damage.values.map((value) => [damage.many, value])
        : [damage]) {
        let document = buildGood();
        if (Array.isArray(change)) document = helpers.edit(document, ...change);
        else if (change) change(document);
        const { errors } = validate(document, { ...baseContext, ...context });
        if (expected)
          assert.match(errors.join('\n'), expected, JSON.stringify(change));
        else assert.deepEqual(errors, []);
      }
    });
  }
}

const COMMON = [
  ['a good file', null, null],
  [
    'format_version 2, before anything else is read',
    ['format_version', 2],
    /^format_version: unsupported value 2[^\n]*$/,
  ],
  ['a string format_version', ['format_version', '1'], /unsupported value "1"/],
];
for (const kind of Object.keys(KINDS)) defineTable(kind, COMMON);

const QUOTES = helpers.goodRules().rules.map((rule) => rule.source_quote);
const takeFirstRules = (count) => [
  'rules',
  helpers.goodRules().rules.slice(0, count),
];

defineTable('rules', [
  [
    'a hash that is not 64 lowercase hex',
    damageWithValues('skill_md_sha256', 'A'.repeat(64), 'abc'),
    /64 lowercase hex/,
  ],
  ['a blank request_context', ['request_context', '  '], /must not be blank/],
  // `why` is a note for the person who reviews the baseline: it may be blank, but it must be a string.
  ['a blank why', ['rules.0.why', ''], null],
  [
    'a why that is not a string',
    ['rules.0.why', 3],
    /rules\[0\]\.why: must be a string/,
  ],
  [
    'an unknown rule class',
    ['rules.0.class', 'optional'],
    /rules\[0\]\.class: must be one of/,
  ],
  [
    'a rule id that is not <skill>-rNN',
    damageWithValues('rules.0.id', 'other-r01', 'brew-log-rx'),
    /must look like brew-log-rNN/,
  ],
  [
    'a duplicate rule id',
    ['rules.1.id', 'brew-log-r01'],
    /id "brew-log-r01" is used twice/,
  ],
  [
    'a one-word source quote, which would match inside almost any prompt',
    ['rules.0.source_quote', 'the'],
    /rules\[0\]\.source_quote: must be at least 12 characters, got 3/,
  ],
  [
    'a source quote of 11 characters',
    ['rules.0.source_quote', 'x'.repeat(11)],
    /rules\[0\]\.source_quote: must be at least 12 characters, got 11/,
  ],
  [
    'a source quote of 12 characters',
    ['rules.0.source_quote', 'x'.repeat(12)],
    null,
  ],
  // The minimum is checked on the text that is later matched against prompts: trimmed, with runs of spaces
  // collapsed. "the" plus 9 spaces is 12 raw characters but matches as "the" inside almost any prompt.
  [
    'a source quote padded with spaces, which is shorter than 12 characters once trimmed',
    damageWithValues(
      'rules.0.source_quote',
      `the${' '.repeat(9)}`,
      `${' '.repeat(9)}the`,
      `${'x'.repeat(11)} `,
      `a${' '.repeat(11)}b`,
    ),
    /rules\[0\]\.source_quote: must be at least 12 characters, got \d+ \(counted after trimming and collapsing repeated spaces\)/,
  ],
  [
    'a source quote that is 12 characters once trimmed, with spaces around it',
    ['rules.0.source_quote', `  ${'x'.repeat(12)}  `],
    null,
  ],
  ['2 rules', takeFirstRules(2), /needs at least 3 entries, got 2/],
  ['exactly 3 rules', takeFirstRules(3), null],
  [
    'a skill that differs from the folder',
    null,
    /does not match the folder "other"/,
    { skill: 'other' },
  ],
  [
    'quotes that all appear in SKILL.md',
    null,
    null,
    { skillMd: `# Skill\n\n${QUOTES.join('\n\n')}\n` },
  ],
  [
    'a quote missing from SKILL.md',
    null,
    /rules\[0\]\.source_quote: does not appear in SKILL\.md/,
    { skillMd: QUOTES.slice(1).join('\n') },
  ],
  [
    'quotes that differ from SKILL.md in case and spacing',
    null,
    null,
    { skillMd: QUOTES.join('\n').toUpperCase().replace(/ /g, '\n') },
  ],
]);

test('rules: no generic rule is a warning, not an error', () => {
  const noGuard = helpers.goodRules();
  noGuard.rules.forEach((rule) => (rule.class = 'useful'));
  const result = formats.validateRules(noGuard, KINDS.rules[2]);
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join(), /no guard data/);
  assert.deepEqual(
    formats.validateRules(helpers.goodRules(), KINDS.rules[2]).warnings,
    [],
  );
});

const makeWords = (count) =>
  Array.from({ length: count }, (_entry, i) => `w${i}`).join(' ');
const makeRubric = (count) =>
  Array.from(
    { length: count },
    (_entry, i) => `Checklist item number ${i} for the entry.`,
  );
const firstPrompt = helpers.goodTasks().scenarios[0].prompt;
const damagePromptWith = (text) => [
  'scenarios.0.prompt',
  `${firstPrompt} ${text}`,
];
const withRules = { rules: helpers.goodRules() };
const FIRST_ITEM_PATH = 'scenarios.0.rubric.0';
const damageFirstItem = (text) => [FIRST_ITEM_PATH, text];

defineTable('tasks', [
  [
    'a batch name that is not lowercase letters, digits and "-"',
    damageWithValues('batch', 'B1', 'b_1'),
    /batch: must be lowercase/,
  ],
  [
    'a timestamp that is not UTC ISO 8601',
    damageWithValues(
      'generated_at',
      '2026-01-15T10:00:00',
      '2026-01-15T10:00:00+01:00',
      '2026-02-31T10:00:00Z',
    ),
    /UTC ISO 8601/,
  ],
  [
    'a time of day that does not exist',
    damageWithValues(
      'generated_at',
      '2026-01-15T99:99:99Z',
      '2026-01-15T24:00:00Z',
      '2026-01-15T10:60:00Z',
      '2026-01-15T10:00:60Z',
      '2026-01-15T10:00:99.5Z',
    ),
    /UTC ISO 8601/,
  ],
  [
    'the first and last second of a day, with and without a fraction',
    damageWithValues(
      'generated_at',
      '2026-01-15T00:00:00Z',
      '2026-01-15T23:59:59Z',
      '2026-01-15T23:59:59.999Z',
      '2024-02-29T12:00:00Z',
    ),
    null,
  ],
  [
    'a rules hash of the wrong shape',
    ['rules_sha256', 'xyz'],
    /64 lowercase hex/,
  ],
  [
    'a duplicate scenario id',
    ['scenarios.1.id', 'brew-log-rules-1'],
    /id "brew-log-rules-1" is used twice/,
  ],
  [
    'task ids that differ only in case',
    ['scenarios.1.id', 'Brew-Log-Rules-1'],
    /scenarios: ids "Brew-Log-Rules-1" and "brew-log-rules-1" differ only in case/,
  ],
  [
    'a skill that differs from the folder',
    ['skill', 'other-skill'],
    /does not match the folder/,
  ],
  [
    'a batch that differs from the file name',
    ['batch', 'b2'],
    /does not match the file name, which says "b1"/,
  ],
  [
    'why_skill_matters as a string',
    ['scenarios.0.why_skill_matters', 'The draft is vague.'],
    null,
  ],
  [
    'why_skill_matters of the wrong type',
    ['scenarios.0.why_skill_matters', 3],
    /must be a string/,
  ],
  [
    '4 scenarios',
    ['scenarios', helpers.goodTasks().scenarios.slice(0, 4)],
    /scenarios: needs at least 5 entries, got 4/,
  ],
  ['a prompt of 45 words', ['scenarios.0.prompt', makeWords(45)], null],
  [
    'a prompt of 44 words',
    ['scenarios.0.prompt', makeWords(44)],
    /needs at least 45 words, got 44/,
  ],
  [
    'a rubric of 5 or 8 items',
    damageWithValues('scenarios.0.rubric', makeRubric(5), makeRubric(8)),
    null,
  ],
  [
    'a rubric of 4 items',
    ['scenarios.0.rubric', makeRubric(4)],
    /rubric: needs at least 5 entries, got 4/,
  ],
  [
    'a rubric of 9 items',
    ['scenarios.0.rubric', makeRubric(9)],
    /rubric: allows at most 8 entries, got 9/,
  ],
  [
    'a checklist item of 12 or 400 characters',
    damageWithValues(FIRST_ITEM_PATH, 'x'.repeat(12), 'x'.repeat(400)),
    null,
  ],
  [
    'a checklist item of 11 characters',
    damageFirstItem('x'.repeat(11)),
    /rubric\[0\]: must be at least 12 characters, got 11/,
  ],
  [
    'a checklist item of 401 characters',
    damageFirstItem('x'.repeat(401)),
    /rubric\[0\]: must be at most 400 characters, got 401/,
  ],
  [
    'a prompt that names the skill',
    damagePromptWith('Use the brew-log skill.'),
    /names "brew-log"/,
  ],
  [
    'a prompt that names a rule id',
    damagePromptWith('Follow brew-log-r02 please.'),
    /names "brew-log-r02"/,
    withRules,
  ],
  [
    'a prompt that quotes a rule',
    damagePromptWith('Remember: quote number 3 from the skill text.'),
    /names "Quote number 3/,
    withRules,
  ],
  ['a clean prompt, checked against the rules', null, null, withRules],
  [
    'the spaced form of the skill name in a prompt',
    damagePromptWith('Write a brew log entry.'),
    null,
  ],
]);

// One name rule (names.js) serves the validators and the layout. Each helpers.NAME_CASES entry is tried in every
// place a task id or batch name appears: a validator accepts exactly the names the table says, and the layout
// builds a path for every name a validator accepts, so `plan` cannot fail late on a file it called valid.
const LAYOUT = createLayout({ root: path.join(path.sep, 'work', 'repo') });
const canBuildPath = (buildPath) => {
  try {
    buildPath();
    return true;
  } catch (error) {
    if (error instanceof LayoutError) return false;
    throw error;
  }
};
const ID_ERROR = /(must be a task id usable in a file name|must not be blank)/;
const BATCH_ERROR =
  /(must be lowercase letters, digits and "-", starting with a letter or digit|must not be blank)/;
const TASK_ID_PLACES = [
  [
    'a task id',
    (id) =>
      formats.validateTasks(
        helpers.edit(helpers.goodTasks(), 'scenarios.0.id', id),
        { skill: helpers.SKILL, batch: 'b1' },
      ),
    ID_ERROR,
  ],
  [
    'a task id key in the bucket file',
    (id) =>
      formats.validateBuckets(
        helpers.edit(helpers.goodBuckets(), 'scenarios', {
          [id]: helpers.goodBuckets().scenarios['brew-log-rules-1'],
        }),
      ),
    /key must be a task id usable in a file name/,
  ],
  [
    'an excluded task id',
    (id) =>
      formats.validateExclusions(
        helpers.edit(helpers.goodExclusions(), 'batches.b1.scenarios.0.id', id),
      ),
    ID_ERROR,
  ],
];
const BATCH_PLACES = [
  [
    'the batch of a task file',
    (batch) =>
      formats.validateTasks(helpers.edit(helpers.goodTasks(), 'batch', batch), {
        skill: helpers.SKILL,
        batch,
      }),
    BATCH_ERROR,
  ],
  [
    'the batch of a bucket file',
    (batch) =>
      formats.validateBuckets(
        helpers.edit(helpers.goodBuckets(), 'batch', batch),
      ),
    BATCH_ERROR,
  ],
  [
    'a batch key in the exclusions file',
    (batch) =>
      formats.validateExclusions(
        helpers.edit(helpers.goodExclusions(), 'batches', {
          [batch]: { scenarios: [] },
        }),
      ),
    /key must be a batch name/,
  ],
];
for (const [place, validate, expectedError] of TASK_ID_PLACES) {
  test(`${place}: accepted exactly when it can be a path segment, and then the layout builds its files`, () => {
    for (const [name, isSegment] of helpers.NAME_CASES) {
      const { errors } = validate(name);
      assert.equal(errors.length === 0, isSegment, JSON.stringify(name));
      if (!isSegment)
        assert.match(errors.join('\n'), expectedError, JSON.stringify(name));
      else
        assert.ok(
          canBuildPath(() =>
            LAYOUT.answerFile(helpers.SKILL, 'b1', name, 'with'),
          ) &&
            canBuildPath(() =>
              LAYOUT.checklistFile(helpers.SKILL, 'b1', name),
            ) &&
            canBuildPath(() =>
              LAYOUT.judgmentFile(
                'items',
                helpers.SKILL,
                'b1',
                name,
                'xai',
                'with',
              ),
            ),
          `${JSON.stringify(name)} validates but the layout refuses it`,
        );
    }
  });
}
for (const [place, validate, expectedError] of BATCH_PLACES) {
  test(`${place}: accepted exactly when it is a batch name, and then the layout builds its files`, () => {
    for (const [name, , isBatch] of helpers.NAME_CASES) {
      const { errors } = validate(name);
      assert.equal(errors.length === 0, isBatch, JSON.stringify(name));
      if (!isBatch)
        assert.match(errors.join('\n'), expectedError, JSON.stringify(name));
      else
        assert.ok(
          canBuildPath(() => LAYOUT.tasksFile(helpers.SKILL, name)) &&
            canBuildPath(() => LAYOUT.bucketsFile(helpers.SKILL, name)) &&
            canBuildPath(() =>
              LAYOUT.answerFile(helpers.SKILL, name, 't', 'with'),
            ),
          `${JSON.stringify(name)} validates but the layout refuses it`,
        );
    }
  });
}

// The prompt check matches whole tokens, and a single-word skill name is allowed as an ordinary word.
const makeSkillDamage = (skill, text) => (document) => {
  document.skill = skill;
  document.scenarios[0].prompt = `${firstPrompt} ${text}`;
};
const buildRulesFor = (skill) => {
  const rules = helpers.goodRules();
  rules.skill = skill;
  rules.rules.forEach((rule, index) => (rule.id = `${skill}-r0${index + 1}`));
  return rules;
};
const NAMES_VERIFICATION = /names "verification"/;
/** One table row per text, all with the document's skill set to `skill`. */
const buildRowsFor = (skill, label, texts, expected, context = {}) =>
  texts.map((text) => [
    `${label}: ${JSON.stringify(text)}`,
    makeSkillDamage(skill, text),
    expected,
    { skill, ...context },
  ]);
defineTable('tasks', [
  ...buildRowsFor(
    'verification',
    'the ordinary word of a single-word skill name',
    ['Please add verification steps to the plan.'],
    null,
  ),
  ...buildRowsFor(
    'adr',
    'a single-word skill name inside another word',
    ['Place the notes in the top right quadrant of the board.'],
    null,
  ),
  // Single-word names: allowed as words, in any case and at the end of a sentence; refused only when used as a name.
  ...buildRowsFor(
    'constraints',
    'a single-word skill name as a plain word',
    [
      'Constraints matter here, and we have no verification of them. Honor the constraints.',
    ],
    null,
  ),
  ...buildRowsFor(
    'verification',
    'a single-word skill name in quote marks',
    [
      'Run the "verification" before release.',
      "Use 'verification' now.",
      'Use `verification` now.',
      'Use \u201cverification\u201d now.',
    ],
    NAMES_VERIFICATION,
  ),
  ...buildRowsFor(
    'verification',
    'a single-word skill name next to the word skill',
    [
      'Load skill verification first.',
      'The skill: Verification applies.',
      'Use the skill called verification.',
      'Please use the Verification Skill for this.',
      'Two verification   skills are meant.',
    ],
    NAMES_VERIFICATION,
  ),
  ...buildRowsFor(
    'verification',
    'a single-word skill name near a longer word that starts with "skill"',
    ['Do the verification skillfully.', 'A skillverification is not a thing.'],
    null,
  ),
  // A hyphenated name is refused anywhere as a whole token, not inside a longer word.
  [
    'a hyphenated skill name in any case',
    damagePromptWith('Please apply Brew-Log to it.'),
    /names "brew-log"/,
  ],
  [
    'a hyphenated skill name followed by more hyphenated text',
    damagePromptWith('Write it brew-log style.'),
    /names "brew-log"/,
  ],
  [
    'a hyphenated skill name inside longer words',
    damageWithValues(
      'scenarios.0.prompt',
      `${firstPrompt} The brew-logs of May.`,
      `${firstPrompt} See xbrew-log notes.`,
    ),
    null,
  ],
  // Rule ids match whole tokens too.
  [
    'a rule id that is a prefix of a longer token',
    makeSkillDamage('adr', 'See adr-r011 for details.'),
    null,
    { skill: 'adr', rules: buildRulesFor('adr') },
  ],
  [
    'a rule id on its own',
    makeSkillDamage('adr', 'See adr-r01 for details.'),
    /names "adr-r01"/,
    { skill: 'adr', rules: buildRulesFor('adr') },
  ],
  [
    'a rule quote inside a longer sentence, in other case and spacing',
    damagePromptWith('So:   QUOTE number 3 FROM the skill text, as requested.'),
    /names "Quote number 3/,
    withRules,
  ],
]);

const FIRST_SCENARIO_PATH = 'scenarios.brew-log-rules-1.';
const GOOD_ITEM = { bucket: 'value', rule_id: 'brew-log-r01' };

defineTable('buckets', [
  [
    'a bucket that does not match the class',
    ['rules.brew-log-r01.bucket', 'guard'],
    /class "useful" counts in "value"/,
  ],
  [
    'an unknown bucket',
    [`${FIRST_SCENARIO_PATH}1.bucket`, 'other'],
    /bucket: must be one of/,
  ],
  [
    'an item bucket that differs from its rule',
    [`${FIRST_SCENARIO_PATH}1.bucket`, 'guard'],
    /differs from the bucket of rule "brew-log-r01"/,
  ],
  [
    'an item for a rule that is not listed',
    [`${FIRST_SCENARIO_PATH}1.rule_id`, 'brew-log-r99'],
    /"brew-log-r99" is not in rules/,
  ],
  [
    'an item for a dropped rule',
    [`${FIRST_SCENARIO_PATH}1.rule_id`, 'brew-log-r06'],
    /was dropped/,
  ],
  [
    'an item number that is not a number',
    (document) => (document.scenarios['brew-log-rules-1'].first = GOOD_ITEM),
    /key must be an item number counted from 1/,
  ],
  [
    'an item number counted from 0',
    (document) => (document.scenarios['brew-log-rules-1']['0'] = GOOD_ITEM),
    /key must be an item number counted from 1/,
  ],
  [
    'item numbers with a gap',
    (document) => (
      (document.scenarios['brew-log-rules-1']['7'] = GOOD_ITEM),
      delete document.scenarios['brew-log-rules-1']['5']
    ),
    /items must be numbered 1\.\.n with no gap/,
  ],
  [
    'a skill that differs from the rules and task files',
    ['skill', 'other-skill'],
    /differs from the (rules|task) file/,
  ],
  [
    'a batch that differs from the task file',
    ['batch', 'b2'],
    /batch: "b2" differs from the task file/,
  ],
  [
    'a task missing from the sidecar',
    (document) => delete document.scenarios['brew-log-rules-4'],
    /scenarios\.brew-log-rules-4: missing/,
  ],
  [
    'a task that is not in the task file',
    (document) =>
      (document.scenarios['brew-log-rules-9'] =
        document.scenarios['brew-log-rules-1']),
    /brew-log-rules-9: no such task/,
  ],
  [
    'an item count that differs from the rubric length',
    (document) => delete document.scenarios['brew-log-rules-2']['5'],
    /brew-log-rules-2: has 4 items, the rubric has 5/,
  ],
  [
    'one key that holds the ids of all the rules, joined with commas',
    (document) => {
      const joinedKey = Object.keys(document.rules).join();
      document.rules = {
        [joinedKey]: { class: 'useful', kept: true, bucket: 'value' },
      };
      for (const items of Object.values(document.scenarios))
        for (const item of Object.values(items)) {
          item.rule_id = joinedKey;
          item.bucket = 'value';
        }
    },
    /must list exactly the rules of the rules file \(6\), got 1/,
  ],
  [
    'fewer rules than the rules file',
    (document) => delete document.rules['brew-log-r06'],
    /must list exactly the rules of the rules file \(6\), got 5/,
  ],
  [
    'a rule class that differs from the rules file',
    (document) =>
      (document.rules['brew-log-r01'] = {
        class: 'style',
        kept: true,
        bucket: 'format',
      }),
    /rules\.brew-log-r01\.class: differs from the rules file/,
  ],
]);

const EXCLUSION_PATH = 'batches.b1.scenarios.0.';

defineTable('exclusions', [
  [
    'reading B (items)',
    [`${EXCLUSION_PATH}scales`, ['items']],
    /"items" \(reading B\) cannot be excluded/,
  ],
  [
    'items next to outcome',
    [`${EXCLUSION_PATH}scales`, ['outcome', 'items']],
    /cannot be excluded/,
  ],
  [
    'scales that are not exactly ["outcome"]',
    damageWithValues(`${EXCLUSION_PATH}scales`, [], ['blind'], 'outcome'),
    /must be exactly \["outcome"\]/,
  ],
  [
    'a 19-character reason',
    [`${EXCLUSION_PATH}reason`, 'x'.repeat(19)],
    /at least 20 characters, got 19/,
  ],
  [
    'a date that is not a real YYYY-MM-DD date',
    damageWithValues(`${EXCLUSION_PATH}date`, '16-01-2026', '2026-13-01'),
    /real date written YYYY-MM-DD/,
  ],
  [
    'an upper-case batch name',
    ['batches.B1', { scenarios: [] }],
    /key must be a batch name/,
  ],
  ['a file with no batches', ['batches', {}], null],
  [
    'task ids that differ only in case in one batch',
    (document) =>
      document.batches.b1.scenarios.push({
        ...document.batches.b1.scenarios[0],
        id: 'BREW-LOG-RULES-3',
      }),
    /batches\.b1\.scenarios: tasks "BREW-LOG-RULES-3" and "brew-log-rules-3" differ only in case/,
  ],
  [
    'the same task id under two batches',
    (document) => (document.batches.b2 = document.batches.b1),
    null,
  ],
  [
    'the same task twice in one batch',
    (document) =>
      document.batches.b1.scenarios.push(document.batches.b1.scenarios[0]),
    /batches\.b1\.scenarios: task "brew-log-rules-3" is listed twice/,
  ],
]);

// A name that only an object's prototype has ("constructor") is not a key of the document, in a cross-check too.
test('buckets: a task or rule named like an inherited property is missing, not found', () => {
  const tasks = helpers.edit(
    helpers.goodTasks(),
    'scenarios.0.id',
    'constructor',
  );
  assert.match(
    formats
      .validateBuckets(helpers.goodBuckets(), {
        rules: helpers.goodRules(),
        tasks,
      })
      .errors.join('\n'),
    /scenarios\.constructor: missing; every task needs an entry/,
  );
  const unlistedRule = helpers.edit(
    helpers.goodBuckets(),
    'scenarios.brew-log-rules-1.1.rule_id',
    'toString',
  );
  assert.match(
    formats.validateBuckets(unlistedRule).errors.join('\n'),
    /"toString" is not in rules/,
  );
});

// Two task ids that differ only in case build one file on macOS and Windows. Both ids are named, once per group.
test('tasks: ids that differ only in case are refused with every spelling named; an exact repeat keeps its own message', () => {
  const caseErrors = (ids) => {
    const document = helpers.goodTasks();
    ids.forEach((id, index) => (document.scenarios[index].id = id));
    return formats
      .validateTasks(document, KINDS.tasks[2])
      .errors.filter((message) => message.includes('differ only in case'));
  };
  assert.deepEqual(caseErrors(['T1', 't1', 'a', 'b', 'c']), [
    'scenarios: ids "T1" and "t1" differ only in case; a file system that ignores case would give them one file',
  ]);
  assert.deepEqual(caseErrors(['Ab', 'aB', 'AB', 'c', 'd']), [
    'scenarios: ids "AB", "Ab" and "aB" differ only in case; a file system that ignores case would give them one file',
  ]);
  assert.equal(caseErrors(['t1', 't2', 't3', 't4', 't5']).length, 0);
  // Two groups give two messages.
  assert.equal(caseErrors(['T1', 't1', 'U2', 'u2', 'x']).length, 2);
  // The same id twice is "used twice" only.
  const repeated = helpers.goodTasks();
  repeated.scenarios[1].id = repeated.scenarios[0].id;
  const repeatErrors = formats
    .validateTasks(repeated, KINDS.tasks[2])
    .errors.join('\n');
  assert.match(repeatErrors, /is used twice/);
  assert.doesNotMatch(repeatErrors, /differ only in case/);
});

// The layout limits a skill name to 128 characters (names.js), and the validators must not accept a longer one.
test('a skill name is accepted up to 128 characters in every format that carries one, and the layout builds its folder', () => {
  const longSkill = 'a'.repeat(128);
  assert.deepEqual(
    formats.validateRules(buildRulesFor(longSkill), { skill: longSkill })
      .errors,
    [],
  );
  assert.ok(canBuildPath(() => LAYOUT.baselineDir(longSkill)));
  const tooLong = 'a'.repeat(129);
  assert.ok(!canBuildPath(() => LAYOUT.baselineDir(tooLong)));
  for (const [kind, buildGood] of [
    ['rules', () => buildRulesFor(tooLong)],
    ['tasks', helpers.goodTasks],
    ['buckets', helpers.goodBuckets],
  ])
    assert.match(
      formats[`validate${kind[0].toUpperCase()}${kind.slice(1)}`](
        helpers.edit(buildGood(), 'skill', tooLong),
      ).errors.join('\n'),
      /skill: must be lowercase letters, digits and "-", at most 128 characters/,
      kind,
    );
});

test('loadChecked: a kind named like an inherited property is an unknown kind', () => {
  assert.throws(
    () => formats.loadChecked('constructor', 'unused.json'),
    /unknown file kind "constructor"/,
  );
});

test('loadChecked: reads a good file, names the file in an error, and rejects a bad kind', () => {
  helpers.withTmp((dir) => {
    const writeFile = (name, data) => (
      helpers.write(path.join(dir, name), data),
      path.join(dir, name)
    );
    const { data, warnings } = formats.loadChecked(
      'rules',
      writeFile('rules.json', helpers.goodRules()),
      KINDS.rules[2],
    );
    assert.equal(data.skill, helpers.SKILL);
    assert.deepEqual(warnings, []);

    const badFile = writeFile(
      'bad.json',
      helpers.edit(helpers.goodRules(), 'rules.0.class', 'nope'),
    );
    assert.throws(
      () => formats.loadChecked('rules', badFile),
      (error) =>
        error instanceof formats.FormatError &&
        error.file === badFile &&
        /rules\[0\]\.class/.test(error.message),
    );
    assert.throws(
      () =>
        formats.loadChecked('rules', writeFile('broken.json', '{ not json')),
      /cannot be read as JSON/,
    );
    // A file that cannot be read is not a format problem: the system error comes through with its code and path, so a
    // caller can tell it from bad content.
    const missingFile = path.join(dir, 'missing.json');
    assert.throws(
      () => formats.loadChecked('rules', missingFile),
      (error) =>
        !(error instanceof formats.FormatError) &&
        error.code === 'ENOENT' &&
        error.path === missingFile,
    );
    assert.throws(
      () => formats.loadChecked('rules', dir),
      (error) =>
        !(error instanceof formats.FormatError) &&
        error.code === 'EISDIR' &&
        error.path === dir,
    );
    assert.throws(
      () => formats.loadChecked('nonsense', badFile),
      /unknown file kind/,
    );
    // A byte order mark is ignored; a repeated key is an error that names it.
    const markedFile = path.join(dir, 'marked.json');
    helpers.write(markedFile, `\uFEFF${JSON.stringify(helpers.goodRules())}`);
    assert.equal(
      formats.loadChecked('rules', markedFile, KINDS.rules[2]).data.skill,
      helpers.SKILL,
    );
    const repeatedFile = writeFile(
      'repeated.json',
      '{"format_version": 1, "batches": {"b1": {"scenarios": []},\n "b1": {"scenarios": []}}}',
    );
    assert.throws(
      () => formats.loadChecked('exclusions', repeatedFile),
      (error) =>
        error instanceof formats.FormatError &&
        error.file === repeatedFile &&
        error.errors.length === 1 &&
        error.errors[0] ===
          'has the key "b1" twice in batches (line 2); remove one, because JSON readers keep only the last',
    );
  });
});
