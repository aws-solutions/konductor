// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the task schema from the fourth review (findings C-4, I-D, I-E and the fixtures rule)
 *
 * C-4: counts are capped and `validateTask` / `validateTaskSet` run under a work budget. I-D: rubric
 * items that print as nothing, or differ only by something that prints as nothing, are blank or
 * duplicates. I-E: a copied skill sentence with an unlisted filler word inserted every few words was
 * not found. `fixtures[]` held to the same hidden-path rule as a check's path (I-A).
 *
 * Run: node --test bench/test/task-schema-cost.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_RUBRIC_ITEMS,
  MAX_FIXTURES,
  QUOTE_GAP_WORDS,
  validateTask,
  validateTaskSet,
} = require('../lib/task-schema');
const { BUDGET_LIMITS, MAX_CHECKS_PER_TASK, MAX_NEGATIVES_PER_CHECK, createBudget } = require('../lib/checks');

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

function timed(body) {
  const started = performance.now();
  const value = body();
  return { value, ms: performance.now() - started };
}

// --- C-4: ceilings -----------------------------------------------------------------------------

test('C-4: a rubric over MAX_RUBRIC_ITEMS is one problem, reported before any item is read', () => {
  assert.equal(MAX_RUBRIC_ITEMS, 20);
  const rubric = Array.from({ length: MAX_RUBRIC_ITEMS + 1 }, (_, i) => `Criterion number ${i} is met by the plan.`);
  assert.deepEqual(validateTask(makeTask({ rubric })), [`rubric: has ${MAX_RUBRIC_ITEMS + 1} items, the limit is ${MAX_RUBRIC_ITEMS}`]);
  assert.deepEqual(validateTask(makeTask({ rubric: rubric.slice(0, MAX_RUBRIC_ITEMS) })), []);
});

test('C-4: fixtures over MAX_FIXTURES, or a fixture path over the path ceiling, are problems', () => {
  assert.equal(MAX_FIXTURES, 50);
  const fixtures = Array.from({ length: MAX_FIXTURES + 1 }, (_, i) => `f${i}.md`);
  assert.deepEqual(validateTask(makeTask({ fixtures })), [`fixtures: has ${MAX_FIXTURES + 1} entries, the limit is ${MAX_FIXTURES}`]);
  assert.deepEqual(validateTask(makeTask({ fixtures: fixtures.slice(0, MAX_FIXTURES), checks: [] })), []);
  const long = `${'d/'.repeat(130)}f.md`;
  assert.deepEqual(validateTask(makeTask({ fixtures: [long] })), [`fixtures[0]: has ${long.length} characters, the limit is 256`]);
});

test('C-4: more than MAX_CHECKS_PER_TASK checks is one problem, reported before any check runs', () => {
  const checks = Array.from({ length: MAX_CHECKS_PER_TASK + 1 }, (_, i) => ({ type: 'file_exists', path: `f${i}.md` }));
  const { value, ms } = timed(() => validateTask(makeTask({ checks })));
  assert.deepEqual(value, [`checks: has ${MAX_CHECKS_PER_TASK + 1} checks, the limit is ${MAX_CHECKS_PER_TASK}`]);
  assert.ok(ms < 200, `${ms} ms`);
  assert.deepEqual(validateTask(makeTask({ checks: checks.slice(0, MAX_CHECKS_PER_TASK) })), []);
});

// --- C-4: the validation budget ----------------------------------------------------------------

const SLOW_PATTERN = 'a{0,16}'.repeat(10) + 'bc';

function slowChecks(count) {
  assert.equal(MAX_NEGATIVES_PER_CHECK, 8);
  return Array.from({ length: count }, (_, check) => ({
    type: 'contains',
    path: `slow${check}.md`,
    pattern: SLOW_PATTERN,
    // Each negative is a different 122 character text on which the pattern uses the whole second.
    negatives: Array.from({ length: MAX_NEGATIVES_PER_CHECK }, (__, i) => `${'a'.repeat(120 + i)}bd`),
  }));
}

