// SPDX-License-Identifier: Apache-2.0
// Tests for the sanitizer rules (scripts/bench/lib/sanitize.js and bundled-skills.js). Pure functions on committed
// fixtures: tests/fixtures/bench/sanitize.rules.json (one hit and one near-miss per rule) and sanitize.answers.json.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const sanitizer = require('../../../scripts/bench/lib/sanitize');
const {
  BUNDLED_SKILLS,
  ALIAS_SUFFIX,
  armSkillName,
} = require('../../../scripts/bench/lib/bundled-skills');
const { sha256 } = require('../../../scripts/bench/lib/provenance');
const {
  SKILL_CLASS_SPEC,
} = require('../../../scripts/bench/lib/skill-narration');
const helpers = require('./helpers');
const { timeInWorker } = require('./worker-timer');

const SKILL = 'e2e-test-strategy';
const RULE_CASES = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'sanitize.rules.json'),
);
const ANSWERS = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'sanitize.answers.json'),
);
const clean = (text, skill = SKILL) =>
  sanitizer.sanitizeAnswer(text, { skill }).text;

// Pinned: the hash of the sanitizer's spec (every rule, the pipeline, the normalization, the settings, the bundled-skill
// list and the caps). Any edit to one changes it; then bump SANITIZER_VERSION too. judge-input.js folds the same spec
// into the one provenance hash, so there is no second sanitizer hash to disagree with it.
const PINNED_SPEC_HASH =
  '0e4d754fb364b72fd8854722b96f1561c03f77cdc4f20f35c1346cd716ee2684';
const hashSpec = (overrides) =>
  sha256(sanitizer.createSanitizer(overrides).spec);

for (const ruleCase of RULE_CASES) {
  test(`rule ${ruleCase.rule}: removes its tell, and leaves the near-miss alone`, () => {
    for (const hitText of [].concat(ruleCase.hit)) {
      const hit = sanitizer.sanitizeAnswer(hitText, { skill: SKILL });
      assert.equal(hit.text, ruleCase.out, hitText);
      assert.ok(
        hit.counts[ruleCase.rule] > 0,
        `${ruleCase.rule} did not fire on ${hitText}: ${JSON.stringify(hit.counts)}`,
      );
    }
    for (const keepText of [].concat(ruleCase.keep)) {
      const keep = sanitizer.sanitizeAnswer(keepText, { skill: SKILL });
      assert.deepEqual([keep.text, keep.changes], [keepText, 0]);
    }
  });
}

test('every rule in the table has a case in the fixture', () => {
  assert.deepEqual(
    RULE_CASES.map((ruleCase) => ruleCase.rule).sort(),
    sanitizer.RULES.map((rule) => rule.id).sort(),
  );
});

for (const answerCase of ANSWERS.cases) {
  test(`answer, ${answerCase.name}`, () =>
    assert.equal(
      clean(answerCase.stored, ANSWERS.skill),
      answerCase.sanitized,
    ));
}

