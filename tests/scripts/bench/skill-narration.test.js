// SPDX-License-Identifier: Apache-2.0
// Tests for the missing-or-unused-skill narration rule (scripts/bench/lib/skill-narration.js) and for its place in the
// sanitizer (scripts/bench/lib/sanitize.js). Pure functions on tests/fixtures/bench/skill-narration.cases.json: the
// sentences the rule must drop, the ordinary prose it must keep, and the few ordinary sentences it drops too.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const narration = require('../../../scripts/bench/lib/skill-narration');
const sanitizer = require('../../../scripts/bench/lib/sanitize');
const helpers = require('./helpers');
const { timeInWorker } = require('./worker-timer');

const { isSkillAbsenceNarration, findSkillAbsenceNarration, tokenize } =
  narration;
const CASES = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'skill-narration.cases.json'),
);
const RULE_ID = 'missing-skill-narration';
const sanitize = (text, skill = CASES.skill) =>
  sanitizer.sanitizeAnswer(text, { skill });
const droppedWithRest = (sentence) =>
  sanitize(`${sentence} ${CASES.rest}`).text === CASES.rest;
const dropSentences = Object.values(CASES.drop).flat();

test('the case tables are the size the design measured', () => {
  assert.equal(dropSentences.length, 54);
  assert.equal(CASES.drop_shape.length, 2);
  assert.equal(CASES.drop_named.length, 5);
  assert.ok(CASES.keep.length + CASES.keep_risky.length >= 31);
});

for (const sentence of dropSentences) {
  test(`dropped by the clause-level rule, and by the sanitizer: ${sentence}`, () => {
    assert.equal(isSkillAbsenceNarration(sentence), true);
    assert.ok(droppedWithRest(sentence));
  });
}

for (const sentence of CASES.drop_shape) {
  test(`dropped by a fixed shape, not by the clause-level rule: ${sentence}`, () => {
    assert.equal(isSkillAbsenceNarration(sentence), false);
    assert.ok(droppedWithRest(sentence));
    assert.equal(
      sanitize(`${sentence} ${CASES.rest}`).counts['bare-skill-reference'],
      1,
    );
  });
}

// A named skill is matched before the name rules rewrite it: after the rewrite "The e2e-test-strategy skill could not be
// loaded." reads "The approach could not be loaded." and has no noun left to match.
for (const sentence of CASES.drop_named) {
  test(`a named skill is seen with its noun, before the name rules: ${sentence}`, () => {
    assert.equal(isSkillAbsenceNarration(sentence), true);
    const result = sanitize(`${sentence} ${CASES.rest}`);
    assert.equal(result.text, CASES.rest);
    assert.equal(result.counts[RULE_ID], 1);
    assert.equal(result.counts['skill-name-with-label'], undefined);
  });
}

for (const sentence of [...CASES.keep, ...CASES.keep_risky]) {
  test(`ordinary prose is kept: ${sentence}`, () => {
    assert.equal(isSkillAbsenceNarration(sentence), false);
    const result = sanitize(sentence);
    assert.deepEqual(
      [result.text, result.changes, result.removed_chars],
      [sentence, 0, 0],
    );
  });
}

// Ordinary prose the rule drops too. A first-person sentence about skills cannot be told from the arm's narration, and
// "No soft skill is found in the old rubric." cannot be told from "No skill was found." The cost is one sentence each.
for (const sentence of CASES.drop_accepted) {
  test(`accepted cost, dropped though it is ordinary prose: ${sentence}`, () => {
    assert.ok(droppedWithRest(sentence));
  });
}

test('the rule is in the sentence phase, before the name rules, and drops by function', () => {
  const rule = sanitizer.RULES.find((entry) => entry.id === RULE_ID);
  assert.deepEqual(
    [rule.phase, rule.action, rule.matcher, rule.source],
    ['sentence', 'drop-sentence', 'skill-absence', ''],
  );
  const phaseOf = (id) =>
    sanitizer.PHASES.indexOf(
      sanitizer.RULES.find((entry) => entry.id === id).phase,
    );
  assert.ok(phaseOf(RULE_ID) < phaseOf('skill-name-with-label'));
  assert.ok(phaseOf(RULE_ID) < phaseOf('bare-skill-reference'));
});

test('removed text is counted under the rule that dropped it', () => {
  const result = sanitize(`No skill could be found. ${CASES.rest}`);
  assert.deepEqual(result.removed_by_rule, {
    [RULE_ID]: 'Noskillcouldbefound.'.length,
  });
  assert.equal(result.counts[RULE_ID], 1);
});

