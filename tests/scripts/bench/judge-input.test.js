// SPDX-License-Identifier: Apache-2.0
// Tests for the judge-input step (scripts/bench/lib/judge-input.js): sanitize, redact, cap, leak scan. Pure functions on
// the committed sanitize.answers.json fixture. Secret-shaped strings are built here at run time, never written out.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const judgeInput = require('../../../scripts/bench/lib/judge-input');
const {
  createJudgeInput,
  scanLeaks,
  sanitizerProvenance,
  provenanceParts,
  MAX_ANSWER_CHARS,
  MAX_REMOVED_SHARE,
} = judgeInput;
const {
  newCanary,
  RULES: REDACT_RULES,
  INPUT_CEILING,
} = require('../../../scripts/bench/lib/redact');
const sanitizer = require('../../../scripts/bench/lib/sanitize');
const {
  BUNDLED_SKILLS,
  ALIAS_SUFFIX,
} = require('../../../scripts/bench/lib/bundled-skills');
const {
  judgmentInputs,
  sha256,
} = require('../../../scripts/bench/lib/provenance');
const helpers = require('./helpers');

const SKILL = 'e2e-test-strategy';
const ANSWERS = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'sanitize.answers.json'),
);
const RULE_CASES = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'sanitize.rules.json'),
);
const SKILL_CASES = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'skill-narration.cases.json'),
);
const KEY = ['AK', 'IA'].join('') + 'Q'.repeat(16); // shaped like an AWS access key id; not a real one
const defaultInput = createJudgeInput();
const prepare = (text, input = defaultInput) =>
  input.prepare(text, { skill: SKILL });
/** scanLeaks with the default sanitizer settings, which the default judge input sanitizes with. */
const scan = (text, options = {}) =>
  scanLeaks(text, { settings: defaultInput.settings, ...options });
const collectLeakIds = (leaks) => leaks.map((leak) => leak.id).sort();

for (const answerCase of ANSWERS.cases) {
  test(`both arms: ${answerCase.name} is eligible and clean`, () => {
    const result = prepare(answerCase.stored);
    assert.deepEqual(
      [
        result.text,
        result.eligible,
        result.reason,
        result.leaks,
        result.redacted,
        result.truncated,
      ],
      [answerCase.sanitized, true, null, [], false, false],
    );
  });
}

// [what leaked, the arm it comes from, text, ids the scan reports]. The scan runs on text that is already sanitized.
const LEAK_CASES = [
  [
    'a plugin-qualified name',
    'with',
    'I will load bench:e2e-test-strategy now',
    ['plugin-name', 'skill-name'],
  ],
  [
    'the skill slug',
    'with',
    'Following e2e-test-strategy here.',
    ['skill-name'],
  ],
  [
    'the bundled-skill alias',
    'with',
    'Use code-review-under-test here.',
    ['skill-name'],
    'code-review',
  ],
  [
    '"no such skill exists"',
    'without',
    'No such skill exists for that.',
    ['skill-word'],
  ],
  [
    '"skill-loading"',
    'without',
    'I only have a skill-loading tool.',
    ['skill-word'],
  ],
  [
    'a Skill tool result',
    'without',
    'Skill execution was blocked.\nThe Skill tool failed.',
    ['skill-word', 'tool-marker'],
  ],
  ['raw tool markers', 'with', 'tool_use then tool_result', ['tool-marker']],
  ['an agent id', 'with', 'Ask k-developer first.', ['agent-id']],
  [
    'a harness path',
    'with',
    'Saved to /tmp/bench-subject-ab12/notes.md',
    ['harness-path'],
  ],
  [
    'arm labels',
    'with',
    'the WITHOUT ARM text, with2 and condition ii',
    ['arm-label', 'arm-label-caps'],
  ],
  [
    'guidance narration',
    'with',
    'We loaded the guidance first.',
    ['guidance-narration'],
  ],
  [
    'a name inside fenced code is still a leak',
    'with',
    '```\nbench:other\n```',
    ['plugin-name'],
  ],
];
for (const [name, arm, text, expected, skill = SKILL] of LEAK_CASES) {
  test(`leak scan, ${arm} arm: ${name}`, () =>
    assert.deepEqual(collectLeakIds(scan(text, { skill })), expected));
}

