// SPDX-License-Identifier: Apache-2.0
// Tests for the sanitizer (scripts/bench/lib/sanitize.js): three lists (NAME_WORDS, SKILL_WORDS with CUE_WORDS,
// PATH_PATTERNS) and the request guard. Pure functions on committed fixtures: sanitize.rules.json (one hit and one
// near-miss per name and path entry), skill-narration.cases.json (the sentences the narration lists must drop, must keep,
// drop at a known cost, or miss) and sanitize.answers.json.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const sanitizer = require('../../../scripts/bench/lib/sanitize');
const { sha256 } = require('../../../scripts/bench/lib/provenance');
const helpers = require('./helpers');
const { timeInWorker } = require('./worker-timer');

const SKILL = 'e2e-test-strategy';
const RULE_CASES = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'sanitize.rules.json'),
);
const ANSWERS = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'sanitize.answers.json'),
);
const CASES = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'skill-narration.cases.json'),
);
const sanitize = (text, options = {}) =>
  sanitizer.sanitizeAnswer(text, { skill: SKILL, ...options });
const clean = (text, skill = SKILL, request = '') =>
  sanitize(text, { skill, request }).text;
// A sentence with no end mark (a heading, "Skill loaded") needs its own line, or the next sentence joins it.
const withRest = (sentence) =>
  `${sentence}${/[.!?]$/.test(sentence) ? ' ' : '\n'}${CASES.rest}`;
const droppedSentences = [
  ...Object.values(CASES.drop).flat(),
  ...CASES.drop_shape,
  ...CASES.drop_named,
];

// Pinned: the hash of the sanitizer's spec (the three lists, the guard, the normalization, the settings and the caps).
// Any edit to one changes it; then bump SANITIZER_VERSION too. judge-input.js folds the same spec into the one
// provenance hash, so there is no second sanitizer hash to disagree with it.
const PINNED_SPEC_HASH =
  '890706e6374870bbe1c70a6c22091db8ef024f4be09255751ee290e110be258e';
const hashSpec = (overrides) =>
  sha256(sanitizer.createSanitizer(overrides).spec);

// ---- NAME_WORDS and PATH_PATTERNS: one hit and one near-miss per entry
for (const ruleCase of RULE_CASES) {
  test(`${ruleCase.list} ${ruleCase.rule}: rewrites or removes its match, and leaves the near-miss alone`, () => {
    for (const hitText of [].concat(ruleCase.hit)) {
      const hit = sanitize(hitText);
      assert.equal(hit.text, ruleCase.out, hitText);
      assert.ok(
        hit.counts[ruleCase.rule] > 0,
        `${ruleCase.rule} did not fire on ${hitText}: ${JSON.stringify(hit.counts)}`,
      );
    }
    for (const keepText of [].concat(ruleCase.keep)) {
      const keep = sanitize(keepText);
      assert.deepEqual([keep.text, keep.changes], [keepText, 0], keepText);
    }
  });
}

test('every name and path entry has a case, and the lists are frozen data', () => {
  assert.deepEqual(
    RULE_CASES.map((ruleCase) => ruleCase.rule).sort(),
    [...sanitizer.NAME_WORDS, ...sanitizer.PATH_PATTERNS]
      .map((entry) => entry[0])
      .sort(),
  );
  for (const list of [
    sanitizer.NAME_WORDS,
    sanitizer.SKILL_WORDS,
    sanitizer.CUE_WORDS,
    sanitizer.PATH_PATTERNS,
    sanitizer.DEFAULT_SETTINGS,
  ])
    assert.ok(Object.isFrozen(list));
});

for (const answerCase of ANSWERS.cases) {
  test(`answer, ${answerCase.name}`, () => {
    const result = sanitize(answerCase.stored, { skill: ANSWERS.skill });
    assert.equal(result.text, answerCase.sanitized);
    assert.ok(result.removed_share < 0.25, String(result.removed_share));
  });
}

// ---- SKILL_WORDS with CUE_WORDS: a sentence with a word from both is dropped
for (const sentence of droppedSentences) {
  test(`narration is dropped: ${sentence}`, () => {
    const result = sanitize(withRest(sentence));
    assert.equal(result.text, CASES.rest);
    assert.equal(result.counts['skill-narration'], 1);
  });
}

for (const sentence of [...CASES.keep, ...CASES.keep_risky]) {
  test(`ordinary prose is kept: ${sentence}`, () => {
    const result = sanitize(sentence);
    assert.deepEqual(
      [result.text, result.changes, result.removed_chars],
      [sentence, 0, 0],
    );
  });
}