test('rule order: RULES is in phase order, PIPELINE runs the phases in that order, and the broad drop runs last', () => {
  const phaseIndexes = sanitizer.RULES.map((rule) =>
    sanitizer.PHASES.indexOf(rule.phase),
  );
  assert.ok(
    !phaseIndexes.includes(-1) &&
      phaseIndexes.every(
        (phaseIndex, i) => i === 0 || phaseIndex >= phaseIndexes[i - 1],
      ),
    'RULES is not in phase order',
  );
  assert.equal(sanitizer.RULES.at(-1).phase, 'post');
  // The order the code runs, not only the order of the table: the phases of PIPELINE, flattened, are PHASES.
  assert.deepEqual(
    sanitizer.PIPELINE.flatMap((step) => step.phases),
    sanitizer.PHASES,
  );
  // Every rewrite that removes or changes the word "skill" runs after the narration rules that key on it.
  const getPhaseIndex = (phaseName) => sanitizer.PHASES.indexOf(phaseName);
  for (const phaseName of ['rewrite', 'path', 'name', 'label', 'post'])
    assert.ok(
      getPhaseIndex(phaseName) > getPhaseIndex('sentence') &&
        getPhaseIndex(phaseName) > getPhaseIndex('block'),
      phaseName,
    );
  // Within the name phase, the longer forms go first.
  const nameIds = sanitizer.RULES.filter((rule) => rule.phase === 'name').map(
    (rule) => rule.id,
  );
  assert.ok(
    nameIds.indexOf('plugin-qualified-name') <
      nameIds.indexOf('skill-name-with-label') &&
      nameIds.indexOf('skill-name-with-label') < nameIds.indexOf('skill-name'),
  );
  // Run first, the bare-skill drop would lose these sentences whole. Names and possessives are neutralized before it.
  assert.equal(
    clean('Per the e2e-test-strategy skill, rank by risk.'),
    'Per the approach, rank by risk.',
  );
  assert.equal(
    clean("The skill's checklist treats S3 as global."),
    'The checklist treats S3 as global.',
  );
  // The narration rules need the skill word and plugin prefix, so they run before the name rules rewrite them.
  assert.equal(
    clean('I will load bench:e2e-test-strategy now. Row 1.'),
    'Row 1.',
  );
});

// The possessive rewrite must not run before the narration rules: it removes the word "skill" they key on, and these
// sentences would come out as clean-looking text. Under that order each of them keeps its narration.
const WITH_ARM_POSSESSIVE = [
  ["I loaded the skill's checklist and followed it. Row 1", 'Row 1'],
  ["Let me read the skill's instructions first.\nRow 1", 'Row 1'],
  ["Loading the skill's checklist...\nRow 1", 'Row 1'],
  ["I'm using the skill's guidance for this.\nRow 1", 'Row 1'],
  ["I'll follow this skill's steps.\nRow 1", 'Row 1'],
];
for (const [input, expected] of WITH_ARM_POSSESSIVE) {
  test(`narration before rewrite: ${JSON.stringify(input)} is removed`, () => {
    const result = sanitizer.sanitizeAnswer(input, { skill: SKILL });
    assert.equal(result.text, expected);
    assert.ok(
      !/skill/i.test(result.text) &&
        result.counts['skill-possessive'] === undefined,
      'the narration rule fired, not the possessive rewrite',
    );
  });
}
test('narration before rewrite: the same possessive in content is still rewritten, not dropped', () => {
  const result = sanitizer.sanitizeAnswer(
    "The skill's checklist treats S3 as global. I loaded the skill's checklist.",
    { skill: SKILL },
  );
  assert.equal(result.text, 'The checklist treats S3 as global.');
  assert.deepEqual(
    [result.counts['skill-possessive'], result.counts['loading-narration']],
    [1, 1],
  );
});

// Narration that uses one of the words SKILLWORD exempts in ordinary text. Both directions. [line, the rule that drops
// it]: the clause-level rule runs first and takes most of them; the post pattern, which the leak scan shares, matches
// every one too, and the check below keeps that true.
const LOOKUP_NARRATION = [
  [
    'There is no skill of that name, so I will answer directly.',
    'missing-skill-narration',
  ],
  [
    'No skill set or skill library matches this request.',
    'missing-skill-narration',
  ],
  [
    'I checked the skill registry and found nothing.',
    'missing-skill-narration',
  ],
  ['The skill catalog has no entry for it.', 'bare-skill-reference'],
  ['Such a skill library is not installed here.', 'missing-skill-narration'],
  ['The skill directory is not available to me.', 'missing-skill-narration'],
  [
    'I looked in the skill marketplace; no skill of that kind is loaded.',
    'missing-skill-narration',
  ],
];
const ORDINARY_SKILL_WORDS = [
  'She has a broad skill set.',
  'Write a skill set for the role.',
  'The skill of the team is clear.',
  'Our skills library for new hires has 40 courses.',
  'A skills registry helps HR plan hiring.',
  'The skill catalog of the course lists topics.',
  'Build a skill platform for staff training.',
];
const POST_PATTERN = new RegExp(sanitizer.SKILL_NARRATION, 'i');
for (const [line, rule] of LOOKUP_NARRATION) {
  test(`lookup narration is removed: ${line}`, () => {
    const result = sanitizer.sanitizeAnswer(`${line}\nRow 1`, { skill: SKILL });
    assert.equal(result.text, 'Row 1');
    assert.ok(result.counts[rule] > 0, JSON.stringify(result.counts));
    assert.match(line, POST_PATTERN);
  });
}
for (const line of ORDINARY_SKILL_WORDS) {
  test(`ordinary use of the same words is kept: ${line}`, () => {
    const result = sanitizer.sanitizeAnswer(`${line}\nRow 1`, { skill: SKILL });
    assert.deepEqual([result.text, result.changes], [`${line}\nRow 1`, 0]);
    assert.doesNotMatch(line, POST_PATTERN);
  });
}