test('leak scan: near-misses are clean (ordinary prose, a one-word skill name, narration-like text in fenced code)', () => {
  for (const [text, skill] of [
    ['Skill level: senior. Use a skills matrix. The skillset is wide.', SKILL],
    ['Run git status, then git diff.', 'git'],
    ["```\nI'll load the Skill tool in this example\n```", SKILL],
    [
      'Benchmark: bench press, scripts/benchmark.js, k-means, and the arm of a robot.',
      SKILL,
    ],
    ['Follow the guidance in the AWS style guide.', SKILL],
  ])
    assert.deepEqual(scan(text, { skill }), [], text);
  const [hit] = scan('see bench:some-thing here');
  assert.deepEqual([hit.sample, hit.count], ['bench:s', 1]);
});

// The sanitizer keeps each near-miss in its fixture, so the scan must not fail it: a hit here would drop the whole pair
// from both readings for text the sanitizer judged ordinary.
test('every near-miss the sanitizer keeps is eligible through prepare', () => {
  for (const ruleCase of RULE_CASES) {
    for (const keepText of [].concat(ruleCase.keep)) {
      const result = prepare(keepText);
      assert.deepEqual(
        [result.eligible, result.reason],
        [true, null],
        `${ruleCase.rule}: ${keepText}`,
      );
    }
  }
});

// What an arm whose skill load failed, or an arm with no skill, writes. It must never reach a judge: the sanitizer drops
// the sentence, and the scan, which shares its pattern, flags it if it were ever left in.
const MISSING_SKILL_NARRATION = [
  'No skill matched the request, so I wrote it by hand.',
  `I could not find a skill named ${SKILL}.`,
  'No skills are available in this session.',
  'There is no skill for this, so I used my own steps.',
  'I checked for a skill but none applied.',
  'Skill not found, so I proceeded without it.',
  'No matching skill was found.',
  'No relevant skill applied here.',
  'There was no skill available.',
  'The skill was unavailable, so I continued.',
  'I looked for a matching skill and found none.',
  'Skill unavailable.',
  'The skill could not be found.',
  'I did not find a skill for this task.',
  'No skill could be found.',
  'No skill was relevant here.',
  'I found no matching skill.',
  'None of the skills applied.',
  'I could not locate a skill for this.',
  'I was unable to find a skill.',
  'There is no such skill here.',
];

test('missing-skill narration is dropped by prepare and flagged by the leak scan', () => {
  const rest = 'Rank flows by risk first. Then test login. Then test checkout.';
  for (const sentence of MISSING_SKILL_NARRATION) {
    const result = prepare(`${sentence} ${rest}`);
    assert.equal(result.text, rest, sentence);
    assert.ok(collectLeakIds(scan(sentence)).includes('skill-word'), sentence);
  }
});

// The sanitizer and the scan share one rule for missing or unused skills (skill-narration.js), so a sentence the
// sanitizer drops is a leak if it is left in, and a sentence it keeps is clean. Every row of both tables, both ways.
const DROPPED_BY_SANITIZER = [
  ...Object.values(SKILL_CASES.drop).flat(),
  ...SKILL_CASES.drop_shape,
  ...SKILL_CASES.drop_named,
  ...SKILL_CASES.drop_accepted,
];
const KEPT_BY_SANITIZER = [...SKILL_CASES.keep, ...SKILL_CASES.keep_risky];
test('leak scan parity: every sentence the sanitizer drops is flagged skill-word, and prepare drops it', () => {
  assert.ok(DROPPED_BY_SANITIZER.length >= 55 + 5);
  for (const sentence of DROPPED_BY_SANITIZER) {
    assert.ok(
      collectLeakIds(scan(sentence, { skill: SKILL })).includes('skill-word'),
      `not flagged: ${sentence}`,
    );
    const result = prepare(`${sentence} ${SKILL_CASES.rest}`);
    assert.deepEqual(
      [result.text, result.leaks],
      [SKILL_CASES.rest, []],
      sentence,
    );
  }
});