// Ordinary prose with a skill word and a cue word cannot be told from the arm's narration. Each costs one sentence.
for (const sentence of CASES.drop_cost) {
  test(`accepted cost, dropped though it is ordinary prose: ${sentence}`, () =>
    assert.equal(sanitize(withRest(sentence)).text, CASES.rest));
}

// Narration-like sentences that an earlier distance rule kept because the cue was too far from the noun. The lists have
// no distance, so they drop them.
for (const sentence of CASES.drop_window) {
  test(`dropped though the cue is far from the skill word: ${sentence}`, () =>
    assert.equal(sanitize(withRest(sentence)).text, CASES.rest));
}

// What the lists cannot see. A known gap, not a feature: if a list grows to catch one of these, move it to `drop`.
for (const sentence of CASES.miss) {
  test(`known gap, kept though it may be narration: ${sentence}`, () =>
    assert.equal(sanitize(withRest(sentence)).text, withRest(sentence)));
}

test('every SKILL_WORDS and CUE_WORDS entry matches a sentence the cases drop', () => {
  const sentences = droppedSentences.join('\n');
  const tokenFree = (source) => !/__[A-Z]+__/.test(source);
  for (const [name, list] of [
    ['SKILL_WORDS', sanitizer.SKILL_WORDS],
    ['CUE_WORDS', sanitizer.CUE_WORDS],
  ])
    for (const source of list.filter(tokenFree))
      assert.ok(new RegExp(source, 'i').test(sentences), `${name}: ${source}`);
  // The entries that carry the plugin name or the skill's own name are exercised by the named cases.
  assert.ok(
    sanitize('I will load bench:other-thing now.').counts['skill-narration'],
  );
  assert.ok(
    sanitize('I used e2e-test-strategy to rank flows.').counts[
      'skill-narration'
    ],
  );
});

test('"Rank by skill level." is kept, and the human-resources nouns do not count as the skill word', () => {
  for (const text of [
    'Rank by skill level.',
    'Skill matrix planning helps.',
    'A skill-based approach was used.',
  ])
    assert.deepEqual([clean(text), sanitize(text).changes], [text, 0]);
  assert.equal(
    clean('Rank by skill level. I loaded the skill.'),
    'Rank by skill level.',
  );
});

test('narration in fenced code and in table rows is left alone', () => {
  const fenced = '```\nI loaded the skill.\n```';
  assert.equal(clean(fenced), fenced);
  const row = '| Login | The skill tool is not available |';
  assert.equal(clean(`${row}\nRow 1`), `${row}\nRow 1`);
  assert.equal(
    clean("```\nI'll load the Skill tool\n```"),
    "```\nI'll load the Skill tool\n```",
  );
});

test('a sentence ends after its closing marks, so a bold title before narration is kept', () => {
  assert.equal(
    clean(
      '- **PAY-218 is too big.** The skill says to split it. Plan the split.',
    ),
    '- **PAY-218 is too big.** Plan the split.',
  );
  assert.equal(
    clean('He wrote "No skill was found." Then he went on.'),
    'Then he went on.',
  );
  assert.equal(clean('Done (it loaded the skill.) Next step.'), 'Next step.');
});

test('a partly dropped line keeps its indent and its other sentences, and a dropped line leaves no blank line', () => {
  assert.equal(
    clean('  - Step one. I loaded the skill. Step two.', ''),
    '  - Step one. Step two.',
  );
  assert.equal(clean('Row 1.\nI loaded the skill.\nRow 2.'), 'Row 1.\nRow 2.');
  assert.equal(
    clean('Available skills:\n- a: x'),
    '- a: x',
    'a list header is one sentence; its entries are plain text',
  );
});

// ---- the request guard
test('request guard: a request that quotes "load the skill" does not cut it from the answer', () => {
  const request = 'Please load the skill and explain what it says.';
  assert.equal(
    clean('I will load the skill now. Row 1.', SKILL, request),
    'I will load the skill now. Row 1.',
  );
  assert.equal(
    clean('I loaded the skill. Row 1.', SKILL, request),
    'Row 1.',
    'text the request does not hold is still narration',
  );
  assert.equal(
    sanitize('I will load the skill now.', { request }).counts[
      'skill-narration'
    ],
    undefined,
  );
});

