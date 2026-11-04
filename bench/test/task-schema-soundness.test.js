// SPDX-License-Identifier: Apache-2.0
/**
 * Soundness tests for the task schema (findings I-3, I-4 and I-6)
 *
 * Each test encodes a concrete attack: a task that satisfied the schema as first written without
 * being a task worth running. Every one of them was accepted by the schema before.
 *
 * Run: node --test bench/test/task-schema-soundness.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_TASK_WORDS,
  MAX_TASK_CHARS,
  MAX_RUBRIC_ITEM_CHARS,
  MAX_TARGET_SECTION_CHARS,
  validateTask,
  validateTaskSet,
} = require('../lib/task-schema');

function makeTask(overrides = {}) {
  return {
    id: 'planner-core-basic',
    skill: 'planner',
    kind: 'core',
    task: 'Break the checkout feature into ordered work items and note the risks.',
    rubric: [
      'Work items are ordered so that dependencies come first.',
      'Every work item names a concrete outcome.',
      'At least one risk is listed with a mitigation.',
    ],
    target_section: 'Ordering work',
    fixtures: ['README.md'],
    checks: [{ type: 'file_exists', path: 'PLAN.md' }],
    ...overrides,
  };
}

function withRubric(...rest) {
  return makeTask({ rubric: [...makeTask().rubric.slice(0, 2), ...rest] });
}

function timed(run) {
  const start = process.hrtime.bigint();
  const result = run();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

// --- I-3: the word cap does not bound size ----------------------------------------------------

test('I-3: one 2,000,000-character token is one word, and is now rejected on length', () => {
  const token = 'x'.repeat(2000000);
  assert.equal(token.split(/\s+/).length, 1);
  const { result, ms } = timed(() => validateTask(makeTask({ task: token })));
  assert.deepEqual(result, [`task: has 2000000 characters, the limit is ${MAX_TASK_CHARS}`]);
  assert.ok(ms < 1000, `took ${ms} ms`);
});

test('I-3: the character cap is exact for task, a rubric item and target_section', () => {
  assert.deepEqual(validateTask(makeTask({ task: 'x'.repeat(MAX_TASK_CHARS) })), []);
  assert.deepEqual(validateTask(makeTask({ task: 'x'.repeat(MAX_TASK_CHARS + 1) })), [
    `task: has ${MAX_TASK_CHARS + 1} characters, the limit is ${MAX_TASK_CHARS}`,
  ]);
  assert.deepEqual(validateTask(withRubric('y'.repeat(MAX_RUBRIC_ITEM_CHARS))), []);
  assert.deepEqual(validateTask(withRubric('y'.repeat(MAX_RUBRIC_ITEM_CHARS + 1))), [
    `rubric[2]: has ${MAX_RUBRIC_ITEM_CHARS + 1} characters, the limit is ${MAX_RUBRIC_ITEM_CHARS}`,
  ]);
  assert.deepEqual(validateTask(makeTask({ target_section: 'z'.repeat(MAX_TARGET_SECTION_CHARS) })), []);
  assert.deepEqual(validateTask(makeTask({ target_section: 'z'.repeat(MAX_TARGET_SECTION_CHARS + 1) })), [
    `target_section: has ${MAX_TARGET_SECTION_CHARS + 1} characters, the limit is ${MAX_TARGET_SECTION_CHARS}`,
  ]);
});

test('I-3: a 2,000,000-character rubric item and target_section are rejected without being scanned', () => {
  const big = 'q'.repeat(2000000);
  const { result, ms } = timed(() => validateTask(withRubric(big)));
  assert.deepEqual(result, [`rubric[2]: has 2000000 characters, the limit is ${MAX_RUBRIC_ITEM_CHARS}`]);
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.deepEqual(validateTask(makeTask({ target_section: big }), { skillText: '# Ordering work' }), [
    `target_section: has 2000000 characters, the limit is ${MAX_TARGET_SECTION_CHARS}`,
  ]);
});

test('I-3: a task under the word cap but over the character cap is rejected on characters', () => {
  const words = Array.from({ length: 150 }, (_, i) => `${'w'.repeat(30)}${i}`).join(' ');
  assert.ok(words.split(/\s+/).length <= MAX_TASK_WORDS);
  assert.deepEqual(validateTask(makeTask({ task: words })), [
    `task: has ${words.length} characters, the limit is ${MAX_TASK_CHARS}`,
  ]);
});

test('I-3: the limits reach every task of a set, and the word rule still applies below the character cap', () => {
  const big = makeTask({ id: 'planner-big', task: 'x'.repeat(MAX_TASK_CHARS + 1) });
  assert.deepEqual(validateTaskSet([makeTask(), big]), [
    `tasks[1]: task: has ${MAX_TASK_CHARS + 1} characters, the limit is ${MAX_TASK_CHARS}`,
  ]);
  const wordy = makeTask({ task: Array.from({ length: MAX_TASK_WORDS + 1 }, () => 'a').join(' ') });
  assert.deepEqual(validateTask(wordy), [`task: has ${MAX_TASK_WORDS + 1} words, the limit is ${MAX_TASK_WORDS}`]);
});

// --- I-4: blank and duplicate rubric items ----------------------------------------------------

test('I-4: an item repeated exactly is a duplicate of the first', () => {
  const task = makeTask({ rubric: ['Orders work first.', 'Names an outcome.', 'Orders work first.'] });
  assert.deepEqual(validateTask(task), ['rubric[2]: duplicates rubric[0]']);
});

test('I-4: case, spacing, compatibility forms and zero-width characters do not make an item distinct', () => {
  const base = 'Orders work first';
  const variants = [
    'ORDERS WORK FIRST',
    '  orders   work\tfirst  ',
    'Orders\nwork\nfirst',
    '\uff2f\uff52\uff44\uff45\uff52\uff53 work first', // full-width letters
    'Or\u200bders wo\u2060rk fi\ufeffrst', // zero-width space, word joiner, byte order mark
    'Orders\u00a0work\u00a0first', // no-break spaces
  ];
  for (const variant of variants) {
    const task = makeTask({ rubric: [base, 'Names an outcome.', variant] });
    assert.deepEqual(validateTask(task), ['rubric[2]: duplicates rubric[0]'], JSON.stringify(variant));
  }
});

test('I-4: every repeat is reported against the first occurrence', () => {
  const task = makeTask({ rubric: ['One check.', 'Another check.', 'one  check.', 'ONE CHECK.', 'Another check.'] });
  assert.deepEqual(validateTask(task), [
    'rubric[2]: duplicates rubric[0]',
    'rubric[3]: duplicates rubric[0]',
    'rubric[4]: duplicates rubric[1]',
  ]);
});

test('I-4: three copies of one item reach the minimum count but are not three criteria', () => {
  const task = makeTask({ rubric: ['Same criterion.', 'same criterion.', 'SAME  CRITERION.'] });
  assert.equal(task.rubric.length, 3);
  assert.deepEqual(validateTask(task), ['rubric[1]: duplicates rubric[0]', 'rubric[2]: duplicates rubric[0]']);
});

test('I-4: items that differ in wording are not duplicates', () => {
  const task = makeTask({ rubric: ['Orders work first.', 'Orders work last.', 'Orders the work first, then names risks.'] });
  assert.deepEqual(validateTask(task), []);
});

test('I-4: an item of invisible characters is blank, not only an empty or whitespace-only string', () => {
  for (const blank of ['', '   ', '\u200b', '\u200b\u200c\u200d', '\u00a0', '\ufeff', '\u2060', '\u0007', ' \u200b\t\u00a0 ', '\u3000']) {
    const problems = validateTask(withRubric(blank));
    assert.deepEqual(problems, ['rubric[2]: must be a non-empty string'], JSON.stringify(blank));
  }
});

test('I-4: the same blank test now covers task and target_section', () => {
  assert.deepEqual(validateTask(makeTask({ task: '\u200b\u200b' })), ['task: must be a non-empty string']);
  assert.deepEqual(validateTask(makeTask({ target_section: '\u2060' })), ['target_section: must be a non-empty string']);
});

test('I-4: two blank items are two blank problems, not a duplicate', () => {
  assert.deepEqual(validateTask(makeTask({ rubric: ['Real item.', '\u200b', ' '] })), [
    'rubric[1]: must be a non-empty string',
    'rubric[2]: must be a non-empty string',
  ]);
});

// --- I-6: target_section is resolved against the skill ----------------------------------------

const SKILL = [
  '---',
  'name: planner',
  '# a yaml comment, not a heading',
  '---',
  '',
  '# Planner',
  '',
  'Intro text that mentions Missing section in a sentence.',
  '',
  '## Ordering work',
  '',
  'Body.',
  '',
  '### `Risk` and **mitigation** ###',
  '',
  '```sh',
  '# Fenced comment',
  '## Fenced heading',
  '```',
  '',
  '~~~',
  '## Tilde fenced heading',
  '~~~',
  '',
  '## Last   section',
].join('\n');

function sectionProblems(target_section, skillText = SKILL) {
  return validateTask(makeTask({ target_section }), { skillText });
}

test('I-6: a target_section that is a heading of the skill resolves', () => {
  for (const section of ['Ordering work', 'ordering WORK', '  Ordering   work ', 'Planner', 'Risk and mitigation', 'Last section']) {
    assert.deepEqual(sectionProblems(section), [], section);
  }
});

test('I-6: a target_section the skill does not have is a problem', () => {
  for (const section of ['Ordering', 'Missing section', 'Fenced heading', 'Fenced comment', 'Tilde fenced heading', 'a yaml comment, not a heading', 'name: planner']) {
    assert.deepEqual(sectionProblems(section), [`target_section: ${JSON.stringify(section)} is not a heading of the skill text`], section);
  }
});

test('I-6: a heading must be a real heading line, not a word in prose or a hash inside text', () => {
  const skill = 'Ordering work is described here.\nSee # Ordering work in the docs.\n#Ordering work';
  assert.equal(sectionProblems('Ordering work', skill).length, 1);
  assert.deepEqual(sectionProblems('Ordering work', `${skill}\n#### Ordering work`), []);
});

test('I-6: a skill text with no headings, or none supplied as text, resolves nothing', () => {
  assert.equal(sectionProblems('Ordering work', 'no headings here').length, 1);
  assert.equal(sectionProblems('Ordering work', '').length, 1);
});

test('I-6: without a skill text the rule is skipped, as the quoting rule is', () => {
  assert.deepEqual(validateTask(makeTask({ target_section: 'Anything at all' })), []);
  assert.deepEqual(validateTask(makeTask({ target_section: 'Anything at all' }), {}), []);
  assert.deepEqual(validateTask(makeTask({ target_section: 'Anything at all' }), { skillText: 5 }), []);
});

test('I-6: a long unresolved section is truncated in the problem', () => {
  const problems = sectionProblems('s'.repeat(150));
  assert.equal(problems.length, 1);
  assert.ok(problems[0].length < 120, problems[0]);
});

test('I-6: a set resolves each task against its own skill text', () => {
  const reviewer = makeTask({ id: 'reviewer-a', skill: 'reviewer', target_section: 'Giving feedback' });
  const skillTexts = { planner: SKILL, reviewer: '# Reviewer\n\n## Giving feedback\n' };
  assert.deepEqual(validateTaskSet([makeTask(), reviewer], { skillTexts }), []);
  const wrong = makeTask({ id: 'reviewer-b', skill: 'reviewer', target_section: 'Ordering work' });
  assert.deepEqual(validateTaskSet([wrong], { skillTexts }), [
    'tasks[0]: target_section: "Ordering work" is not a heading of the skill text',
  ]);
});

test('I-6: a set that supplies skill texts but none for a task\'s skill cannot resolve it, so it is a problem', () => {
  // A misspelled skill key must not turn the rule off.
  const problems = validateTaskSet([makeTask()], { skillTexts: { planer: SKILL } });
  // Behavior change (I-5): the quoting rule has no text either, and that is reported alongside.
  assert.deepEqual(problems, [
    'tasks[0]: target_section: cannot be resolved because options.skillTexts holds no text for "planner"',
    'tasks[0]: rubric: the quoting rule cannot run because options.skillTexts holds no text for "planner"',
  ]);
});

test('I-6: a set that supplies no skill texts at all skips the rule', () => {
  assert.deepEqual(validateTaskSet([makeTask({ target_section: 'Anything' })]), []);
  assert.deepEqual(validateTaskSet([makeTask({ target_section: 'Anything' })], {}), []);
});

// --- I-5: quoting that is disguised, and quoting that is never checked --------------------------

const QUOTE_SKILL =
  '## Ordering work\n\n' +
  "Always confirm the destination branch before opening a review. Don't push directly to the shared integration line. " +
  'Check the destination branch, confirm the owner, then open the review.\n';
const BASE_RUBRIC = makeTask().rubric.slice(0, 2);

/** The problems for a task whose third rubric item is `item`, judged against QUOTE_SKILL. */
function quoteProblems(item, skillText = QUOTE_SKILL) {
  return validateTask(makeTask({ rubric: [...BASE_RUBRIC, item] }), { skillText });
}