test('leak scan parity: no ordinary sentence the sanitizer keeps is flagged', () => {
  assert.ok(KEPT_BY_SANITIZER.length >= 31);
  for (const sentence of KEPT_BY_SANITIZER)
    assert.deepEqual(scan(sentence, { skill: SKILL }), [], sentence);
});

test('leak scan: the rule reports its sentence once under skill-word, skips fenced code, and reads table rows', () => {
  assert.deepEqual(
    scan('A good tester needs skill. No skill could be found. Run it.'),
    [{ id: 'skill-word', count: 1, sample: 'No skill could be found.' }],
  );
  assert.deepEqual(
    scan('```\nNo skill could be found.\n```\nRow 1.'),
    [],
    'a fenced sample is example content',
  );
  assert.deepEqual(
    collectLeakIds(scan('| Login | No skill could be found |')),
    ['skill-word'],
    'the sanitizer leaves a table row alone; the scan is what stops it',
  );
  assert.deepEqual(
    collectLeakIds(scan('   I looked for a matching skill and found none.')),
    ['skill-word'],
    'an indented line is split as the sanitizer splits it',
  );
});

test('leak scan: the skill-word entry names its matcher, and the hash covers the name', () => {
  const entry = provenanceParts().leak_scan.find(
    (tuple) => tuple[0] === 'skill-word',
  );
  assert.equal(entry[4], 'skill-absence');
  assert.deepEqual(
    provenanceParts()
      .leak_scan.filter((tuple) => tuple[0] !== 'skill-word')
      .map((tuple) => tuple[4]),
    Array(judgeInput.LEAK_TABLE.length - 1).fill(''),
  );
});

test('leak scan: a sourced guidance reference is not narration, an unsourced one is', () => {
  for (const source of ['of', 'in', 'from', 'on', 'at', 'by', 'published']) {
    const line = `I followed the guidance ${source} the style guide.`;
    assert.deepEqual(scan(line), [], line);
  }
  assert.deepEqual(collectLeakIds(scan('I followed the guidance.')), [
    'guidance-narration',
  ]);
});

test('a leak fails the answer: not eligible, with the ids as the reason, and the text is still returned', () => {
  const result = prepare('tool_use call\nRow 1');
  assert.deepEqual(
    [result.eligible, result.reason, collectLeakIds(result.leaks)],
    [false, 'narration remains after sanitizing: tool-marker', ['tool-marker']],
  );
  assert.equal(result.text, 'tool_use call\nRow 1');
});

test('nothing left, or too long to sanitize: not eligible', () => {
  assert.deepEqual(
    [prepare('Skill loaded\n').eligible, prepare('Skill loaded\n').reason],
    [false, 'sanitizing left no answer'],
  );
  const long = prepare('a'.repeat(1000001));
  assert.deepEqual(
    [long.text, long.eligible, long.reason],
    ['', false, 'the answer is too long to sanitize'],
  );
});

test('redaction runs after sanitizing: key ids, the canary and exact credential values never reach a judge', () => {
  const canary = newCanary();
  const secret = 'not-a-real-secret-value-1234';
  const withLiteral = createJudgeInput({ literals: [secret] });
  const result = prepare(
    `Row 1 ${KEY}\nThe canary is ${canary}\nExport ${secret} now.\nI'll load the e2e-test-strategy skill.`,
    withLiteral,
  );
  assert.equal(
    result.text,
    'Row 1 [REDACTED_AWS_KEY_ID]\nThe canary is [REDACTED_CANARY]\nExport [REDACTED] now.',
  );
  assert.deepEqual([result.redacted, result.eligible], [true, true]);
  for (const value of [KEY, canary, secret])
    assert.ok(!result.text.includes(value));
});

test('redaction sees through characters the sanitizer normalizes away, and leaves prose that only names a variable', () => {
  const split = `${KEY.slice(0, 4)}\u200b${KEY.slice(4)}`;
  assert.equal(prepare(`Row 1 ${split}`).text, 'Row 1 [REDACTED_AWS_KEY_ID]');
  const prose = 'Set AWS_SESSION_TOKEN in the environment, then call the API.';
  assert.deepEqual(
    [prepare(prose).text, prepare(prose).redacted],
    [prose, false],
  );
});