// The post rule must not delete every sentence that has the word "skill" in it.
const ORDINARY_SKILL_NOUN = [
  'A good tester needs one more skill: patience.',
  'Developers need skills in Go and Rust.',
  'Stay within the 3-skill limit.',
  'List the skills the team lacks, then plan training.',
  'You wrote: "we need a skill to triage tickets". Here is a plan.',
  'Use `skill` as the column name in the table.',
  '## Required Skills\nPython and Go.\n## Next',
  '| Skill | Level |\n|---|---|\n| Python | 5 |\n| Go | 4 |',
  '| Skill | Available |\n|---|---|\n| Python | yes |',
  '- Skills: Go, Rust\n- Tools: git',
];
for (const input of ORDINARY_SKILL_NOUN) {
  test(`the word "skill" as an ordinary noun is kept: ${JSON.stringify(input)}`, () => {
    const result = sanitizer.sanitizeAnswer(input, { skill: SKILL });
    assert.deepEqual(
      [result.text, result.changes, result.removed_chars, result.removed_share],
      [input, 0, 0, 0],
    );
  });
}
test('a table is kept whole or not touched: a row is never dropped alone', () => {
  const table =
    '| Flow | Note |\n|---|---|\n| Login | The skill tool is not available |\n| Cart | ok |';
  assert.equal(
    clean(table),
    table,
    'table rows are structured content; the leak scan flags what is left',
  );
});

test('removed text is counted: characters, share of the answer, and by rule', () => {
  const result = sanitizer.sanitizeAnswer(
    'I loaded the skill. Row 1 is fine.\n  \nThere is no such skill.\n',
    { skill: SKILL },
  );
  assert.equal(result.text, 'Row 1 is fine.\n  \n');
  const dropped = 'Iloadedtheskill.'.length + 'Thereisnosuchskill.'.length;
  assert.deepEqual(
    [result.chars_in, result.removed_chars, result.removed_by_rule],
    [
      dropped + 'Row1isfine.'.length,
      dropped,
      { 'loading-narration': 16, 'bare-skill-reference': 19 },
    ],
  );
  assert.equal(result.removed_share, dropped / result.chars_in);
  assert.deepEqual(
    ['', '  \n '].map(
      (text) => sanitizer.sanitizeAnswer(text, { skill: SKILL }).removed_share,
    ),
    [0, 0],
    'an empty input removes nothing',
  );
  const wholeList = sanitizer.sanitizeAnswer(
    'Available skills:\n- a: x\n- b: y\nNow the answer.',
    { skill: SKILL },
  );
  assert.equal(
    wholeList.removed_chars,
    'Availableskills:'.length + '-a:x'.length + '-b:y'.length,
    'a dropped list block counts the whole block',
  );
  assert.equal(
    sanitizer.sanitizeAnswer('Use bench:other-thing here', { skill: '' })
      .removed_chars,
    0,
    'a rewrite keeps its text and is not a removal',
  );
  const big = sanitizer.sanitizeAnswer(
    'a'.repeat(sanitizer.MAX_INPUT_CHARS + 1),
    { skill: SKILL },
  );
  assert.deepEqual(
    [big.removed_chars, big.removed_share, big.chars_in],
    [0, 0, 0],
  );
});