test('I-5: control: the plain copy of a skill phrase is a quoting problem', () => {
  const problems = quoteProblems('Always confirm the destination branch before opening a review.');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^rubric\[2\]: quotes 6 or more consecutive words of the skill text/);
});

test('I-5: a curly apostrophe does not hide a contraction from the quoting rule', () => {
  // The skill says "Don't push directly to the shared"; six words only when the apostrophe is straight.
  for (const apostrophe of ['\u2019', '\u2018', '\u02bc', '\uff07', '\u00b4']) {
    const problems = quoteProblems(`Don${apostrophe}t push directly to the shared`);
    assert.equal(problems.length, 1, JSON.stringify(apostrophe));
    assert.match(problems[0], /^rubric\[2\]: quotes /);
  }
  assert.equal(quoteProblems('Dont push directly to the shared').length, 1);
});

test('I-5: look-alike letters of other scripts do not hide a copied phrase', () => {
  // Cyrillic а, е, о and с in "Always confirm the destination branch before opening a review".
  const cyrillic = 'Alw\u0430ys \u0441onfirm th\u0435 destinati\u043en bran\u0441h before \u043epening a r\u0435view';
  const problems = quoteProblems(cyrillic);
  assert.equal(problems.filter((p) => /quotes 6 or more/.test(p)).length, 1, problems.join(' | '));
  // Greek omicron and alpha, and a full-width word, fold the same way.
  assert.equal(quoteProblems('Always c\u03bfnfirm the destin\u03b1tion branch before opening a review').filter((p) => /quotes/.test(p)).length, 1);
  assert.equal(quoteProblems('Always confirm the \uff44\uff45\uff53\uff54\uff49\uff4e\uff41\uff54\uff49\uff4f\uff4e branch before opening a review').filter((p) => /quotes/.test(p)).length, 1);
});