test('size cap: cut after redaction so a cut cannot split a secret; flagged truncated; room for a long answer', () => {
  const small = createJudgeInput({ maxChars: 50 });
  const result = prepare(`${'x'.repeat(40)}${KEY}${'y'.repeat(100)}`, small);
  assert.deepEqual(
    [result.truncated, result.redacted, result.eligible],
    [true, true, true],
  );
  assert.ok(
    result.text.startsWith('x'.repeat(40) + '[REDACTED') &&
      result.text.endsWith('characters]'),
    result.text,
  );
  assert.ok(!result.text.includes(KEY.slice(0, 8)));
  const exact = prepare('z'.repeat(50), small);
  assert.deepEqual([exact.truncated, exact.text.length], [false, 50]);
  assert.equal(prepare('word '.repeat(10000)).truncated, false);
  assert.ok(MAX_ANSWER_CHARS >= 50000);
  for (const invalidMaxChars of [0, -1, 1.5, '5'])
    assert.throws(
      () => createJudgeInput({ maxChars: invalidMaxChars }),
      TypeError,
    );
});

test('deterministic: the same stored answer gives the same result, and the input is not changed', () => {
  const stored = Object.freeze(`${ANSWERS.cases[0].stored}\n${KEY}`);
  assert.deepEqual(prepare(stored), prepare(stored));
  assert.deepEqual(
    prepare(stored),
    createJudgeInput().prepare(stored, { skill: SKILL }),
  );
});

// Pinned: the one provenance hash, for the default options. Any change to a covered rule or setting changes it; bump
// SANITIZER_VERSION when it does. Then update this line.
const PINNED_PROVENANCE_HASH =
  '60e828afc8ab0252c8e9c84ec60b8ec36f75df741fa73d2a74056daeb5629093';

test('provenance: version 6, pinned, one value from every path, changed by the cap and the settings, not by per-run literals', () => {
  assert.equal(defaultInput.provenance.sanitizerVersion, 6);
  assert.equal(
    defaultInput.provenance.sanitizerRulesSha256,
    PINNED_PROVENANCE_HASH,
  );
  const hashWithOptions = (options) =>
    createJudgeInput(options).provenance.sanitizerRulesSha256;
  assert.equal(
    hashWithOptions({ literals: ['another-secret-value'] }),
    PINNED_PROVENANCE_HASH,
    'secrets of one run are not part of it',
  );
  assert.equal(
    new Set([
      PINNED_PROVENANCE_HASH,
      hashWithOptions({ maxChars: 100 }),
      hashWithOptions({ settings: { plugin: 'other' } }),
      hashWithOptions({ maxRemovedShare: 0.5 }),
    ]).size,
    4,
  );
  assert.equal(
    createJudgeInput().settings.plugin,
    sanitizer.DEFAULT_SETTINGS.plugin,
  );
  const judgment = {
    arm: 'with',
    answerSha256: helpers.makeFakeSha256('1'),
    checklistSha256: helpers.makeFakeSha256('3'),
    judgePromptSha256: helpers.makeFakeSha256('4'),
    judgeModel: 'm',
    ...defaultInput.provenance,
  };
  assert.equal(
    judgmentInputs(judgment).sanitizer_rules_sha256,
    PINNED_PROVENANCE_HASH,
  );
  const result = prepare('x');
  assert.deepEqual(
    [result.sanitizer_version, result.rules_sha256],
    [6, PINNED_PROVENANCE_HASH],
  );
});

test('provenance: sanitizerProvenance() and createJudgeInput() report the same value, for the same options, and nothing else exports a hash', () => {
  for (const optionSet of [
    {},
    { maxChars: 100 },
    { maxRemovedShare: 0.5 },
    { settings: { scratchPrefix: 'run' } },
    {
      maxChars: 7,
      maxRemovedShare: 1,
      settings: { plugin: 'x' },
      literals: ['a-secret-value'],
    },
  ]) {
    const { literals, ...options } = optionSet;
    assert.deepEqual(
      sanitizerProvenance(optionSet),
      createJudgeInput(optionSet).provenance,
      JSON.stringify(options),
    );
    assert.equal(
      prepare('x', createJudgeInput(optionSet)).rules_sha256,
      sanitizerProvenance(optionSet).sanitizerRulesSha256,
    );
    assert.equal(
      sanitizerProvenance(optionSet).sanitizerRulesSha256,
      sha256(provenanceParts(optionSet)),
    );
  }
  assert.deepEqual(sanitizerProvenance(), defaultInput.provenance);
  assert.equal(sanitizer.RULES_HASH, undefined);
  assert.equal(sanitizer.sanitizerProvenance, undefined);
  assert.equal(
    sanitizer.createSanitizer().rulesHash,
    undefined,
    'the sanitizer has a spec, not a second hash',
  );
  for (const invalidOptions of [
    { maxChars: 0 },
    { maxRemovedShare: 0 },
    { maxRemovedShare: 1.5 },
    { maxRemovedShare: '0.2' },
  ])
    assert.throws(
      () => sanitizerProvenance(invalidOptions),
      TypeError,
      JSON.stringify(invalidOptions),
    );
});