test('request guard: a path, a name and an agent id the request holds are kept', () => {
  const request =
    'See skills/foo/SKILL.md and scripts/bench/run.js. Use e2e-test-strategy on the bench:foo plugin. Ask k-developer.';
  const answer =
    'I read skills/foo/SKILL.md and scripts/bench/run.js. Use e2e-test-strategy on the bench:foo plugin. Ask k-developer.';
  assert.equal(
    clean(answer, SKILL, request).replace(/^I read/, 'I read'),
    answer,
  );
  assert.equal(clean(answer, 'foo', request), answer);
  assert.equal(
    clean(answer, SKILL, ''),
    'I read skills/foo/SKILL.md and Use e2e test strategy on the foo plugin. Ask developer.',
    'no request, no guard',
  );
});

test("request guard: a request-cited skills/foo/SKILL.md stays, and another skill's folder is never touched", () => {
  const request = 'Review skills/foo/SKILL.md for me.';
  assert.equal(
    clean('Notes on skills/foo/SKILL.md are below. Row 1.', 'foo', request),
    'Notes on skills/foo/SKILL.md are below. Row 1.',
  );
  assert.equal(
    clean('Edit skills/foo/notes.md then.', 'foo', ''),
    'Edit then.',
    'the skill under test: removed without a request',
  );
  assert.equal(
    clean(
      'Edit skills/foo/notes.md then.',
      'foo',
      'Edit skills/foo/notes.md then.',
    ),
    'Edit skills/foo/notes.md then.',
  );
  for (const text of [
    'Edit skills/bar/notes.md then.',
    'Read skills/bar/SKILL.md then.',
    'Open skills/foobar/SKILL.md now.',
  ])
    assert.equal(clean(text, 'foo', ''), text, text);
});

test('request guard: a request is matched as normalized text, and a bad request is refused', () => {
  assert.equal(
    clean('I will load\u200b the skill now.', SKILL, 'load the skill'),
    'I will load the skill now.',
  );
  assert.throws(
    () => sanitizer.sanitizeAnswer('x', { skill: SKILL, request: 5 }),
    /skill and request must be strings/,
  );
});

test('removed text is counted: characters, share of the answer, and by rule', () => {
  const result = sanitize(
    'I loaded the skill. Row 1 is fine.\n  \nThere is no such skill.\nOpen /tmp/bench-subject-q1/with/a.txt now',
  );
  assert.equal(result.text, 'Row 1 is fine.\n  \nOpen a.txt now');
  const dropped = 'Iloadedtheskill.'.length + 'Thereisnosuchskill.'.length;
  assert.deepEqual(result.removed_by_rule, {
    'skill-narration': dropped,
    'scratch-path': '/tmp/bench-subject-q1/with/'.length,
  });
  assert.equal(
    result.removed_chars,
    dropped + '/tmp/bench-subject-q1/with/'.length,
  );
  assert.equal(result.removed_share, result.removed_chars / result.chars_in);
  assert.deepEqual(
    ['', '  \n '].map((text) => sanitize(text).removed_share),
    [0, 0],
    'an empty input removes nothing',
  );
  assert.equal(
    sanitize('Use bench:other-thing here', { skill: '' }).removed_chars,
    0,
    'a rewrite keeps its text and is not a removal',
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
    clean('Run Git status first. Git is a VCS.', 'git'),
    'Run Git status first. Git is a VCS.',
  );
  assert.equal(
    clean(
      'The verification skill helps. Use bench:verification now.',
      'verification',
    ),
    'The approach helps. Use verification now.',
  );
  assert.equal(
    clean('Use E2E-Test-Strategy and e2e-test-strategy.'),
    'Use E2E Test Strategy and e2e test strategy.',
  );
  assert.equal(
    clean('Use e2e_test_strategy here.'),
    'Use e2e test strategy here.',
  );
});

test("a skill named like one of Claude Code's own skills needs no alias: its bench: name is neutralized like any other", () => {
  assert.equal(
    clean(
      'Step 1: use code-review and bench:code-review to check the diff.',
      'code-review',
    ),
    'Step 1: use code review and code review to check the diff.',
  );
  assert.equal(
    clean('see code-review-under-test', 'code-review'),
    'see code-review-under-test',
  );
});