test('a comment right after dropped missing-skill narration goes with it', () => {
  assert.equal(
    sanitize('No skill could be found. That cannot be applied here. Row 1.')
      .text,
    'Row 1.',
  );
});

test('narration inside fenced code and table rows is left to the leak scan', () => {
  const fenced = '```\nNo skill could be found.\n```';
  assert.equal(sanitize(fenced).text, fenced);
  const row = '| Login | No skill could be found |';
  assert.equal(sanitize(row).text, row);
});

test('with no skill under test the rule still runs: it needs no name', () => {
  assert.equal(sanitize('I could not find a skill. Row 1.', '').text, 'Row 1.');
});

// [sentence, dropped, why]. Windows are counted in content words: articles, auxiliary verbs and negations do not count.
const WINDOW_CASES = [
  // C: an absence word within 2 words of the noun.
  ['The skill was missing.', true, 'missing right after the noun'],
  [
    'Missing skills hurt a team more than slow tools.',
    false,
    'missing counts after the noun only',
  ],
  ['The skill was unavailable.', true, 'unavailable next to the noun'],
  [
    'The skill, a rare and old one, was unavailable.',
    false,
    'unavailable is 4 words away',
  ],
  [
    'This unavailable skill hurts.',
    true,
    'unavailable counts before the noun too',
  ],
  // A: a negation within 4 words and a lookup word within 2.
  ['No two three four skill found.', true, 'negation is the 4th word before'],
  [
    'No one two three four skill found.',
    false,
    'negation is the 5th word before',
  ],
  ['No skill really applied.', true, 'lookup word is the 2nd word after'],
  [
    'No skill really truly applied.',
    false,
    'lookup word is the 3rd word after',
  ],
  ['Skill not found.', true, 'negation does not count as a word'],
  [
    'The skill could not be taught in a day.',
    false,
    'a negation and no lookup word',
  ],
  // B: a narrator within 4 words, and a negation or a lookup verb within 3.
  ['I tried a skill.', true, 'narrator and lookup verb'],
  [
    'I wrote the plan after the review, then used a skill.',
    false,
    'narrator is 5 words away',
  ],
  ['I wrote it with no skill.', true, 'narrator is the 4th word before'],
  ['I wrote it up with no skill.', false, 'narrator is the 5th word before'],
  ['She tried a skill.', false, 'a lookup verb without a narrator'],
  ['Let me try a skill.', true, '"let me" is a narrator'],
  ['Show me a skill to try.', false, 'a bare "me" is not a narrator'],
  ['My edits had no effect on skill.', false, 'a bare "my" is not a narrator'],
  // A clause that opens with a seeking gerund is narration when the noun follows within 6 words.
  [
    'Searching the old notes for a skill: none.',
    true,
    'noun is the 7th word, in the window',
  ],
  [
    'Searching the old team notes for a skill: none.',
    false,
    'noun is the 8th word, outside the window',
  ],
  // A clause ends at a semicolon.
  ['Skills were listed, none applied.', true, 'one clause'],
  [
    'Skills were listed; none applied.',
    false,
    'the negation is in the next clause',
  ],
  // Words that are another noun.
  ['There is no skillset to match.', false, '"skillset" is another word'],
  ['No skill-based plan was found.', false, '"skill-based" is another word'],
  [
    'No skill matrix was found.',
    false,
    'a skill matrix is a human-resources noun',
  ],
  ['No skills inventory was found.', false, 'a skills inventory too'],
  ['No skill levels were found.', false, 'and skill levels'],
  // No noun, or no sentence.
  ['No tool could be found.', false, 'no noun'],
  ['', false, 'empty'],
];
for (const [sentence, expected, why] of WINDOW_CASES) {
  test(`window: ${JSON.stringify(sentence)} is ${expected ? 'dropped' : 'kept'} (${why})`, () => {
    assert.equal(isSkillAbsenceNarration(sentence), expected);
  });
}

test('window: no cue is read past 12 words, however many of them are skipped', () => {
  const skipped = (count) => `No ${'the '.repeat(count)}skill found.`;
  assert.equal(isSkillAbsenceNarration(skipped(11)), true);
  assert.equal(isSkillAbsenceNarration(skipped(12)), false);
  const after = (count) => `No skill ${'the '.repeat(count)}found.`;
  assert.equal(isSkillAbsenceNarration(after(10)), true);
  assert.equal(isSkillAbsenceNarration(after(12)), false);
});

