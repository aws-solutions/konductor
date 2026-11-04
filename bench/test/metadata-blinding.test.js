// SPDX-License-Identifier: Apache-2.0
/**
 * Pins that nothing but the request, the checklist, each arm's reply and each arm's changed files
 * reaches a judge. A task record carries fields that name the skill's own vocabulary
 * (`target_section` is a verbatim heading from the skill, `checks` hold the words the checks look
 * for, `reference` is a solution) or describe the experiment (`id`, `skill`, `kind`). A pair
 * record carries arm labels and run details. If a prompt builder starts forwarding any of them,
 * the skill's identity leaks into the judge and the blinding is void, so these tests fail loudly.
 *
 * The prompt is rendered for real: both scales, both orders and both pair kinds (a with-versus-
 * without pair, and a null control that shows the same arm twice).
 * Run: node --test bench/test/metadata-blinding.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { judgePrompt } = require('../lib/judge-prompt');
const { SCALES } = require('../lib/judge-scale');

const SKILL = 'zz-skill-sentinel';
const CONTEXT = { skillName: SKILL, aliases: ['zz-alias-sentinel'] };

// Every field of a task other than `task` and `rubric`, each with a value found nowhere else.
const TASK_SENTINELS = Object.freeze({
  id: 'ZZ-ID-SENTINEL-7',
  skill: SKILL,
  kind: 'ZZ-KIND-SENTINEL',
  target_section: 'ZZ-SECTION-SENTINEL',
  unlisted_future_field: 'ZZ-FUTURE-SENTINEL',
});
const FIXTURE_PATH = 'ZZ-FIXTURE-PATH-SENTINEL.md';
const FIXTURE_TEXT = 'ZZ-FIXTURE-TEXT-SENTINEL';
const CHECKS = Object.freeze([
  {
    kind: 'contains',
    path: 'ZZ-CHECK-PATH-SENTINEL.md',
    pattern: 'ZZ-PATTERN-SENTINEL',
    negatives: ['ZZ-NEGATIVE-SENTINEL-ONE', 'ZZ-NEGATIVE-SENTINEL-TWO'],
  },
  { kind: 'not_contains', path: 'ZZ-CHECK-PATH-SENTINEL.md', pattern: 'ZZ-PATTERN-SENTINEL-TWO' },
]);
const REFERENCE = Object.freeze({
  'ZZ-REFERENCE-PATH-SENTINEL.md': 'ZZ-REFERENCE-TEXT-SENTINEL',
});
const TASK = Object.freeze({
  ...TASK_SENTINELS,
  task: 'Add a changelog entry for the new flag.',
  rubric: ['Adds an entry under Unreleased.', 'Names the flag.'],
  fixtures: [FIXTURE_PATH],
  checks: CHECKS,
  reference: REFERENCE,
});
const ALL_SENTINELS = [
  ...Object.values(TASK_SENTINELS),
  FIXTURE_PATH,
  FIXTURE_TEXT,
  'ZZ-CHECK-PATH-SENTINEL',
  'ZZ-PATTERN-SENTINEL',
  'ZZ-NEGATIVE-SENTINEL',
  'ZZ-REFERENCE',
  'ZZ-ARM',
  'ZZ-RUN',
  'ZZ-AGENT',
  'ZZ-USAGE',
];

// Real headings from the skills, which are what a `target_section` carries in practice.
const REAL_HEADINGS = [
  'CRITICAL (blocks merge)',
  'Explicit Publish Authorization',
  'Post-Implementation Review',
];

const START = Object.freeze({
  'CHANGELOG.md': '# Changelog\n\n## Unreleased\n',
  [FIXTURE_PATH]: FIXTURE_TEXT,
});

/** A stored result for one arm: what judgePrompt reads, plus the run details it must ignore. */
const record = (armLabel, reply, final) => ({
  answer: reply,
  start: START,
  final: { ...START, ...final },
  arm: `ZZ-ARM-${armLabel}`,
  agent: 'ZZ-AGENT-SENTINEL',
  run_id: 'ZZ-RUN-SENTINEL',
  condition: `ZZ-ARM-CONDITION-${armLabel}`,
  usage: { note: 'ZZ-USAGE-SENTINEL' },
});