test('without a skill, only the skill-independent entries run', () => {
  assert.equal(
    clean('use e2e-test-strategy here', ''),
    'use e2e-test-strategy here',
  );
  assert.equal(
    clean('Ask k-developer. There is no such skill.', ''),
    'Ask developer.',
  );
  assert.equal(
    clean('Read skills/other/notes.md first.', ''),
    'Read skills/other/notes.md first.',
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
  ['NFC', 'caf\u0065\u0301', 'caf\u00e9'],
];
for (const [name, input, expected] of NORMALIZE_CASES)
  test(`normalization: ${name}`, () => assert.equal(clean(input), expected));

test('removed characters are counted apart from rule matches', () => {
  const result = sanitize('a\u200bb');
  assert.deepEqual(
    [result.text, result.changes, result.counts],
    ['ab', 0, { normalize_chars: 1 }],
  );
});

test('a name inside a fenced code block is neutralized', () => {
  assert.equal(
    clean('```\nrun bench:other-tool\n```'),
    '```\nrun other tool\n```',
  );
});

test('fences follow CommonMark: a longer fence holds a shorter one, a fence closes only with its own character', () => {
  assert.equal(
    clean('Steps:\n````md\n```js\nx\n````\nI loaded the skill first.\nRow 1'),
    'Steps:\n````md\n```js\nx\n````\nRow 1',
  );
  const fiveTicks = '`````\nx\n````\nI loaded the skill.\n`````\nRow 1';
  assert.equal(clean(fiveTicks), fiveTicks);
  assert.deepEqual(sanitizer.fenceMap('~~~\ncode\n```\nRow 1'.split('\n')), {
    fenced: [true, true, true, true],
    open: true,
  });
  assert.deepEqual(sanitizer.fenceMap(['```x```', 'I loaded the skill.']), {
    fenced: [false, false],
    open: false,
  });
  assert.equal(clean('```x```\nI loaded the skill.\nRow 1'), '```x```\nRow 1');
});

test('findNarration returns the sentences the sanitizer would drop, and takes the request', () => {
  const text =
    'A good tester needs skill. No skill could be found. Run it twice.\n```\nNo skill could be found.\n```';
  assert.deepEqual(sanitizer.findNarration(text), ['No skill could be found.']);
  assert.deepEqual(
    sanitizer.findNarration(text, { request: 'No skill could be found.' }),
    [],
  );
  assert.deepEqual(sanitizer.findNarration(''), []);
});

test('deterministic and pure: same input, same result; the input and the module are untouched', () => {
  const input = Object.freeze(
    ANSWERS.cases.map((answerCase) => answerCase.stored).join('\n---\n'),
  );
  const first = sanitize(input);
  assert.deepEqual(sanitize(input), first);
  sanitizer.sanitizeAnswer('bench:other and other', { skill: 'other' });
  assert.deepEqual(
    sanitize(input),
    first,
    'a call for another skill leaves nothing behind',
  );
});

test('idempotent: sanitizing sanitized text changes nothing', () => {
  for (const text of [
    ...RULE_CASES.flatMap((ruleCase) => [].concat(ruleCase.hit)),
    ...ANSWERS.cases.map((answerCase) => answerCase.stored),
    ...droppedSentences,
    '',
    'plain text',
  ]) {
    const once = clean(text);
    assert.equal(clean(once), once, JSON.stringify(text));
  }
});

test('input over the cap is dropped whole, not cut and passed on; null and undefined are empty, any other non-string is refused', () => {
  const result = sanitize('a'.repeat(sanitizer.MAX_INPUT_CHARS + 1));
  assert.deepEqual(
    [result.text, result.too_long, result.changes],
    ['', true, 0],
  );
  assert.equal(sanitize('a'.repeat(sanitizer.MAX_INPUT_CHARS)).too_long, false);
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
    /skill and request must be strings/,
  );
});

// A pattern that backtracks from every start position grows with the square of the length. Each input below repeats one
// shape that would trigger it; the sanitizer runs in a worker, so a slow pattern fails the test instead of hanging the run.
const SANITIZE_JS = require.resolve('../../../scripts/bench/lib/sanitize');
const sanitizeInWorker = (textSource, { scanned = false } = {}) =>
  timeInWorker(`
const sanitizer = require(${JSON.stringify(SANITIZE_JS)});
const text = ${textSource};
const result = sanitizer.sanitizeAnswer(text, { skill: ${JSON.stringify(SKILL)}, request: 'the skill' });
if (${scanned} && result.too_long) throw new Error('the input was dropped as too long, so nothing was scanned');`);
for (const [name, unit] of [
  ['one long hyphenated token', 'a-'],
  ['one long path', 'a/'],
  ['dots', 'a.'],
  ['a run of marks', '*_'],
  ['sentence ends followed by marks', '.**) '],
  ['a period then a run of marks', '.*_*_`'],
  ['repeats of a skill word', 'the skill '],
  ['a skill word then a cue', 'skill loaded '],
  ['a cue then a skill word', 'per skill '],
  ['skill words with no cue', 'skill skills '],
  ['the skill name', 'e2e-test-strategy '],
  ['a bench: name', 'bench:a '],
  ['a scratch path start', '/tmp/bench-subject-'],
  ['a skills folder start', 'skills/e2e-test-strategy/'],
]) {
  test(`cost stays linear: ${name}`, () =>
    sanitizeInWorker(`${JSON.stringify(unit)}.repeat(100000)`));
}
// Each input is built to exactly MAX_INPUT_CHARS, so it is scanned and not dropped as too long.
for (const unit of [
  'Skill(',
  'Skill( ',
  'skill(',
  'Skill(' + ' '.repeat(999),
  'skill loaded ',
  'a\n```\n',
]) {
  test(`cost stays linear at the true cap: ${JSON.stringify(unit.slice(0, 8))}`, () =>
    sanitizeInWorker(
      `${JSON.stringify(unit)}.repeat(Math.ceil(sanitizer.MAX_INPUT_CHARS / ${unit.length})).slice(0, sanitizer.MAX_INPUT_CHARS)`,
      { scanned: true },
    ));
}

test('version and spec: version 8, stable, pinned, and free of per-run values', () => {
  assert.equal(sanitizer.SANITIZER_VERSION, 8);
  assert.equal(hashSpec(), PINNED_SPEC_HASH);
  assert.match(hashSpec(), /^[0-9a-f]{64}$/);
  const result = sanitize('x', { skill: 'code-review' });
  assert.equal(result.sanitizer_version, sanitizer.SANITIZER_VERSION);
  assert.equal(
    result.rules_sha256,
    undefined,
    'the one provenance hash is built in judge-input.js',
  );
  assert.equal(hashSpec(), hashSpec(), 'a skill does not change the spec');
  assert.equal(sanitizer.SKILL_NARRATION, undefined);
  assert.equal(sanitizer.RULES, undefined);
});

test('the spec holds the three lists, the guard, the normalization, the caps and the settings, and each part changes the hash', () => {
  const { spec } = sanitizer.createSanitizer();
  assert.deepEqual(spec.name_words, sanitizer.NAME_WORDS);
  assert.deepEqual(spec.skill_words, sanitizer.SKILL_WORDS);
  assert.deepEqual(spec.cue_words, sanitizer.CUE_WORDS);
  assert.deepEqual(spec.path_patterns, sanitizer.PATH_PATTERNS);
  assert.equal(spec.max_input_chars, sanitizer.MAX_INPUT_CHARS);
  assert.equal(spec.sanitizer_version, sanitizer.SANITIZER_VERSION);
  assert.match(spec.request_guard, /request/);
  const base = sha256(spec);
  const edits = [
    (copy) => copy.name_words.reverse(),
    (copy) => (copy.name_words[0][2] += 'x'),
    (copy) => copy.skill_words.push('x'),
    (copy) => (copy.cue_words[0] += 'x'),
    (copy) => copy.cue_words.reverse(),
    (copy) => (copy.path_patterns[1][1] += 'x'),
    (copy) => (copy.request_guard += 'x'),
    (copy) => (copy.max_input_chars += 1),
    (copy) => (copy.sanitizer_version += 1),
    (copy) => (copy.wrap += 'x'),
    (copy) => (copy.normalize.form = 'NFKC'),
    (copy) => (copy.code_patterns[0] += 'x'),
    (copy) => (copy.settings.plugin += 'x'),
  ];
  for (const [i, applyEdit] of edits.entries()) {
    const copy = JSON.parse(JSON.stringify(spec));
    applyEdit(copy);
    assert.notEqual(sha256(copy), base, `edit ${i} did not change the hash`);
  }
});

test('settings are configurable and part of the hash; bad settings are refused', () => {
  const variants = [
    { plugin: 'other' },
    { scratchPrefix: 'run' },
    { agentPatterns: ['acme-[a-z]+'] },
  ];
  assert.equal(new Set([PINNED_SPEC_HASH, ...variants.map(hashSpec)]).size, 4);
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
  for (const invalid of [
    { plugin: 'a b' },
    { plugin: '' },
    { scratchPrefix: '../x' },
    { agentPatterns: 'k-' },
    { agentPatterns: ['('] },
    { agentPatterns: [''] },
  ])
    assert.throws(
      () => sanitizer.createSanitizer(invalid),
      TypeError,
      JSON.stringify(invalid),
    );
});

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

test('a skill name or scratch prefix with a regex character is matched as written', () => {
  assert.equal(
    sanitize('the a.b-c skill and axb-c', { skill: 'a.b-c' }).text,
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