test('I-5: a word that mixes scripts is a problem even when the look-alike is not in the table', () => {
  // U+0503 prints like a Latin d and is not in the fold table, so the phrase is not matched; the
  // mixed word itself is reported, with or without a skill text.
  const item = 'The \u0503estination branch is confirmed first';
  for (const options of [undefined, { skillText: QUOTE_SKILL }]) {
    const problems = validateTask(makeTask({ rubric: [...BASE_RUBRIC, item] }), options);
    assert.deepEqual(problems, ['rubric[2]: has a word that mixes Latin letters with Cyrillic or Greek ones, which hides copied phrases from the quoting check; write each word in one script']);
  }
});

test('I-5: text in one non-Latin script, and the micro sign, are not mixed words', () => {
  assert.deepEqual(validateTask(makeTask({ rubric: [...BASE_RUBRIC, '\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u0432\u0435\u0442\u043a\u0443 \u043f\u0435\u0440\u0435\u0434 \u0437\u0430\u043f\u0443\u0441\u043a\u043e\u043c'] })), []);
  assert.deepEqual(validateTask(makeTask({ rubric: [...BASE_RUBRIC, 'The response arrives in under 5 \u00b5s on the test machine'] })), []);
});

test('I-5: zero-width characters and combining marks inside words do not hide a copied phrase', () => {
  assert.equal(quoteProblems('Al\u200bways con\u200cfirm the dest\u2060ination branch before opening a review').length, 1);
  assert.equal(quoteProblems('Always conf\u0069\u0301rm the destination branch before opening a review').length, 1);
  assert.equal(quoteProblems('Always confirm the destination br\u00e1nch before opening a review').length, 1);
});