test('C-4: two checks of eight slow negatives validate in the validation budget and not in sixteen seconds', () => {
  const { value, ms } = timed(() => validateTask(makeTask({ checks: slowChecks(2) })));
  assert.ok(value.length > 0);
  assert.ok(value.some((problem) => /^task: validation ran out of its work budget \(the 3000 ms time limit was reached\)/.test(problem)), value.join(' | '));
  assert.ok(ms < BUDGET_LIMITS.validation.ms + 1500, `${ms} ms`);
});

test('C-4: a budget from the caller replaces the default, and a task it cannot cover is invalid', () => {
  const budget = createBudget({ ms: 60000, runs: 4 });
  const problems = validateTask(makeTask({ checks: [1, 2, 3].map((i) => ({ type: 'contains', path: `o${i}.md`, pattern: `rollback${i}(?:s|ed)? plan`, negatives: [`rollback${i}ing plan`, `rollback${i}er plan`] })) }), { budget });
  assert.ok(problems.some((problem) => /validation ran out of its work budget \(more than 4 pattern runs\)/.test(problem)), problems.join(' | '));
  assert.equal(budget.exhausted, 'more than 4 pattern runs');
});

test('C-4: an ordinary task spends a few runs of its budget and is valid', () => {
  const budget = createBudget({ ms: BUDGET_LIMITS.validation.ms, runs: BUDGET_LIMITS.validation.runs });
  assert.deepEqual(validateTask(makeTask({ checks: [{ type: 'contains', path: 'PLAN.md', pattern: 'risk register' }, { type: 'file_exists', path: 'PLAN.md' }] }), { budget }), []);
  assert.equal(budget.exhausted, null);
  assert.ok(budget.runs <= 10, `${budget.runs} runs`);
});

test('C-4: options.budget must come from createBudget', () => {
  for (const budget of [{ ms: 1000, runs: 1000 }, 'x', 5, null]) {
    assert.deepEqual(validateTask(makeTask(), { budget }), ['options.budget: must be a budget made by createBudget'], String(budget));
  }
});

test('C-4: one budget covers the whole set, so a set of cheap tasks cannot be made expensive by their number', () => {
  const tasks = Array.from({ length: 6 }, (_, i) =>
    makeTask({ id: `planner-core-t${i}`, checks: [{ type: 'contains', path: 'PLAN.md', pattern: `risk register ${i}` }] }),
  );
  assert.deepEqual(validateTaskSet(tasks, { budget: createBudget({ ms: 60000, runs: 100000 }) }), []);
  const budget = createBudget({ ms: 60000, runs: 7 });
  const problems = validateTaskSet(tasks, { budget });
  assert.ok(problems.some((problem) => /^tasks\[\d\]: task: validation ran out of its work budget/.test(problem)), problems.join(' | '));
  assert.ok(problems.includes('tasks: validation ran out of its work budget (more than 7 pattern runs), so the set cannot be shown valid'), problems.join(' | '));
});

test('C-4: a set is bounded in total, whatever the number of slow tasks in it', () => {
  // Six tasks of sixteen slow negatives each: ninety-six seconds without a budget. The set's default
  // budget (BUDGET_LIMITS.taskSet) works the same way with a larger figure; a small one keeps this quick.
  const tasks = Array.from({ length: 6 }, (_, i) => makeTask({ id: `planner-core-slow${i}`, checks: slowChecks(2) }));
  const budget = createBudget({ ms: 1500, runs: BUDGET_LIMITS.taskSet.runs });
  const { value, ms } = timed(() => validateTaskSet(tasks, { budget }));
  assert.ok(value.length > 0);
  assert.ok(ms < 1500 + 2500, `${ms} ms`);
  assert.ok(value.includes('tasks: validation ran out of its work budget (the 1500 ms time limit was reached), so the set cannot be shown valid'), value.slice(-2).join(' | '));
  assert.ok(value.some((problem) => /^tasks\[5\]: task: validation ran out/.test(problem)), 'the last task was not run and says so');
});