test('provenance: the hash covers every rule and setting that changes the judge-facing text or eligibility', () => {
  const parts = provenanceParts();
  // The parts are the live source of truth, not copies that can drift.
  assert.deepEqual(
    parts.sanitizer.rules.map((rule) => rule[0]),
    sanitizer.RULES.map((rule) => rule.id),
    'sanitizer rules, in order',
  );
  assert.deepEqual(parts.sanitizer.pipeline, sanitizer.PIPELINE);
  assert.deepEqual(parts.sanitizer.bundled_skills, BUNDLED_SKILLS);
  assert.equal(parts.sanitizer.alias_suffix, ALIAS_SUFFIX);
  assert.equal(parts.sanitizer.max_input_chars, sanitizer.MAX_INPUT_CHARS);
  assert.ok(
    parts.sanitizer.rules.some((rule) => rule[2] === 'drop-followup'),
    'the follow-up pattern is a rule of the table',
  );
  assert.deepEqual(parts.sanitizer.settings, sanitizer.DEFAULT_SETTINGS);
  assert.deepEqual(parts.redactor, {
    rules: REDACT_RULES.map((rule) => [
      rule.name,
      rule.pattern.source,
      rule.pattern.flags,
      rule.replacement,
    ]),
    input_ceiling: INPUT_CEILING,
  });
  assert.deepEqual(
    parts.leak_scan.map((entry) => entry[0]),
    judgeInput.LEAK_TABLE.map((entry) => entry.id),
    'leak-scan patterns',
  );
  assert.deepEqual(
    [parts.max_chars, parts.max_removed_share],
    [MAX_ANSWER_CHARS, MAX_REMOVED_SHARE],
  );
  assert.deepEqual(Object.keys(parts).sort(), [
    'leak_scan',
    'max_chars',
    'max_removed_share',
    'redactor',
    'sanitizer',
  ]);

  // Change each leaf, one at a time, and the hash changes. A string, number or flag in any part is covered.
  const base = sha256(parts);
  const clone = () => JSON.parse(JSON.stringify(parts));
  let leaves = 0;
  const walk = (node, parentKeys) => {
    for (const [key, value] of Object.entries(node)) {
      if (value !== null && typeof value === 'object')
        walk(value, [...parentKeys, key]);
      else {
        const copy = clone();
        const holder = parentKeys.reduce(
          (object, parentKey) => object[parentKey],
          copy,
        );
        holder[key] =
          typeof value === 'string'
            ? `${value}x`
            : typeof value === 'number'
              ? value + 1
              : !value;
        assert.notEqual(
          sha256(copy),
          base,
          `changing ${[...parentKeys, key].join('.')} left the hash unchanged`,
        );
        leaves += 1;
      }
    }
  };
  walk(parts, []);
  assert.ok(leaves > 200, `only ${leaves} leaves were checked`);

  // Removing or reordering an entry changes it too.
  for (const key of [
    'sanitizer.rules',
    'sanitizer.bundled_skills',
    'redactor.rules',
    'leak_scan',
    'sanitizer.settings.agentPatterns',
  ]) {
    const getList = (root) =>
      key.split('.').reduce((object, part) => object[part], root);
    const dropped = clone();
    getList(dropped).pop();
    const swapped = clone();
    getList(swapped).reverse();
    assert.notEqual(sha256(dropped), base, `${key}: removing an entry`);
    assert.notEqual(sha256(swapped), base, `${key}: reordering`);
  }
  assert.ok(
    !JSON.stringify(parts).includes('literal'),
    'no per-run secret value or field in the parts',
  );
});