test('I-5: a copied phrase with filler words added is still found', () => {
  // "Check the destination branch, confirm the owner, then open the review" with small words inserted:
  // the raw six-word runs differ, the content words are the same.
  const problems = quoteProblems('Check the destination branch and really confirm the owner so you open a review');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^rubric\[2\]: quotes 6 or more consecutive words of the skill text once small words such as "the" and "of" are ignored/);
});

test('I-5: inflected forms of a copied phrase are found', () => {
  const problems = quoteProblems('Always confirms the destination branches before opened a review');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^rubric\[2\]: quotes /);
});

test('I-5: homoglyph copies of a rubric item are duplicates', () => {
  const rubric = ['The plan lists every risk.', 'The plan lists every r\u0456sk.', 'The plan names an owner.'];
  assert.deepEqual(validateTask(makeTask({ rubric })), ['rubric[1]: duplicates rubric[0]', 'rubric[1]: has a word that mixes Latin letters with Cyrillic or Greek ones, which hides copied phrases from the quoting check; write each word in one script']);
});

test('I-5: known limit: a rewrite that swaps in synonyms is not caught, and a short fragment is not either', () => {
  // The rule narrows the evasion; it cannot decide paraphrase. This pins what is still let through so
  // that a change of behavior here is noticed.
  assert.deepEqual(quoteProblems('Verify the target branch prior to launching a code review'), []);
  assert.deepEqual(quoteProblems('Always confirm the destination branch'), []);
  assert.deepEqual(quoteProblems('A review is opened before the destination branch is confirmed always'), []);
});