// --- the fixtures[] path rule (I-A, applied to fixtures) ---------------------------------------

test('I-A: a fixture under node_modules or .git is a problem, the way a check path is', () => {
  for (const hidden of ['node_modules/x', 'src/node_modules/x.js', 'src/Node_Modules/x.js', '.git/config', 'a/.GIT/b', 'node_modules', 'src/.git', 'a/node_modules.'] ) {
    const problems = validateTask(makeTask({ fixtures: ['README.md', hidden] }));
    assert.deepEqual(problems, ['fixtures[1]: it is under or named a directory the snapshot loader skips at any depth (.git, node_modules), so no snapshot can hold it; name a path the loader reads'], hidden);
  }
});

test('I-A: names that merely contain the skipped words are fine as fixtures', () => {
  assert.deepEqual(validateTask(makeTask({ fixtures: ['README.md', 'src/my_node_modules_notes.md', 'docs/gitignore.md', 'git/readme.md'] })), []);
});

// --- I-D: blank-looking letters ----------------------------------------------------------------

const ITEM = 'The plan lists every risk with an owner.';

test('I-D: a rubric item that is only Hangul fillers, the Braille blank or a lone surrogate is blank', () => {
  for (const blanks of [
    ['\u3164', '\u2800', '\u115f'],
    ['\u3164', '\u2800', '\ud800'],
    ['\u034f', '\ufe0f', '\u1160'],
    ['\uffa0', '\u17b4', '\ue000'],
    ['\u3164\u2800', '\u115f\u034f', '\ud800\u0378\udc00'],
  ]) {
    const problems = validateTask(makeTask({ rubric: blanks }));
    assert.deepEqual(problems, [0, 1, 2].map((i) => `rubric[${i}]: must be a non-empty string`), JSON.stringify(blanks));
  }
});

test('I-D: an item padded with a blank-looking letter is a duplicate of the item', () => {
  const rubric = [ITEM, `${ITEM}\u2800`, `${ITEM}\u3164`];
  assert.deepEqual(validateTask(makeTask({ rubric })), ['rubric[1]: duplicates rubric[0]', 'rubric[2]: duplicates rubric[0]']);
  for (const filler of ['\u034f', '\ufe0f', '\u115f', '\u1160', '\uffa0', '\u200b', '\u00ad', '\ufeff', '\u0000', '\ud800', '\ue000']) {
    const padded = validateTask(makeTask({ rubric: [ITEM, `${ITEM}${filler}`, 'Every work item names a concrete outcome.'] }));
    assert.deepEqual(padded, ['rubric[1]: duplicates rubric[0]'], JSON.stringify(filler));
  }
});

test('I-D: a filler inside a word does not make a different word', () => {
  const rubric = [ITEM, 'The p\u2800lan lists every r\u3164isk with an owner.', 'Every work item names a concrete outcome.'];
  assert.deepEqual(validateTask(makeTask({ rubric })), ['rubric[1]: duplicates rubric[0]']);
});

test('I-D: genuinely different items stay different', () => {
  const rubric = [ITEM, 'The plan lists every risk with a mitigation.', 'The plan lists every risk, with an owner and a date.'];
  assert.deepEqual(validateTask(makeTask({ rubric })), []);
});

test('I-D: a mixed-script word cannot be split by an invisible character to dodge the mixed-script rule', () => {
  // `pl`, an invisible character, then a lone Cyrillic `а`: each piece is one script, the word is not.
  const split = 'The pl\u200b\u0430 lists every risk with an owner';
  const problems = validateTask(makeTask({ rubric: [ITEM, 'Every work item names a concrete outcome.', split] }));
  assert.deepEqual(problems, ['rubric[2]: has a word that mixes Latin letters with Cyrillic or Greek ones, which hides copied phrases from the quoting check; write each word in one script']);
});

test('I-D: task and target_section text that prints nothing is blank too', () => {
  assert.deepEqual(validateTask(makeTask({ task: '\u3164\u2800' })), ['task: must be a non-empty string']);
  assert.deepEqual(validateTask(makeTask({ target_section: '\u115f' })), ['target_section: must be a non-empty string']);
});