// An answer the sanitizer emptied must not reach a judge, whatever is left.
test('removed share: recorded for every answer, and an answer above the limit is not eligible with the percent in the reason', () => {
  const content = 'a'.repeat(47);
  const narration = 'I loaded the skill.'; // 16 non-whitespace characters
  const over = prepare(`${narration} ${content}`);
  assert.deepEqual(
    [over.chars_in, over.removed_chars, over.removed_share],
    [63, 16, 16 / 63],
  );
  assert.deepEqual(
    [over.eligible, over.reason, over.text],
    [false, 'sanitizer removed 25.4% of the answer', content],
  );
  const exact = prepare(`${narration} ${content}a`);
  assert.deepEqual(
    [exact.removed_share, exact.eligible, exact.reason],
    [0.25, true, null],
    'exactly at the limit is allowed',
  );
  assert.deepEqual(exact.removed_by_rule, { 'loading-narration': 16 });
  const ordinary = prepare('A good tester needs one more skill: patience.');
  assert.deepEqual(
    [ordinary.removed_chars, ordinary.removed_share, ordinary.eligible],
    [0, 0, true],
  );
  assert.equal(MAX_REMOVED_SHARE, 0.25);
  assert.equal(defaultInput.maxRemovedShare, 0.25);
});

test('removed share: the limit is a setting; both arms are held to it', () => {
  const answer =
    'I loaded the skill. There is no such skill. Row 1 is the result of the run today.';
  const defaults = prepare(answer);
  assert.deepEqual(
    [defaults.eligible, defaults.reason],
    [
      false,
      `sanitizer removed ${+(defaults.removed_share * 100).toFixed(1)}% of the answer`,
    ],
  );
  const lenient = createJudgeInput({ maxRemovedShare: 0.9 });
  assert.deepEqual(
    [prepare(answer, lenient).eligible, prepare(answer, lenient).reason],
    [true, null],
  );
  const strict = createJudgeInput({ maxRemovedShare: 0.005 });
  assert.equal(
    prepare('I loaded the skill. ' + 'a'.repeat(2000), strict).eligible,
    false,
  );
  // A with-arm and a without-arm answer with the same content and narration of the same size get the same verdict.
  const withArm = prepare('I loaded the skill. ' + 'b'.repeat(40));
  const withoutArm = prepare('There is no such skill ' + 'b'.repeat(40));
  assert.notEqual(withArm.removed_chars, withoutArm.removed_chars);
  assert.equal(withArm.eligible, withoutArm.eligible);
  assert.equal(
    prepare('Skill loaded\n').reason,
    'sanitizing left no answer',
    'nothing left is reported as that, not as a share',
  );
});

// The leak scan uses the same narration pattern as the sanitizer.
test('leak scan: lookup narration is caught on text the sanitizer has not seen, and ordinary uses of the same words are clean', () => {
  for (const line of [
    'There is no skill of that name, so I will answer directly.',
    'No skill set or skill library matches this request.',
    'I checked the skill registry and found nothing.',
    'The skill catalog has no entry for it.',
  ])
    assert.deepEqual(collectLeakIds(scan(line)), ['skill-word'], line);
  for (const line of [
    'She has a broad skill set.',
    'Write a skill set for the role.',
    'The skill of the team is clear.',
    'A good tester needs one more skill: patience.',
    'Developers need skills in Go and Rust.',
    'Stay within the 3-skill limit.',
    '| Skill | Level |\n|---|---|\n| Go | 4 |',
  ]) {
    assert.deepEqual(scan(line), [], line);
  }
  // The sanitizer removes the narration, so a stored answer never reaches the scan with it.
  assert.deepEqual(
    [
      prepare('No skill set or skill library matches this request.\nRow 1')
        .text,
      prepare('No skill set or skill library matches this request.\nRow 1')
        .leaks,
    ],
    ['Row 1', []],
  );
  // A table row is left alone by the sanitizer, so the scan is what stops it.
  const row = prepare(
    '| Flow | Note |\n|---|---|\n| Login | The skill tool is not available |\n' +
      'x'.repeat(200),
  );
  assert.deepEqual(
    [row.eligible, collectLeakIds(row.leaks)],
    [false, ['skill-word']],
  );
});