test('I-5: ordinary rubric wording that shares a few words with the skill passes', () => {
  assert.deepEqual(quoteProblems('The subject names the destination branch and says who owns the review'), []);
});

test('I-5: a set whose skillTexts is not a plain object is a problem, not a skipped rule', () => {
  const message = 'options.skillTexts: must be a plain object from skill name to skill text; the rubric quoting rule and the target_section check were not run';
  for (const skillTexts of [undefined, null, 'text', 5, [], [QUOTE_SKILL]]) {
    const problems = validateTaskSet([makeTask()], { skillTexts });
    assert.equal(problems[0], message, String(skillTexts));
  }
});

test('I-5: a set that leaves skillTexts out entirely still skips both rules', () => {
  assert.deepEqual(validateTaskSet([makeTask({ target_section: 'Anything' })], {}), []);
  assert.deepEqual(validateTaskSet([makeTask({ target_section: 'Anything' })], { other: 1 }), []);
});

test('I-5: a skill with no usable text in a supplied set reports the quoting rule as well as the section', () => {
  for (const text of [undefined, '', '   \u200b ', 5, null]) {
    const skillTexts = { planner: text, reviewer: QUOTE_SKILL };
    const problems = validateTaskSet([makeTask()], { skillTexts });
    assert.ok(problems.includes('tasks[0]: rubric: the quoting rule cannot run because options.skillTexts holds no text for "planner"'), JSON.stringify([text, problems]));
  }
});

test('I-5: a set with a usable text for every skill reports neither', () => {
  const problems = validateTaskSet([makeTask()], { skillTexts: { planner: QUOTE_SKILL } });
  assert.deepEqual(problems, []);
});

test('I-5: the set-level quoting check also catches a disguised copy in one task of many', () => {
  const copy = makeTask({ id: 'planner-core-copy', rubric: [...BASE_RUBRIC, 'Don\u2019t push directly to the shared'] });
  const problems = validateTaskSet([makeTask(), copy], { skillTexts: { planner: QUOTE_SKILL } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^tasks\[1\]: rubric\[2\]: quotes 6 or more consecutive words/);
});