const changelog = (entry) => ({
  'CHANGELOG.md': `# Changelog\n\n## Unreleased\n\n- ${entry}\n`,
});

const PAIR_KINDS = Object.freeze({
  pair: [
    record('with', 'Done.', changelog('Added the flag.')),
    record('without', 'Done.', changelog('misc')),
  ],
  'null control': [
    record('with-one', 'Done.', changelog('Added it.')),
    record('with-two', 'Done.', changelog('Added it.')),
  ],
});

const ORDERS = Object.freeze({
  'with-first': (r) => r,
  'without-first': (r) => [r[1], r[0]],
});

const contains = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());

test('no task or pair field other than the request and checklist reaches a judge', () => {
  for (const scale of Object.keys(SCALES)) {
    for (const [kind, records] of Object.entries(PAIR_KINDS)) {
      for (const [order, arrange] of Object.entries(ORDERS)) {
        const [a, b] = arrange(records);
        const { prompt } = judgePrompt(TASK, a, b, { context: CONTEXT, scale, nonce: 'n0nce-001' });
        const where = `${scale}/${kind}/${order}`;
        for (const secret of ALL_SENTINELS) {
          assert.ok(!contains(prompt, secret), `${secret} reached the judge prompt (${where})`);
        }
        assert.ok(prompt.includes(TASK.task), `the request is shown (${where})`);
        assert.ok(
          prompt.includes('1. Adds an entry under Unreleased.\n2. Names the flag.'),
          `the checklist is shown (${where})`,
        );
        assert.ok(prompt.includes('### CHANGELOG.md (edited)'), `changed file shown (${where})`);
      }
    }
  }
});

test('an untouched start file is not shown, even when a fixture names it', () => {
  const [a, b] = PAIR_KINDS.pair;
  const { prompt } = judgePrompt(TASK, a, b, { context: CONTEXT });
  assert.ok(!prompt.includes(FIXTURE_TEXT));
  assert.ok(!prompt.includes(FIXTURE_PATH));
});

test('a real skill heading in target_section is not shown, whichever template renders it', () => {
  const [a, b] = PAIR_KINDS.pair;
  for (const heading of REAL_HEADINGS) {
    for (const scale of Object.keys(SCALES)) {
      const task = { ...TASK, target_section: heading, exercises_section: heading };
      const { prompt } = judgePrompt(task, a, b, { context: CONTEXT, scale });
      assert.ok(!prompt.includes(heading), `"${heading}" reached the ${scale} judge prompt`);
    }
  }
});

test('a task with an extra top-level field renders the same prompt as one without it', () => {
  const [a, b] = PAIR_KINDS.pair;
  const options = { context: CONTEXT, nonce: 'n0nce-002' };
  const bare = { task: TASK.task, rubric: TASK.rubric };
  assert.equal(judgePrompt(TASK, a, b, options).prompt, judgePrompt(bare, a, b, options).prompt);
  const extra = { ...bare, another_future_field: 'ZZ-OTHER-SENTINEL' };
  assert.equal(judgePrompt(extra, a, b, options).prompt, judgePrompt(bare, a, b, options).prompt);
});

test('an arm record with extra fields renders the same prompt as one without them', () => {
  const [a, b] = PAIR_KINDS.pair;
  const strip = ({ answer, start, final }) => ({ answer, start, final });
  const options = { context: CONTEXT, nonce: 'n0nce-003' };
  assert.equal(
    judgePrompt(TASK, a, b, options).prompt,
    judgePrompt(TASK, strip(a), strip(b), options).prompt,
  );
});

// ---- the cleaner on files ---------------------------------------------------------------------