// Probe inputs through createJudgeInput: [stored answer, skill, expected text, eligible].
const PLAN =
  'Row 1 of the plan covers login first, then the cart. Row 2 covers search and filters, and Row 3 covers the account settings page. Run the first two on every commit and the third every night, with one fresh data set for each run so the order of the tests never changes a result.';
const PROBES = [
  [
    'A good tester needs one more skill: patience.',
    SKILL,
    'A good tester needs one more skill: patience.',
    true,
  ],
  [
    'Developers need skills in Go and Rust.',
    SKILL,
    'Developers need skills in Go and Rust.',
    true,
  ],
  [
    'Stay within the 3-skill limit.',
    SKILL,
    'Stay within the 3-skill limit.',
    true,
  ],
  [
    '## Required Skills\nPython and Go.\n## Next',
    SKILL,
    '## Required Skills\nPython and Go.\n## Next',
    true,
  ],
  [
    '| Skill | Level |\n|---|---|\n| Python | 5 |\n| Go | 4 |',
    SKILL,
    '| Skill | Level |\n|---|---|\n| Python | 5 |\n| Go | 4 |',
    true,
  ],
  [
    'Use `skill` as the column name in the table.',
    SKILL,
    'Use `skill` as the column name in the table.',
    true,
  ],
  [
    "I loaded the skill's checklist and followed it.\n" + PLAN,
    SKILL,
    PLAN,
    true,
  ],
  ["Let me read the skill's instructions first.\n" + PLAN, SKILL, PLAN, true],
  ["Loading the skill's checklist...\n" + PLAN, SKILL, PLAN, true],
  [
    'Verification is the last step. Use **verification** early. `verification` too.',
    'verification',
    'Verification is the last step. Use **verification** early. `verification` too.',
    true,
  ],
  [
    '- Verification: run the tests\n- Review: read diffs',
    'verification',
    '- Verification: run the tests\n- Review: read diffs',
    true,
  ],
];
for (const [stored, skill, expected, eligible] of PROBES) {
  test(`probe ${JSON.stringify(stored.slice(0, 50))}`, () => {
    const result = defaultInput.prepare(stored, { skill });
    assert.deepEqual(
      [result.text, result.eligible, result.reason],
      [expected, eligible, null],
    );
  });
}

// A digest of the output for a fixed corpus. The hash covers the patterns; this covers the code that applies them. A
// change that moves behavior fails here even when no pattern changed. Update it, and bump SANITIZER_VERSION, on purpose.
test('behavior digest: a fixed corpus gives the same judge input', () => {
  const corpus = [
    ...RULE_CASES.flatMap((ruleCase) => [
      ...[].concat(ruleCase.hit),
      ...[].concat(ruleCase.keep),
    ]),
    ...ANSWERS.cases.map((answerCase) => answerCase.stored),
  ];
  const outputs = corpus.map((text) => {
    const result = defaultInput.prepare(text, { skill: SKILL });
    return [
      result.text,
      result.eligible,
      result.reason,
      result.removed_chars,
      result.leaks.map((leak) => leak.id),
    ];
  });
  assert.equal(
    sha256(outputs),
    '79c39aaece6d1c977043db47daeff7e54c0fbea4e8966dda9d57870cbab53139',
  );
});

// ---- the boundary: what prepare takes, and what reaches a judge
test('prepare needs the skill as a string, and the stored answer as a string, null or undefined', () => {
  assert.throws(
    () => defaultInput.prepare('x'),
    /prepare: options\.skill must be a string/,
  );
  assert.throws(
    () => defaultInput.prepare('x', { skillName: SKILL }),
    /prepare: options\.skill must be a string/,
  );
  assert.throws(
    () => defaultInput.prepare('x', { skill: 5 }),
    /prepare: options\.skill must be a string/,
  );
  assert.equal(defaultInput.prepare('x', { skill: '' }).eligible, true);
  for (const stored of [{}, ['a'], 12])
    assert.throws(
      () => prepare(stored),
      /the stored answer must be a string/,
      JSON.stringify(stored),
    );
  assert.equal(prepare(null).reason, 'sanitizing left no answer');
});

