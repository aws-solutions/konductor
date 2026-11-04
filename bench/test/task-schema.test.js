// SPDX-License-Identifier: Apache-2.0
/**
 * Task Schema unit tests
 *
 * Uses Node's built-in `node:test` and `node:assert`, so no test framework dependency is needed.
 * Run: node --test bench/test/task-schema.test.js
 *
 * Every task is built inline from `makeTask`. The tests read no files, spawn no processes and
 * make no network or model calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KINDS,
  TASK_FIELDS,
  MAX_TASK_WORDS,
  MIN_RUBRIC_ITEMS,
  RUBRIC_QUOTE_WORDS,
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
    fixtures: ['README.md', 'src/checkout.js'],
    checks: [{ type: 'file_exists', path: 'PLAN.md' }],
    ...overrides,
  };
}

function words(count) {
  return Array.from({ length: count }, (_, i) => `w${i}`).join(' ');
}

function without(task, field) {
  const copy = { ...task };
  delete copy[field];
  return copy;
}

function problemsMatching(problems, pattern) {
  return problems.filter((p) => pattern.test(p));
}

// --- Whole task -------------------------------------------------------------------------------

test('a complete valid task has no problems', () => {
  assert.deepEqual(validateTask(makeTask()), []);
});

test('the constants describe the documented limits', () => {
  assert.deepEqual([...KINDS], ['core', 'coverage', 'near-miss']);
  assert.deepEqual(
    [...TASK_FIELDS],
    ['id', 'skill', 'kind', 'task', 'rubric', 'target_section', 'fixtures', 'checks'],
  );
  assert.equal(MAX_TASK_WORDS, 200);
  assert.equal(MIN_RUBRIC_ITEMS, 3);
  assert.equal(RUBRIC_QUOTE_WORDS, 6);
});

test('a task that is not a plain object is one problem, never a throw', () => {
  for (const bad of [undefined, null, 0, 'task', true, [], [makeTask()], () => makeTask()]) {
    assert.deepEqual(validateTask(bad), ['task: must be an object'], String(bad));
  }
});

test('every required field is reported when missing', () => {
  for (const field of TASK_FIELDS) {
    const problems = validateTask(without(makeTask(), field));
    assert.ok(problems.includes(`${field}: missing`), `${field}: ${JSON.stringify(problems)}`);
  }
  assert.equal(validateTask({}).length, TASK_FIELDS.length);
});

test('a throwing getter is reported as a problem', () => {
  const task = makeTask();
  Object.defineProperty(task, 'rubric', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.deepEqual(validateTask(task), ['task: could not be inspected because reading a property threw']);
});

// --- Unknown fields ---------------------------------------------------------------------------

test('an unknown top-level field is rejected and a known set is accepted', () => {
  assert.deepEqual(validateTask(makeTask()), []);
  assert.deepEqual(validateTask(makeTask({ tiers: ['full'] })), ['unknown field "tiers"']);
  assert.deepEqual(validateTask(makeTask({ prompt: 'x', class: 'y' })), ['unknown field "prompt"', 'unknown field "class"']);
});

test('an unknown field name is truncated when echoed', () => {
  const problems = validateTask(makeTask({ ['x'.repeat(500)]: 1 }));
  assert.equal(problems.length, 1);
  assert.ok(problems[0].length < 100, problems[0]);
});

// --- id and skill -----------------------------------------------------------------------------

test('id must be a slug prefixed by the skill name', () => {
  assert.deepEqual(validateTask(makeTask({ id: 'planner-x' })), []);
  assert.deepEqual(validateTask(makeTask({ id: 'planner-core-basic-2' })), []);

  const wrongPrefix = validateTask(makeTask({ id: 'other-core-basic' }));
  assert.deepEqual(wrongPrefix, ['id: must start with "planner-" followed by a name']);

  assert.equal(problemsMatching(validateTask(makeTask({ id: 'planner' })), /^id: must start with/).length, 1);
  assert.equal(problemsMatching(validateTask(makeTask({ id: 'planner-' })), /^id: must be a lowercase slug/).length, 1);
  assert.equal(problemsMatching(validateTask(makeTask({ id: 'plannerx-core' })), /^id: must start with/).length, 1);
});

test('id rejects anything that is not a stable lowercase slug', () => {
  for (const id of ['Planner-core', 'planner core', 'planner_core', 'planner--core', '-planner-core', 'planner-core-', 'planner/core', '', 7, null, ['planner-a']]) {
    assert.equal(
      problemsMatching(validateTask(makeTask({ id })), /^id: must be a lowercase slug/).length,
      1,
      JSON.stringify(id),
    );
  }
});

test('skill must be a slug, and the id prefix rule is skipped while the skill is invalid', () => {
  const problems = validateTask(makeTask({ skill: 'Not A Slug' }));
  assert.deepEqual(problems, ['skill: must be a lowercase slug of letters, digits and single hyphens']);
  assert.equal(validateTask(makeTask({ skill: 3 })).length, 1);
  assert.deepEqual(validateTask(makeTask({ skill: 'multi-word-skill', id: 'multi-word-skill-core-1' })), []);
});

// --- kind -------------------------------------------------------------------------------------

test('kind accepts each member of the enum and nothing else', () => {
  for (const kind of KINDS) assert.deepEqual(validateTask(makeTask({ kind })), [], kind);
  for (const kind of ['', 'Core', 'extra', 'near_miss', null, 1, ['core']]) {
    assert.deepEqual(validateTask(makeTask({ kind })), ['kind: must be one of core, coverage, near-miss'], JSON.stringify(kind));
  }
});

// --- task text --------------------------------------------------------------------------------

test('the request text is accepted up to the word cap and rejected above it', () => {
  assert.deepEqual(validateTask(makeTask({ task: words(MAX_TASK_WORDS) })), []);
  assert.deepEqual(
    validateTask(makeTask({ task: words(MAX_TASK_WORDS + 1) })),
    [`task: has ${MAX_TASK_WORDS + 1} words, the limit is ${MAX_TASK_WORDS}`],
  );
  assert.deepEqual(validateTask(makeTask({ task: `  ${words(MAX_TASK_WORDS)}\n\n  ` })), []);
});

test('the request text counts any run of whitespace as one separator', () => {
  const spaced = Array.from({ length: MAX_TASK_WORDS + 1 }, (_, i) => `w${i}`).join('\n\t  ');
  assert.equal(problemsMatching(validateTask(makeTask({ task: spaced })), /^task: has/).length, 1);
});

test('the request text must be a non-blank string', () => {
  for (const task of ['', '   ', '\n\t', 5, null, ['text']]) {
    assert.deepEqual(validateTask(makeTask({ task })), ['task: must be a non-empty string'], JSON.stringify(task));
  }
});

// --- rubric -----------------------------------------------------------------------------------

test('the rubric needs the minimum item count', () => {
  const items = makeTask().rubric;
  assert.deepEqual(validateTask(makeTask({ rubric: items.slice(0, MIN_RUBRIC_ITEMS) })), []);
  assert.deepEqual(
    validateTask(makeTask({ rubric: items.slice(0, MIN_RUBRIC_ITEMS - 1) })),
    [`rubric: needs at least ${MIN_RUBRIC_ITEMS} items, got ${MIN_RUBRIC_ITEMS - 1}`],
  );
  assert.deepEqual(validateTask(makeTask({ rubric: [] })), [`rubric: needs at least ${MIN_RUBRIC_ITEMS} items, got 0`]);
});

test('the rubric must be an array of non-empty strings', () => {
  for (const rubric of ['a b c', null, {}, 3]) {
    assert.deepEqual(validateTask(makeTask({ rubric })), ['rubric: must be an array of strings'], JSON.stringify(rubric));
  }
  const problems = validateTask(makeTask({ rubric: ['fine item', '', '   ', 4] }));
  assert.deepEqual(problems, [
    'rubric[1]: must be a non-empty string',
    'rubric[2]: must be a non-empty string',
    'rubric[3]: must be a non-empty string',
  ]);
});

// --- Rubric quoting ---------------------------------------------------------------------------

// I-6: supplying the skill text also resolves target_section, so the text carries that heading.
const SKILL_HEADING = '## Ordering work\n\n';
const SKILL_TEXT =
  SKILL_HEADING +
  [
    'Always confirm the destination branch before opening a review.',
    'Never push directly to the shared integration line without a green build.',
  ].join(' ');

test('a rubric item that quotes the skill is a problem when the skill text is supplied', () => {
  const quoted = 'The answer must say: confirm the destination branch before opening a review';
  const task = makeTask({ rubric: [...makeTask().rubric.slice(0, 2), quoted] });
  const problems = validateTask(task, { skillText: SKILL_TEXT });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^rubric\[2\]: quotes 6 or more consecutive words of the skill text/);
});

test('the quoting rule ignores case, punctuation and spacing', () => {
  const quoted = 'CONFIRM the   destination, branch -- before opening a review!';
  const task = makeTask({ rubric: [...makeTask().rubric.slice(0, 2), quoted] });
  assert.equal(validateTask(task, { skillText: SKILL_TEXT }).length, 1);
});

test('a rubric item that restates the idea in other words passes', () => {
  const restated = 'The subject checks where the change will land before asking anyone to look at it';
  const task = makeTask({ rubric: [...makeTask().rubric.slice(0, 2), restated] });
  assert.deepEqual(validateTask(task, { skillText: SKILL_TEXT }), []);
});

test('a shared run just under the threshold is allowed and one at the threshold is not', () => {
  const skillText = `${SKILL_HEADING}alpha beta gamma delta epsilon zeta eta theta`;
  const base = makeTask().rubric.slice(0, 2);
  const under = validateTask(makeTask({ rubric: [...base, 'see alpha beta gamma delta epsilon only'] }), { skillText });
  assert.deepEqual(under, []);
  const at = validateTask(makeTask({ rubric: [...base, 'see alpha beta gamma delta epsilon zeta only'] }), { skillText });
  assert.equal(at.length, 1);
});

test('the quoting rule is skipped when no skill text is supplied', () => {
  const quoted = 'confirm the destination branch before opening a review';
  const task = makeTask({ rubric: [...makeTask().rubric.slice(0, 2), quoted] });
  assert.deepEqual(validateTask(task), []);
  assert.deepEqual(validateTask(task, {}), []);
  assert.deepEqual(validateTask(task, { skillText: 42 }), []);
  assert.deepEqual(validateTask(task, null), []);
});

test('a skill text that holds only the target heading quotes nothing', () => {
  assert.deepEqual(validateTask(makeTask(), { skillText: SKILL_HEADING }), []);
});

test('an empty skill text quotes nothing, and resolves no target_section either (I-6)', () => {
  // Before I-6 this returned []. An empty text is a supplied text, so the section must be found in it.
  assert.deepEqual(validateTask(makeTask(), { skillText: '' }), [
    'target_section: "Ordering work" is not a heading of the skill text',
  ]);
});

// --- target_section ---------------------------------------------------------------------------

test('target_section must be a non-empty string', () => {
  assert.deepEqual(validateTask(makeTask({ target_section: 'Any heading' })), []);
  for (const target_section of ['', '  ', null, 4, ['x']]) {
    assert.deepEqual(
      validateTask(makeTask({ target_section })),
      ['target_section: must be a non-empty string'],
      JSON.stringify(target_section),
    );
  }
});

// --- fixtures ---------------------------------------------------------------------------------

test('fixtures are unique relative paths, and an empty list is allowed', () => {
  assert.deepEqual(validateTask(makeTask({ fixtures: [] })), []);
  assert.deepEqual(validateTask(makeTask({ fixtures: ['a.txt', 'dir/b.txt'] })), []);
  assert.deepEqual(validateTask(makeTask({ fixtures: ['a.txt', 'a.txt'] })), ['fixtures[1]: duplicate path "a.txt"']);
});

test('fixtures reject paths that leave the workspace and non-array values', () => {
  const problems = validateTask(makeTask({ fixtures: ['/etc/hosts', '../up', 'ok.txt', 'a\\b', '', 3] }));
  assert.deepEqual(problems.map((p) => p.split(':')[0]), [
    'fixtures[0]',
    'fixtures[1]',
    'fixtures[3]',
    'fixtures[4]',
    'fixtures[5]',
  ]);
  for (const fixtures of ['a.txt', null, {}]) {
    assert.deepEqual(validateTask(makeTask({ fixtures })), ['fixtures: must be an array of relative paths']);
  }
});

// --- checks -----------------------------------------------------------------------------------

test('checks must be an array of valid check objects', () => {
  assert.deepEqual(validateTask(makeTask({ checks: [] })), []);
  const valid = [
    { type: 'file_exists', path: 'PLAN.md' },
    { type: 'contains', path: 'PLAN.md', pattern: 'risk' },
  ];
  assert.deepEqual(validateTask(makeTask({ checks: valid })), []);
  assert.deepEqual(validateTask(makeTask({ checks: 'none' })), ['checks: must be an array of check objects']);
});

test('a check that is not an object is reported against its position', () => {
  const problems = validateTask(makeTask({ checks: [{ type: 'file_exists', path: 'a' }, null, 'x', []] }));
  assert.deepEqual(problems, [
    'checks[1]: must be an object',
    'checks[2]: must be an object',
    'checks[3]: must be an object',
  ]);
});

test('a malformed check is reported with the problems validateCheck finds', () => {
  const problems = validateTask(
    makeTask({ checks: [{ type: 'banana' }, { type: 'contains', path: '../x' }, { type: 'min_matches', path: 'a', pattern: 'xx', min: 0 }] }),
  );
  assert.deepEqual(problems, [
    'checks[0]: type: must be one of file_exists, contains, not_contains, fixture_unchanged, file_absent',
    'checks[1]: path: must be a relative path inside the workspace',
    'checks[1]: pattern: missing',
    // Behavior change (C): this entry was `checks[2]: min: must be an integer of at least 1`. min_matches
    // is no longer a kind, so the whole check is one problem that names the replacement.
    'checks[2]: type: min_matches was removed because counting matches rewards a word pasted N times and does not measure the work; use contains with a pattern that spans the structure you need',
  ]);
});

// --- Task sets --------------------------------------------------------------------------------

test('a set of valid tasks with distinct ids has no problems', () => {
  const set = [makeTask(), makeTask({ id: 'planner-coverage-edge', kind: 'coverage' }), makeTask({ id: 'planner-near-miss-1', kind: 'near-miss' })];
  assert.deepEqual(validateTaskSet(set), []);
  assert.deepEqual(validateTaskSet([]), []);
});

test('duplicate ids across a set are reported against the later task', () => {
  const problems = validateTaskSet([makeTask(), makeTask({ id: 'planner-other' }), makeTask()]);
  assert.deepEqual(problems, ['tasks[2]: id "planner-core-basic" is already used by tasks[0]']);
});

test('tasks of different skills with different ids are accepted together', () => {
  const a = makeTask({ id: 'planner-a' });
  const b = makeTask({ id: 'reviewer-a', skill: 'reviewer' });
  assert.deepEqual(validateTaskSet([a, b]), []);
});

test('problems in a set carry the task position', () => {
  const problems = validateTaskSet([makeTask(), makeTask({ id: 'planner-b', kind: 'nope' }), 'junk']);
  assert.deepEqual(problems, [
    'tasks[1]: kind: must be one of core, coverage, near-miss',
    'tasks[2]: task: must be an object',
  ]);
});

test('a set that is not an array is one problem', () => {
  for (const bad of [undefined, null, {}, 'tasks', 3, new Set([makeTask()])]) {
    assert.deepEqual(validateTaskSet(bad), ['tasks: must be an array'], String(bad));
  }
});

test('a hole in a set is a problem, not a throw', () => {
  const sparse = [makeTask()];
  sparse[2] = makeTask({ id: 'planner-two' });
  assert.deepEqual(validateTaskSet(sparse), ['tasks[1]: task: must be an object']);
});

test('a throwing id getter in a set does not abort the others', () => {
  const bad = makeTask({ id: 'planner-bad' });
  Object.defineProperty(bad, 'id', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  const problems = validateTaskSet([bad, makeTask()]);
  assert.deepEqual(problems, ['tasks[0]: task: could not be inspected because reading a property threw']);
});

test('a set applies each skill its own text for the quoting rule', () => {
  const quote = 'confirm the destination branch before opening a review';
  const planner = makeTask({ rubric: [...makeTask().rubric.slice(0, 2), quote] });
  const reviewer = makeTask({ id: 'reviewer-a', skill: 'reviewer', rubric: [...makeTask().rubric.slice(0, 2), quote] });
  const problems = validateTaskSet([planner, reviewer], {
    skillTexts: { planner: SKILL_TEXT, reviewer: `${SKILL_HEADING}unrelated text only` },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^tasks\[0\]: rubric\[2\]: quotes/);
});

test('a skill name that matches an Object.prototype member gets no skill text', () => {
  const task = makeTask({ id: 'constructor-a', skill: 'constructor' });
  // I-6: no text found means the target_section cannot be resolved, which is a problem now.
  // Behavior change (I-5): the quoting rule gets no text either, and that is a problem too, not a
  // silent skip.
  const unresolved = [
    'tasks[0]: target_section: cannot be resolved because options.skillTexts holds no text for "constructor"',
    'tasks[0]: rubric: the quoting rule cannot run because options.skillTexts holds no text for "constructor"',
  ];
  assert.deepEqual(validateTaskSet([task], { skillTexts: {} }), unresolved);
  assert.deepEqual(validateTaskSet([task], { skillTexts: { constructor: 5 } }), unresolved);
  assert.deepEqual(validateTaskSet([task]), []);
});

// --- Tolerant patterns ------------------------------------------------------------------------

test('a tolerant contains pattern needs declared negatives, and a literal one does not', () => {
  const tolerant = { type: 'contains', path: 'PLAN.md', pattern: 'risks?|hazards?' };
  const literal = { type: 'contains', path: 'PLAN.md', pattern: 'risk' };
  assert.deepEqual(validateTask(makeTask({ checks: [literal] })), []);
  assert.deepEqual(validateTask(makeTask({ checks: [tolerant] })), [
    'checks[0]: negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 0',
  ]);
  assert.deepEqual(validateTask(makeTask({ checks: [{ ...tolerant, negatives: ['a risen tide', 'hazy weather'] }] })), []);
});

test('a declared negative that the pattern accepts is reported against its check', () => {
  const check = { type: 'contains', path: 'PLAN.md', pattern: 'risks?|hazards?', negatives: ['no risk at all', 'hazy weather'] };
  assert.deepEqual(validateTask(makeTask({ checks: [{ type: 'file_exists', path: 'PLAN.md' }, check] })), [
    'checks[1]: negatives: the pattern accepts the declared negative "no risk at all"',
  ]);
});