// --- I-E: a filler word that is not on the list ------------------------------------------------

const SENTENCE_SKILL =
  '## Ordering work\n\n' +
  'Always write the rollback plan before the release branch is cut and name an owner for every step.\n';
const SENTENCE = 'Always write the rollback plan before the release branch is cut and name an owner for every step.';

function withEvery(sentence, every, filler) {
  const words = sentence.split(' ');
  const out = [];
  words.forEach((word, i) => {
    out.push(word);
    if ((i + 1) % (every - 1) === 0 && i + 1 < words.length) out.push(...filler);
  });
  return out.join(' ');
}

function quoted(item) {
  const problems = validateTask(makeTask({ rubric: [...makeTask().rubric.slice(0, 2), item] }), { skillText: SENTENCE_SKILL });
  return problems.filter((problem) => /^rubric\[2\]: quotes /.test(problem));
}

test('I-E: control: the verbatim sentence is flagged', () => {
  assert.equal(quoted(SENTENCE).length, 1);
});

test('I-E: "indeed" inserted as every fourth word no longer hides the sentence', () => {
  const disguised = withEvery(SENTENCE, 4, ['indeed']);
  assert.match(disguised, /^Always write the indeed rollback plan before indeed /);
  const found = quoted(disguised);
  assert.equal(found.length, 1, disguised);
});

test('I-E: any number of words the skill never uses, between any copied words, cannot hide it', () => {
  for (const filler of [['indeed'], ['indeed', 'honestly', 'frankly'], ['zxqv', 'plugh', 'xyzzy', 'quux', 'corge']]) {
    for (const every of [2, 3, 4, 5]) {
      const disguised = withEvery(SENTENCE, every, filler);
      assert.equal(quoted(disguised).length, 1, disguised);
    }
  }
});

test('I-E: words the skill does use, up to QUOTE_GAP_WORDS between copied words, cannot hide it either', () => {
  assert.equal(QUOTE_GAP_WORDS, 2);
  const inVocabulary = withEvery(SENTENCE, 4, ['owner']);
  assert.equal(quoted(inVocabulary).length, 1, inVocabulary);
  const two = withEvery(SENTENCE, 4, ['owner', 'release']);
  assert.equal(quoted(two).length, 1, two);
});

test('I-E: omitting words of the copied sentence does not hide it either', () => {
  assert.equal(quoted('Write rollback plan before release branch cut and name owner for every step').length, 1);
});

test('I-E: known limit: more than QUOTE_GAP_WORDS words of the skill\'s own vocabulary between copied words still hides it', () => {
  // Pins the residual so a change of behavior is noticed. Three skill words inserted after every
  // three copied words put the copied words further apart than the rule looks.
  const hidden = withEvery(SENTENCE, 4, ['step', 'step', 'step']);
  assert.deepEqual(quoted(hidden), [], hidden);
  // Synonyms and reordering are the older limit (see the I-5 tests).
  assert.deepEqual(quoted('Before cutting the release branch, draft a rollback plan first and give every step an owner'), []);
});

test('I-E: wording that shares only scattered words with the skill passes', () => {
  assert.deepEqual(quoted('The plan names an owner and says what happens before the release'), []);
  assert.deepEqual(quoted('Each step has an owner, and the rollback is written down early'), []);
});

test('I-E: a pathological item is a problem and not a hang', () => {
  const skill = `## Ordering work\n\n${'plan '.repeat(20000)}\n`;
  const item = 'plan '.repeat(180).trim();
  const { value, ms } = timed(() => validateTask(makeTask({ rubric: [...makeTask().rubric.slice(0, 2), item] }), { skillText: skill }));
  assert.ok(value.some((problem) => /^rubric\[2\]: (could not be compared with the skill text|quotes )/.test(problem)), value.join(' | '));
  assert.ok(ms < 3000, `${ms} ms`);
});