test('scanLeaks needs the settings the text was sanitized with', () => {
  assert.throws(() => scanLeaks('x'), /options\.settings is required/);
});

test('an answer that ends inside an open code fence is not eligible', () => {
  for (const text of ['```\ncode\nRow 1', '~~~\ncode\n```\nRow 1'])
    assert.deepEqual(
      [prepare(text).eligible, prepare(text).reason],
      [false, 'unclosed code fence'],
      text,
    );
  assert.equal(prepare('```\ncode\n```\nRow 1').eligible, true);
});

test('a bare SKILL.md is a leak anywhere, also in code; a sentence that names it is dropped', () => {
  const inCode = prepare('```\ncat SKILL.md\n```\nRow 1');
  assert.deepEqual(
    [inCode.eligible, collectLeakIds(inCode.leaks)],
    [false, ['skill-file']],
  );
  assert.equal(prepare('Per SKILL.md, rank. Row 1.').text, 'Row 1.');
});

test('the skill name written with underscores is found by the leak scan', () => {
  assert.deepEqual(
    collectLeakIds(scan('Use e2e_test_strategy.', { skill: SKILL })),
    ['skill-name'],
  );
});

test('the alias a bundled-named skill was installed under is mapped back in any letter case', () => {
  const result = defaultInput.prepare(
    'Run Code-Review-Under-Test first. Rank.',
    {
      skill: 'code-review',
    },
  );
  assert.deepEqual(
    [result.text, result.eligible],
    ['Run code review first. Rank.', true],
  );
});

test('a whitespace-only answer is not eligible, and a long clean answer is cut once, after redaction', () => {
  assert.deepEqual(
    [prepare('   \n ').eligible, prepare('   \n ').reason],
    [false, 'sanitizing left no answer'],
  );
  const long = prepare('word '.repeat(20000));
  assert.equal(long.redacted, false);
  assert.equal(long.truncated, true);
  assert.match(long.text, /\[truncated 50000 characters\]$/);
});

test('leaks: every match is counted, the sample is the first match, and the reason lists the ids', () => {
  const result = prepare(
    '| tool_use a |\n| I loaded the guidance. |\n| tool_result b |\nRow 1',
  );
  assert.deepEqual(result.leaks, [
    { id: 'guidance-narration', count: 1, sample: 'I loaded the guidance' },
    { id: 'tool-marker', count: 2, sample: 'tool_use' },
  ]);
  assert.equal(
    result.reason,
    'narration remains after sanitizing: guidance-narration, tool-marker',
  );
});

test('no secret reaches any field of the result, a leak sample included: the scan reads the redacted text', () => {
  const literal = 'handed-out-secret-1';
  const canary = newCanary();
  const input = createJudgeInput({ literals: [literal] });
  for (const secret of [KEY, canary, literal]) {
    const result = input.prepare(`| blocked ${secret} skill |\nRow 1`, {
      skill: SKILL,
    });
    assert.deepEqual(collectLeakIds(result.leaks), ['skill-word'], secret);
    assert.equal(JSON.stringify(result).includes(secret), false, secret);
  }
});

test('prepare uses its settings for the rules and for the scan', () => {
  const custom = createJudgeInput({
    settings: {
      plugin: 'acme',
      scratchPrefix: 'my.box',
      agentPatterns: ['agent-[a-z]+'],
    },
  });
  assert.equal(
    custom.prepare(
      'Use acme:foo-bar now. Ask agent-smith. See /tmp/my.box-subject-1/x here.\nRow 1',
      {
        skill: '',
      },
    ).text,
    'Use foo bar now. Ask agent smith. See x here.\nRow 1',
  );
  assert.deepEqual(
    collectLeakIds(
      scanLeaks('acme:foo and agent-smith and /my.box-subject-1', {
        settings: custom.settings,
      }),
    ),
    ['agent-id', 'harness-path', 'plugin-name'],
  );
  // The default scan does not know those names.
  assert.deepEqual(scan('acme:foo and agent-smith and /my.box-subject-1'), []);
});