test('case is kept: a one-word skill name is ordinary prose, and a multi-word name keeps its letters', () => {
  assert.equal(
    clean(
      'Verification is the last step. Use **verification** early. `verification` too.',
      'verification',
    ),
    'Verification is the last step. Use **verification** early. `verification` too.',
  );
  assert.equal(
    clean(
      '- Verification: run the tests\n- Review: read diffs',
      'verification',
    ),
    '- Verification: run the tests\n- Review: read diffs',
  );
  assert.equal(
    clean('Constraints are listed below.\n**Constraints**', 'constraints'),
    'Constraints are listed below.\n**Constraints**',
  );
  assert.equal(
    clean('Run Git status first. Git is a VCS.', 'git'),
    'Run Git status first. Git is a VCS.',
  );
  // The forms that name the skill are still neutralized for a one-word name.
  assert.equal(
    clean(
      'Per the verification skill, run tests. Use bench:verification now.',
      'verification',
    ),
    'Per the approach, run tests. Use verification now.',
  );
  assert.equal(
    clean('Use E2E-Test-Strategy and e2e-test-strategy.'),
    'Use E2E Test Strategy and e2e test strategy.',
  );
});

test('both arms get the same treatment: a matched pair differs only in the narration, and the same rules clean it', () => {
  const body = ANSWERS.cases[0].sanitized;
  const pair = ANSWERS.cases.slice(0, 2);
  const [withArm, withoutArm] = pair.map((answerCase) =>
    sanitizer.sanitizeAnswer(answerCase.stored, { skill: ANSWERS.skill }),
  );
  // Same visible content out of both. Per the approach is the one line the arms phrase differently.
  const keepContentLines = (text) =>
    text
      .split('\n')
      .filter((line) => /^(Login comes first|\| |## Test matrix)/.test(line));
  assert.deepEqual(
    keepContentLines(withArm.text),
    keepContentLines(withoutArm.text),
  );
  assert.equal(withArm.text, pair[0].sanitized);
  assert.equal(withoutArm.text, pair[1].sanitized);
  assert.ok(body.includes('Login comes first'));
  // The function has no arm input: an object that claims an arm is ignored, and the result is the same for the same text.
  const text = pair[0].stored;
  assert.deepEqual(
    sanitizer.sanitizeAnswer(text, { skill: ANSWERS.skill, arm: 'without' }),
    sanitizer.sanitizeAnswer(text, { skill: ANSWERS.skill }),
  );
  // One rule set: each arm's own tells are removed by rules that take no arm.
  assert.ok(
    withArm.counts['loading-narration'] > 0 &&
      withoutArm.counts['bare-skill-reference'] > 0,
  );
  // Narration-heavy and content-light removes about as much as a rule set that reads text alone can, and shows it.
  for (const result of [withArm, withoutArm])
    assert.ok(
      result.removed_share > 0 && result.removed_share < 0.25,
      String(result.removed_share),
    );
});

test('a bundled-named skill: the alias the arms installed it under is mapped back, then the usual rules apply', () => {
  const alias = armSkillName('code-review');
  assert.equal(alias, `code-review${ALIAS_SUFFIX}`);
  const viaAlias = clean(
    `Step 1: use ${alias} and bench:${alias} to check the diff.`,
    'code-review',
  );
  assert.equal(
    viaAlias,
    clean(
      'Step 1: use code-review and bench:code-review to check the diff.',
      'code-review',
    ),
  );
  assert.ok(!viaAlias.includes(ALIAS_SUFFIX));
  assert.ok(
    clean(`see ${alias}`, 'git-workflow').includes(alias),
    'another skill is untouched by the alias step',
  );
  assert.equal(armSkillName('git-workflow'), 'git-workflow');
  for (const skill of BUNDLED_SKILLS)
    assert.ok(
      !BUNDLED_SKILLS.includes(armSkillName(skill)),
      `${skill}: the alias must not be blocked itself`,
    );
});

const NORMALIZE_CASES = [
  [
    'zero-width characters inside a name',
    'use e2e-test\u200b-strategy now',
    'use e2e test strategy now',
  ],
  [
    'bidi and soft hyphen',
    'use \u202ee2e-test-st\u00adrategy\u202c now',
    'use e2e test strategy now',
  ],
  [
    'invisible tag characters',
    'use e2e-test-strategy\u{E0041}\u{E0042} now',
    'use e2e test strategy now',
  ],
  ['control characters', 'a\u0000b\u0007c\u009fd', 'abcd'],
  [
    'CRLF, CR and line separators become \\n',
    'a\r\nb\rc\u2028d\u2029e',
    'a\nb\nc\nd\ne',
  ],
];
for (const [name, input, expected] of NORMALIZE_CASES) {
  test(`normalization: ${name}`, () => assert.equal(clean(input), expected));
}

test('removed characters are counted apart from rule matches', () => {
  const result = sanitizer.sanitizeAnswer('a\u200bb', { skill: SKILL });
  assert.deepEqual(
    [result.text, result.changes, result.counts],
    ['ab', 0, { normalize_chars: 1 }],
  );
});

test('a name inside a fenced code block is neutralized; narration-like text there is example content', () => {
  assert.equal(
    clean('```\nrun bench:other-tool\n```'),
    '```\nrun other tool\n```',
  );
  assert.equal(
    clean("```\nI'll load the Skill tool\n```"),
    "```\nI'll load the Skill tool\n```",
  );
});

test('without a skill, only the skill-independent rules run', () => {
  assert.equal(
    clean('use e2e-test-strategy here', ''),
    'use e2e-test-strategy here',
  );
  assert.equal(
    clean('Ask k-developer. There is no such skill.', ''),
    'Ask developer.',
  );
});

test('deterministic and pure: same input, same result; the input and the module are untouched', () => {
  const input = Object.freeze(
    ANSWERS.cases.map((answerCase) => answerCase.stored).join('\n---\n'),
  );
  const first = sanitizer.sanitizeAnswer(input, { skill: SKILL });
  assert.deepEqual(sanitizer.sanitizeAnswer(input, { skill: SKILL }), first);
  sanitizer.sanitizeAnswer('bench:other and other', { skill: 'other' });
  assert.deepEqual(
    sanitizer.sanitizeAnswer(input, { skill: SKILL }),
    first,
    'a call for another skill leaves nothing behind',
  );
  assert.ok(
    Object.isFrozen(sanitizer.RULES) &&
      Object.isFrozen(sanitizer.DEFAULT_SETTINGS),
  );
});

test('idempotent: sanitizing sanitized text changes nothing', () => {
  for (const text of [
    ...RULE_CASES.flatMap((ruleCase) => [].concat(ruleCase.hit)),
    ...ANSWERS.cases.map((answerCase) => answerCase.stored),
    '',
    'plain text',
  ]) {
    const once = clean(text);
    assert.equal(clean(once), once, JSON.stringify(text));
  }
});

test('input over the cap is dropped whole, not cut and passed on; null and undefined are empty, any other non-string is refused', () => {
  const result = sanitizer.sanitizeAnswer(
    'a'.repeat(sanitizer.MAX_INPUT_CHARS + 1),
    { skill: SKILL },
  );
  assert.deepEqual(
    [result.text, result.too_long, result.changes],
    ['', true, 0],
  );
  assert.equal(
    sanitizer.sanitizeAnswer('a'.repeat(sanitizer.MAX_INPUT_CHARS), {
      skill: SKILL,
    }).too_long,
    false,
  );
  assert.deepEqual(
    [null, undefined].map((value) => clean(value)),
    ['', ''],
  );
  for (const value of [12, {}, ['a', 'b'], true])
    assert.throws(
      () => clean(value),
      /sanitize: the stored answer must be a string/,
      JSON.stringify(value),
    );
  assert.throws(
    () => sanitizer.sanitizeAnswer('x', { skill: 5 }),
    /sanitize: skill must be a string/,
  );
});

// A rule that backtracks from every start position grows with the square of the length. Each input below repeats one
// shape that would trigger it; the sanitizer runs in a worker, so a slow rule fails the test instead of hanging the run.
const SANITIZE_JS = require.resolve('../../../scripts/bench/lib/sanitize');
/** Sanitizes the text that `textSource` builds, in a worker. With `scanned`, an input dropped as too long fails. */
const sanitizeInWorker = (textSource, { scanned = false } = {}) =>
  timeInWorker(`
const sanitizer = require(${JSON.stringify(SANITIZE_JS)});
const text = ${textSource};
const result = sanitizer.sanitizeAnswer(text, { skill: ${JSON.stringify(SKILL)} });
if (${scanned} && result.too_long) throw new Error('the input was dropped as too long, so nothing was scanned');`);
for (const [name, unit] of [
  ['one long hyphenated token', 'a-'],
  ['one long path', 'a/'],
  ['dots', 'a.'],
  ['a run of marks', '*_'],
  ['repeats of a skill word', 'the skill '],
  ['narration cue then skill', 'no skill of '],
  ['skill word with the ambiguous next word', 'skill of '],
  ['a cue after each skill', 'skill, no '],
]) {
  test(`cost stays linear: ${name}`, () =>
    sanitizeInWorker(`${JSON.stringify(unit)}.repeat(100000)`));
}

// The Skill tool call shape. Each input is built to exactly MAX_INPUT_CHARS, so it is scanned and not dropped as too
// long.
for (const unit of [
  'Skill(',
  'Skill( ',
  'skill(',
  'Skill(' + ' '.repeat(999),
]) {
  test(`cost stays linear at the true cap: ${JSON.stringify(unit.slice(0, 8))}`, () =>
    sanitizeInWorker(
      `${JSON.stringify(unit)}.repeat(Math.ceil(sanitizer.MAX_INPUT_CHARS / ${unit.length})).slice(0, sanitizer.MAX_INPUT_CHARS)`,
      { scanned: true },
    ));
}

test('version and spec: version 6, stable, pinned, and free of per-run values', () => {
  assert.equal(sanitizer.SANITIZER_VERSION, 6);
  assert.equal(hashSpec(), PINNED_SPEC_HASH);
  assert.match(hashSpec(), /^[0-9a-f]{64}$/);
  const result = sanitizer.sanitizeAnswer('x', { skill: 'code-review' });
  assert.equal(result.sanitizer_version, sanitizer.SANITIZER_VERSION);
  assert.equal(
    result.rules_sha256,
    undefined,
    'the one provenance hash is built in judge-input.js',
  );
  assert.equal(sanitizer.RULES_HASH, undefined);
  assert.equal(sanitizer.sanitizerProvenance, undefined);
  assert.equal(hashSpec(), hashSpec(), 'a skill does not change the spec');
});

test('the spec holds everything that changes the output: rules in order, pipeline, bundled list, alias suffix, caps, code patterns', () => {
  const { spec } = sanitizer.createSanitizer();
  assert.deepEqual(
    spec.rules.map((rule) => rule[0]),
    sanitizer.RULES.map((rule) => rule.id),
    'rule order',
  );
  assert.deepEqual(spec.pipeline, sanitizer.PIPELINE);
  assert.deepEqual(spec.skill_class, SKILL_CLASS_SPEC);
  assert.deepEqual(spec.bundled_skills, BUNDLED_SKILLS);
  assert.equal(spec.alias_suffix, ALIAS_SUFFIX);
  assert.equal(spec.max_input_chars, sanitizer.MAX_INPUT_CHARS);
  assert.equal(spec.sanitizer_version, sanitizer.SANITIZER_VERSION);
  assert.deepEqual(Object.keys(spec.code_patterns).sort(), [
    'fence_close',
    'fence_open',
    'list_item',
    'sentence_split',
    'table_row',
  ]);
  assert.ok(
    sanitizer.RULES.some((rule) => rule.action === 'drop-followup'),
    'the follow-up pattern is a named rule in the table',
  );
  // The rule that drops by function names it in the table, and the name is part of the rule's entry in the spec.
  const classRuleIndex = sanitizer.RULES.findIndex(
    (rule) => rule.id === 'missing-skill-narration',
  );
  assert.equal(spec.rules[classRuleIndex].at(-1), 'skill-absence');
  // Each entry changes the hash, one at a time.
  const base = sha256(spec);
  const edits = [
    (specCopy) => specCopy.rules.reverse(),
    (specCopy) => specCopy.rules[0].push('x'),
    (specCopy) => (specCopy.rules[3][4] += 'x'),
    (specCopy) => specCopy.pipeline[0].phases.reverse(),
    (specCopy) => specCopy.bundled_skills.push('new-skill'),
    (specCopy) => (specCopy.alias_suffix += 'x'),
    (specCopy) => (specCopy.max_input_chars += 1),
    (specCopy) => (specCopy.sanitizer_version += 1),
    (specCopy) => (specCopy.code_patterns.fence += 'x'),
    (specCopy) => (specCopy.code_patterns.list_item += 'x'),
    (specCopy) => (specCopy.code_patterns.table_row += 'x'),
    (specCopy) => (specCopy.code_patterns.sentence_split += 'x'),
    (specCopy) => (specCopy.wrap += 'x'),
    (specCopy) => (specCopy.normalize.form = 'NFKC'),
    (specCopy) => (specCopy.settings.plugin += 'x'),
    // The clause-level rule's words, windows, token pattern and list of human-resources words.
    (specCopy) => specCopy.skill_class.words.narrators.push('x'),
    (specCopy) => specCopy.skill_class.words.lookVerbs.reverse(),
    (specCopy) => (specCopy.skill_class.window.negation += 1),
    (specCopy) => (specCopy.skill_class.token += 'x'),
    (specCopy) => (specCopy.skill_class.domain_next += 'x'),
    (specCopy) => (specCopy.rules[classRuleIndex][6] = ''),
  ];
  for (const [i, applyEdit] of edits.entries()) {
    const copy = JSON.parse(JSON.stringify(spec));
    applyEdit(copy);
    assert.notEqual(sha256(copy), base, `edit ${i} did not change the hash`);
  }
});

test('settings are configurable and part of the hash; bad settings are refused', () => {
  const hashWithOverrides = hashSpec;
  const variants = [
    { plugin: 'other' },
    { scratchPrefix: 'run' },
    { agentPatterns: ['acme-[a-z]+'] },
  ];
  assert.equal(
    new Set([PINNED_SPEC_HASH, ...variants.map(hashWithOverrides)]).size,
    4,
  );
  const acme = sanitizer.createSanitizer({ agentPatterns: ['acme-[a-z]+'] });
  assert.equal(
    acme.sanitize('Ask acme-helper and k-developer.').text,
    'Ask acme helper and k-developer.',
  );
  assert.equal(
    sanitizer
      .createSanitizer({ plugin: 'zz' })
      .sanitize('use zz:thing', { skill: '' }).text,
    'use thing',
  );
  for (const invalidSettings of [
    { plugin: 'a b' },
    { plugin: '' },
    { scratchPrefix: '../x' },
    { agentPatterns: 'k-' },
    { agentPatterns: ['('] },
    { agentPatterns: [''] },
  ]) {
    assert.throws(
      () => sanitizer.createSanitizer(invalidSettings),
      TypeError,
      JSON.stringify(invalidSettings),
    );
  }
});

// ---- settings, fences, names and the shapes the rules must keep
test('settings: an unknown key, no agent pattern, a pattern that matches nothing, a backreference or a named group is refused', () => {
  for (const [overrides, message] of [
    [{ plugn: 'x' }, /unknown setting\(s\): plugn/],
    [{ agentPatterns: [] }, /at least one pattern/],
    [{ agentPatterns: ['x*'] }, /matches the empty string/],
    [{ agentPatterns: ['a|'] }, /matches the empty string/],
    [{ agentPatterns: ['(a)\\1'] }, /backreferences or named groups/],
    [{ agentPatterns: ['(?<n>a)'] }, /backreferences or named groups/],
    [{ agentPatterns: ['(?<n>a)\\k<n>'] }, /backreferences or named groups/],
    [{ agentPatterns: ['('] }, /agentPatterns: /],
  ])
    assert.throws(
      () => sanitizer.createSanitizer(overrides),
      (error) =>
        error instanceof TypeError &&
        error.message.startsWith('sanitizer settings: ') &&
        message.test(error.message),
      JSON.stringify(overrides),
    );
  // A lookbehind is not a named group.
  assert.doesNotThrow(() =>
    sanitizer.createSanitizer({ agentPatterns: ['(?<=x)agent-[a-z]+'] }),
  );
});

test('settings: each agent pattern is its own group, so one with an alternation cannot swallow the next', () => {
  const custom = sanitizer.createSanitizer({
    agentPatterns: ['agent-a|agent-b', 'helper-[a-z]+'],
  });
  assert.equal(
    custom.sanitize('Ask agent-b and helper-joe.', { skill: '' }).text,
    'Ask agent b and helper joe.',
  );
});

test('fences follow CommonMark: a longer fence holds a shorter one, a fence closes only with its own character', () => {
  // Narration after a four-backtick example that holds a three-backtick line is prose and is dropped.
  assert.equal(
    clean('Steps:\n````md\n```js\nx\n````\nI loaded the skill first.\nRow 1'),
    'Steps:\n````md\n```js\nx\n````\nRow 1',
  );
  // Inside a five-backtick fence, a four-backtick line does not close it: what follows is still code.
  const fiveTicks = '`````\nx\n````\nI loaded the skill.\n`````\nRow 1';
  assert.equal(clean(fiveTicks), fiveTicks);
  assert.deepEqual(sanitizer.fenceMap('~~~\ncode\n```\nRow 1'.split('\n')), {
    fenced: [true, true, true, true],
    open: true,
  });
  // A backtick line with a backtick after the run is inline code, not a fence.
  assert.deepEqual(sanitizer.fenceMap(['```x```', 'I loaded the skill.']), {
    fenced: [false, false],
    open: false,
  });
  assert.equal(clean('```x```\nI loaded the skill.\nRow 1'), '```x```\nRow 1');
});

test('a skill name written with underscores is the same name', () => {
  assert.equal(
    clean('Use e2e_test_strategy here.'),
    'Use e2e test strategy here.',
  );
  assert.equal(
    clean('Per the e2e_test_strategy skill, rank.'),
    'Per the approach, rank.',
  );
});

test('a skill name or scratch prefix with a regex character is matched as written', () => {
  assert.equal(
    sanitizer.sanitizeAnswer('the a.b-c skill and axb-c', { skill: 'a.b-c' })
      .text,
    'the approach and axb-c',
  );
  const custom = sanitizer.createSanitizer({ scratchPrefix: 'my.box' });
  assert.equal(
    custom.sanitize('See /tmp/my.box-subject-1/x here.', { skill: '' }).text,
    'See x here.',
  );
  assert.equal(
    custom.sanitize('See /tmp/myXbox-subject-1/x here.', { skill: '' }).text,
    'See /tmp/myXbox-subject-1/x here.',
  );
});

test('the text is NFC, and a partly dropped line keeps its indent', () => {
  assert.equal(clean('caf\u0065\u0301', ''), 'caf\u00e9');
  assert.equal(
    clean('  - Step one. I loaded the skill. Step two.', ''),
    '  - Step one. Step two.',
  );
});

test('a skill-list header takes the blank lines and the indented lines of its list with it', () => {
  assert.equal(
    clean('Available skills:\n\n- a: x\n  more\n- b: y\nRow 1.', ''),
    'Row 1.',
  );
});

test('without a skill, a skills/ path and a line about skill notes are left alone', () => {
  for (const text of [
    'Read skills/other/notes.md first.',
    ' skill notes for the team.',
  ])
    assert.equal(clean(text, ''), text);
});