test('tokenizer: words, inner apostrophes and hyphens, "let me", curly quotes, markup, semicolons', () => {
  assert.deepEqual(tokenize('I couldn\u2019t find a skill-based plan; ok'), [
    'i',
    "couldn't",
    'find',
    'a',
    'skill-based',
    'plan',
    ';',
    'ok',
  ]);
  assert.deepEqual(
    tokenize('Let me check. Let\u2019s go. Show me the skill.'),
    ['let me', 'check', "let's", 'go', 'show', 'me', 'the', 'skill'],
  );
  assert.deepEqual(tokenize('**No skill** was `found`'), [
    'no',
    'skill',
    'was',
    'found',
  ]);
  assert.deepEqual(tokenize('the e2e-test-strategy skill'), [
    'the',
    'e2e-test-strategy',
    'skill',
  ]);
  assert.deepEqual(tokenize(''), []);
});

test('the case does not matter', () => {
  assert.equal(isSkillAbsenceNarration('NO SKILL FOUND.'), true);
  assert.equal(isSkillAbsenceNarration('no skill found.'), true);
  assert.equal(isSkillAbsenceNarration('I COULDN\u2019T FIND A SKILL.'), true);
});

test('findSkillAbsenceNarration: the narration sentences of a text, split as the sanitizer splits a line', () => {
  const text = [
    'A good tester needs skill. No skill could be found. Run it twice.',
    '  I looked for a matching skill and found none.',
    '```',
    'not code-aware: the scan skips fences itself',
    '```',
    'Ordinary line.',
  ].join('\n');
  assert.deepEqual(findSkillAbsenceNarration(text), [
    'No skill could be found.',
    'I looked for a matching skill and found none.',
  ]);
  assert.deepEqual(findSkillAbsenceNarration(''), []);
  assert.deepEqual(findSkillAbsenceNarration(null), []);
});

test('the spec carries every word list and window, frozen, and the sanitizer hashes it', () => {
  const spec = narration.SKILL_CLASS_SPEC;
  assert.ok(Object.isFrozen(spec));
  assert.deepEqual(Object.keys(spec).sort(), [
    'domain_next',
    'token',
    'window',
    'words',
  ]);
  assert.deepEqual(sanitizer.createSanitizer().spec.skill_class, spec);
  assert.equal(spec.domain_next, narration.SKILL_DOMAIN_NEXT);
  assert.ok(
    sanitizer.SKILLWORD.includes(narration.SKILL_DOMAIN_NEXT),
    'the sanitizer and the rule use one list of human-resources words',
  );
});

// Cost is linear in the length of the text. Each input is built to exactly the cap, so it is scanned and not dropped
// as too long. Each check runs in a worker, so a slow rule fails the test instead of hanging the run.
const NARRATION_JS =
  require.resolve('../../../scripts/bench/lib/skill-narration');
const SANITIZE_JS = require.resolve('../../../scripts/bench/lib/sanitize');
const atCap = (unit) =>
  unit
    .repeat(Math.ceil(sanitizer.MAX_INPUT_CHARS / unit.length))
    .slice(0, sanitizer.MAX_INPUT_CHARS);
for (const [name, unit] of [
  ['skill, no cue', 'skill '],
  ['skill then a negation', 'skill no '],
  ['an article then skill', 'the skill '],
  ['a negation then skill', 'no skill '],
  ['a clause end after each skill', 'skill; '],
  ['a line end after each skill', 'skill\n'],
  ['a narrator then skill', 'I skill '],
  ['one long hyphenated token', 'a-'],
  ['one long word', 'a'],
]) {
  test(`cost stays linear at the true cap: ${name}`, async () => {
    assert.equal(atCap(unit).length, sanitizer.MAX_INPUT_CHARS);
    for (const call of [
      'narration.isSkillAbsenceNarration(text)',
      'narration.findSkillAbsenceNarration(text)',
      "if (sanitizer.sanitizeAnswer(text, { skill: '' }).too_long) throw new Error('dropped as too long')",
    ])
      await timeInWorker(`
const narration = require(${JSON.stringify(NARRATION_JS)});
const sanitizer = require(${JSON.stringify(SANITIZE_JS)});
const unit = ${JSON.stringify(unit)};
const text = unit.repeat(Math.ceil(sanitizer.MAX_INPUT_CHARS / unit.length)).slice(0, sanitizer.MAX_INPUT_CHARS);
${call};`);
  });
}

// A ";" ends a clause, so a negation in one clause does not pair with "skill" in the next.
for (const sentence of [
  'I did not find a bug; this skill is useful.',
  'We did not run it; the skill checklist helps.',
])
  test(`a semicolon ends the clause: ${sentence}`, () =>
    assert.equal(isSkillAbsenceNarration(sentence), false));