test('the skill name planted in a file path or file content is removed', () => {
  const planted = record('with', `I used ${SKILL} for this.`, {
    [`notes/${SKILL}.md`]: `Notes from ${SKILL}.\nAlso zz-alias-sentinel was mentioned.\n`,
    [`.claude/skills/${SKILL}/SKILL.md`]: 'copied text',
    'docs/plain.md': `I loaded the skill first.\nThe release is ready.\n${SKILL}\n`,
  });
  const clean = record('without', 'Done.', { 'docs/plain.md': 'The release is ready.\n' });
  for (const scale of Object.keys(SCALES)) {
    for (const [a, b] of [
      [planted, clean],
      [clean, planted],
    ]) {
      const { prompt } = judgePrompt(TASK, a, b, { context: CONTEXT, scale });
      assert.ok(!contains(prompt, SKILL), `skill name reached the ${scale} prompt`);
      assert.ok(!contains(prompt, 'zz-alias-sentinel'), `alias reached the ${scale} prompt`);
      assert.ok(!contains(prompt, 'I loaded the skill first'), `narration reached ${scale}`);
      assert.ok(!prompt.includes('.claude/'), `a harness path reached the ${scale} prompt`);
      assert.ok(prompt.includes('The release is ready.'), 'ordinary file text is kept');
    }
  }
});

// ---- one arm never shows the other's files -----------------------------------------------------

/** The text between the open and close marker lines of answer `which`. */
function blockOf(prompt, which, nonce) {
  const open = `<<<ANSWER_${which} id=${nonce}>>>\n`;
  const close = `\n<<<END_ANSWER_${which} id=${nonce}>>>`;
  const from = prompt.indexOf(open);
  const to = prompt.indexOf(close);
  assert.ok(from >= 0 && to > from, `block ${which} found`);
  return prompt.slice(from + open.length, to);
}

const first = record('with', 'Reply one.', {
  'only-in-first.md': 'FIRST-ARM-CONTENT',
  'shared.md': 'first version',
});
const second = record('without', 'Reply two.', {
  'only-in-second.md': 'SECOND-ARM-CONTENT',
  'shared.md': 'second version',
});

test("one arm's files never appear in the other arm's block", () => {
  const nonce = 'n0nce-004';
  for (const scale of Object.keys(SCALES)) {
    for (const [a, b] of [
      [first, second],
      [second, first],
    ]) {
      const { prompt } = judgePrompt(TASK, a, b, { context: CONTEXT, scale, nonce });
      const blockA = blockOf(prompt, 'A', nonce);
      const blockB = blockOf(prompt, 'B', nonce);
      const own = (r) => (r === first ? 'FIRST' : 'SECOND');
      const other = (r) => (r === first ? 'SECOND' : 'FIRST');
      assert.ok(blockA.includes(`${own(a)}-ARM-CONTENT`) && !blockA.includes(`${other(a)}-ARM`));
      assert.ok(blockB.includes(`${own(b)}-ARM-CONTENT`) && !blockB.includes(`${other(b)}-ARM`));
      assert.ok(!blockA.includes(`only-in-${other(a).toLowerCase()}.md`));
      assert.ok(!blockB.includes(`only-in-${other(b).toLowerCase()}.md`));
    }
  }
});

test('the two orders show the same file blocks, swapped', () => {
  const nonce = 'n0nce-005';
  for (const scale of Object.keys(SCALES)) {
    const options = { context: CONTEXT, scale, nonce };
    const one = judgePrompt(TASK, first, second, options).prompt;
    const two = judgePrompt(TASK, second, first, options).prompt;
    assert.equal(blockOf(one, 'A', nonce), blockOf(two, 'B', nonce));
    assert.equal(blockOf(one, 'B', nonce), blockOf(two, 'A', nonce));
    assert.notEqual(blockOf(one, 'A', nonce), blockOf(one, 'B', nonce));
    const outside = (prompt) =>
      ['A', 'B'].reduce((rest, which) => rest.replace(blockOf(prompt, which, nonce), ''), prompt);
    assert.equal(outside(one), outside(two), 'everything outside the answer blocks is identical');
  }
});
