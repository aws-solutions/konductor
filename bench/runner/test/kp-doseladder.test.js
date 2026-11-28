// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's tests/scripts/bench/dose-ladder.test.js (pull request #251, commit 33b385f9), same repository and Apache-2.0 licence: the dose ladder audit tests (his answer-writer and digest tests stay with his writer, which cap does not copy).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ladderLib = require('../../cap/doseladder.js');

const {
  LadderError,
  loadLadder,
  editsOf,
  applyEdits,
  answerAtDose,
  itemName,
  itemNames,
  buildPairs,
  validateLadder,
  FORBIDDEN_WORDS,
} = ladderLib;

const sortKeysDeep = (value) =>
  Array.isArray(value)
    ? value.map(sortKeysDeep)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]))
      : value;
const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(sortKeysDeep(value))).digest('hex');
const LADDER_FILE = path.join(__dirname, 'fixtures', 'keep-prune', 'ladder-small.json');
const spec = loadLadder(LADDER_FILE);
const copyOf = (value) => JSON.parse(JSON.stringify(value));
const problemsOf = (ladder) => validateLadder(ladder).problems;
const hasProblem = (ladder, pattern) => {
  const problems = problemsOf(ladder);
  assert.ok(
    problems.some((problem) => pattern.test(problem)),
    `expected a problem matching ${pattern}, got:\n${problems.join('\n')}`,
  );
};

test('the committed test ladder passes its own audit', () => {
  const audit = validateLadder(LADDER_FILE);
  assert.equal(audit.ok, true, `audit problems:\n${audit.problems.join('\n')}`);
  assert.deepEqual(audit.problems, []);
  assert.equal(audit.set, 'dose-ladder-test');
  assert.match(audit.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    audit.tasks.map((task) => task.id),
    spec.tasks.map((task) => task.id),
  );
  assert.deepEqual(
    audit.tasks,
    spec.tasks.map((task) => ({
      id: task.id,
      domain: task.domain,
      rubric: task.rubric.length,
      defects: task.defects.length,
      lengths: Object.fromEntries(
        Object.entries(spec.doses).map(([dose, count]) => [
          dose,
          answerAtDose(task, count).length,
        ]),
      ),
    })),
    'one entry per task, with the length of every dose answer',
  );
});

test('the ladder has a null dose and a top dose, and every task can reach both', () => {
  assert.equal(spec.doses.D0, 0, 'D0 is the null test');
  const maxDose = Math.max(...Object.values(spec.doses));
  assert.ok(maxDose >= 4, 'the top dose should break several items at once');
  for (const task of spec.tasks)
    assert.ok(
      task.defects.length >= maxDose,
      `${task.id} cannot reach the top dose`,
    );
});

test('a dose applies exactly its declared defects and nothing else', () => {
  for (const task of spec.tasks) {
    for (const [dose, defectCount] of Object.entries(spec.doses)) {
      if (defectCount === 0) continue;
      const text = answerAtDose(task, defectCount);
      for (const edit of task.defects.slice(0, defectCount).flatMap(editsOf)) {
        assert.ok(
          text.includes(edit.replace),
          `${task.id} ${dose}: defect replacement is missing`,
        );
        // A replacement that keeps the original text inside it leaves the find string present as a substring,
        // which is the edit working, not failing.
        if (!edit.replace.includes(edit.find))
          assert.ok(
            !text.includes(edit.find),
            `${task.id} ${dose}: baseline text survived a defect`,
          );
      }
      for (const edit of task.defects.slice(defectCount).flatMap(editsOf))
        assert.ok(
          text.includes(edit.find),
          `${task.id} ${dose}: an unapplied defect changed the text`,
        );
      assert.notEqual(text, task.base_answer);
    }
  }
});

test('D0 changes wording only, so every rubric item stays met', () => {
  for (const task of spec.tasks) {
    const paraphrased = answerAtDose(task, 0);
    assert.notEqual(
      paraphrased,
      task.base_answer,
      `${task.id}: D0 must differ in wording`,
    );
    // No defect's replacement may appear in the paraphrase: that would make the null test a dose. A replacement
    // that is already part of the baseline is not evidence of a defect, so it is skipped.
    for (const edit of task.defects.flatMap(editsOf))
      if (!task.base_answer.includes(edit.replace))
        assert.ok(
          !paraphrased.includes(edit.replace),
          `${task.id}: D0 carries a defect replacement`,
        );
  }
});

test('the defective answer goes in the with arm, so a dose reads as a negative gap', () => {
  const pairs = buildPairs(spec);
  assert.deepEqual(
    buildPairs(LADDER_FILE),
    pairs,
    'a path gives the same pairs',
  );
  assert.equal(
    pairs.length,
    Object.keys(spec.doses).length * spec.tasks.length,
  );
  assert.deepEqual(
    pairs.map((pair) => `${pair.item}/${pair.task_id}`),
    Object.keys(spec.doses).flatMap((dose) =>
      spec.tasks.map((task) => `${itemName(dose)}/${task.id}`),
    ),
    'doses in the ladder order, tasks in the ladder order within a dose',
  );
  for (const pair of pairs) {
    const task = spec.tasks.find((candidate) => candidate.id === pair.task_id);
    assert.equal(
      pair.without,
      task.base_answer,
      'without must be the baseline',
    );
    assert.equal(pair.with, answerAtDose(task, pair.defects));
    assert.equal(pair.item, itemName(pair.dose));
    assert.equal(pair.broken_items.length, pair.defects);
    assert.deepEqual(
      pair.broken_items,
      task.defects.slice(0, pair.defects).map((defect) => defect.rubric_item),
    );
    if (pair.dose === 'D0') assert.equal(pair.defects, 0);
    assert.equal(pair.domain, task.domain);
    assert.deepEqual(pair.rubric, task.rubric);
    assert.notEqual(
      pair.rubric,
      task.rubric,
      'the rubric is a copy, not the ladder array',
    );
  }
  const keys = pairs.map((pair) => `${pair.item}/${pair.task_id}`);
  assert.equal(
    new Set(keys).size,
    keys.length,
    'each item and task makes one pair',
  );
});

test('no ladder text carries anything that would tell a judge where it came from', () => {
  for (const pair of buildPairs(LADDER_FILE))
    for (const [field, text] of Object.entries({
      prompt: pair.prompt,
      with: pair.with,
      without: pair.without,
      rubric: pair.rubric.join(' '),
    }))
      for (const pattern of FORBIDDEN_WORDS)
        assert.ok(
          !pattern.test(text),
          `${pair.item} ${pair.task_id} ${field} matches ${pattern}`,
        );
});

test('item names are one per dose, in the ladder order', () => {
  assert.equal(itemName('D1'), 'fixture-d1');
  assert.equal(itemName('D10'), 'fixture-d10');
  assert.deepEqual(itemNames(LADDER_FILE), [
    'fixture-d0',
    'fixture-d1',
    'fixture-d2',
    'fixture-d4',
  ]);
  assert.deepEqual(itemNames(spec), itemNames(LADDER_FILE));
});

test('applyEdits refuses an ambiguous or missing find rather than guessing', () => {
  assert.throws(
    () => applyEdits('a b', [{ find: 'zzz', replace: 'x' }], 'w'),
    LadderError,
  );
  assert.throws(
    () => applyEdits('a b', [{ find: 'zzz', replace: 'x' }], 'w'),
    /w edit 0: find string is not present/,
  );
  assert.throws(
    () => applyEdits('a a', [{ find: 'a', replace: 'x' }], 'w'),
    /more than once/,
  );
  assert.equal(applyEdits('a b', [{ find: 'b', replace: 'c' }], 'w'), 'a c');
  // Edits apply in order, each to the result of the one before.
  assert.equal(
    applyEdits(
      'one two',
      [
        { find: 'one', replace: 'three' },
        { find: 'three two', replace: 'done' },
      ],
      'w',
    ),
    'done',
  );
});

test('answerAtDose refuses a dose the task has too few defects for', () => {
  const task = spec.tasks[0];
  assert.throws(
    () => answerAtDose(task, task.defects.length + 1),
    new RegExp(`${task.id}: dose 5 needs 5 defects, only 4 declared`),
  );
});

test('answerAtDose refuses a dose that is not a whole number of defects, 0 or more', () => {
  const task = spec.tasks[0];
  for (const count of [-1, 1.5, '2', undefined, null])
    assert.throws(
      () => answerAtDose(task, count),
      /fx-1-chunk: a dose needs a whole number of defects, 0 or more/,
    );
});

test('a defect may use several edits, and the dose applies all of them', () => {
  const ladder = copyOf(spec);
  const task = ladder.tasks[0];
  const single = task.defects[2];
  task.defects[2] = {
    rubric_item: single.rubric_item,
    breaks: single.breaks,
    edits: [
      { find: single.find, replace: single.replace },
      {
        find: 'so the input array is never changed',
        replace: 'so the input array is emptied',
      },
    ],
  };
  assert.deepEqual(validateLadder(ladder).problems, []);
  const text = answerAtDose(task, 3);
  assert.ok(text.includes('items.length = 0;'));
  assert.ok(text.includes('so the input array is emptied'));
  assert.equal(editsOf(task.defects[2]).length, 2);
  assert.deepEqual(editsOf(spec.tasks[0].defects[0]), [
    {
      find: spec.tasks[0].defects[0].find,
      replace: spec.tasks[0].defects[0].replace,
    },
  ]);
});

test('the audit catches a defect that names a rubric item that does not exist', () => {
  const ladder = copyOf(spec);
  ladder.tasks[0].defects[0].rubric_item = 99;
  assert.equal(validateLadder(ladder).ok, false);
  hasProblem(
    ladder,
    /fx-1-chunk: defect 0 names rubric item 99, which does not exist/,
  );
  ladder.tasks[0].defects[0].rubric_item = -1;
  hasProblem(ladder, /rubric item -1, which does not exist/);
});

test('the audit catches two defects breaking the same rubric item', () => {
  const ladder = copyOf(spec);
  ladder.tasks[0].defects[1].rubric_item =
    ladder.tasks[0].defects[0].rubric_item;
  hasProblem(ladder, /defect 1 breaks rubric item 1 again/);
});

test('the audit catches overlapping defects, because then the dose count is a lie', () => {
  const ladder = copyOf(spec);
  const first = editsOf(ladder.tasks[0].defects[0])[0];
  ladder.tasks[0].defects[1] = {
    rubric_item: 2,
    breaks: 'x',
    find: first.find.slice(0, 20),
    replace: 'something else',
  };
  hasProblem(ladder, /defects 0 and 1 edit overlapping text/);
});

test('the audit catches overlapping defects whichever one holds the other', () => {
  const ladder = copyOf(spec);
  const first = editsOf(ladder.tasks[0].defects[0])[0];
  // The second defect's find holds the first one's, plus the line after it.
  ladder.tasks[0].defects[1] = {
    rubric_item: 2,
    breaks: 'x',
    find: `${first.find}  const chunks = [];\n`,
    replace: 'something else',
  };
  hasProblem(ladder, /defects 0 and 1 edit overlapping text/);
});

test('the audit catches a find string that is absent or ambiguous', () => {
  const absent = copyOf(spec);
  absent.tasks[0].defects[0] = {
    rubric_item: 1,
    breaks: 'x',
    find: 'NOT IN THE BASELINE',
    replace: 'y',
  };
  hasProblem(absent, /defect 0 edit 0 find string is not in the baseline/);

  const ambiguous = copyOf(spec);
  ambiguous.tasks[0].defects[0] = {
    rubric_item: 1,
    breaks: 'x',
    find: 'chunk',
    replace: 'y',
  };
  hasProblem(ambiguous, /defect 0 edit 0 find string occurs more than once/);
});

test('the audit catches a defect edit that changes nothing', () => {
  const ladder = copyOf(spec);
  ladder.tasks[0].defects[0].replace = ladder.tasks[0].defects[0].find;
  hasProblem(ladder, /defect 0 edit 0 changes nothing/);
});

test('the audit catches an answer that drifts in length, so length alone cannot decide a pair', () => {
  const ladder = copyOf(spec);
  const task = ladder.tasks[0];
  // Delete the longest declared edit, which is the biggest length change the set can make.
  const longest = task.defects
    .flatMap(editsOf)
    .reduce((kept, edit) =>
      edit.find.length > kept.find.length ? edit : kept,
    );
  task.defects[0] = {
    rubric_item: 1,
    breaks: 'deletes a large block',
    find: longest.find,
    replace: '',
  };
  hasProblem(ladder, /off the baseline length, over the 15% tolerance/);
});

test('the audit holds the paraphrase to a tighter length limit than a dose', () => {
  const ladder = copyOf(spec);
  const task = ladder.tasks[0];
  // About a 10% cut: inside the dose tolerance, outside the paraphrase one.
  task.paraphrase = [
    {
      find: 'The last chunk holds whatever is left, so no item is lost.',
      replace: '',
    },
  ];
  hasProblem(
    ladder,
    /D0 paraphrase changes the length by \d+%, over the 8% tolerance/,
  );
});

test('the audit catches a paraphrase that does not change the wording', () => {
  const ladder = copyOf(spec);
  ladder.tasks[0].paraphrase = [{ find: 'is lost.', replace: 'is lost.' }];
  hasProblem(ladder, /D0 paraphrase does not change the wording/);
});

test('the audit catches harness words that must never reach a judge', () => {
  const inAnswer = copyOf(spec);
  inAnswer.tasks[0].base_answer += '\n\nThis follows the loaded guidance.';
  hasProblem(
    inAnswer,
    /base_answer contains .*guidance.* which must never reach a judge/,
  );
  hasProblem(
    inAnswer,
    /D1 answer contains .*guidance.* which must never reach a judge/,
  );

  const inDefect = copyOf(spec);
  inDefect.tasks[1].defects[2].replace =
    'ORDER BY total_2025; -- per the plugin';
  hasProblem(inDefect, /fx-2-totals: D4 answer contains .*plugin/);

  const inPrompt = copyOf(spec);
  inPrompt.tasks[0].prompt += ' Use the skill.';
  hasProblem(inPrompt, /prompt contains .*skills/);

  const inRubric = copyOf(spec);
  inRubric.tasks[0].rubric[0] = 'Passes the benchmark';
  hasProblem(inRubric, /rubric item contains .*benchmark/);
});

test('the audit catches every form of a harness word, and no ordinary word that only starts like one', () => {
  const forms = [
    'skill',
    'skills',
    'Skill-set',
    'plugin',
    'plugins',
    'benchmark',
    'benchmarks',
    'benchmarking',
    'guidance',
    'directive',
    'directives',
    'with-arm',
    'with arm',
    'withArm',
    'Konductor',
  ];
  for (const word of forms) {
    const ladder = copyOf(spec);
    ladder.tasks[0].base_answer += `\n\nSee the ${word}.`;
    hasProblem(
      ladder,
      /base_answer contains .* which must never reach a judge/,
    );
  }
  // Every pattern is the only match for at least one form, so dropping a pattern fails this test.
  for (const pattern of FORBIDDEN_WORDS)
    assert.ok(
      forms.some(
        (word) =>
          pattern.test(word) &&
          FORBIDDEN_WORDS.filter((other) => other.test(word)).length === 1,
      ),
      `${pattern} is not the only match of any form`,
    );
  for (const word of ['skillful', 'directory', 'benchmarked', 'pluginless']) {
    const ladder = copyOf(spec);
    ladder.tasks[0].base_answer += `\n\nSee the ${word}.`;
    assert.deepEqual(problemsOf(ladder), [], `${word} is an ordinary word`);
  }
});

test('the audit catches a task with too few rubric items or too few defects', () => {
  const ladder = copyOf(spec);
  ladder.tasks[0].rubric = ladder.tasks[0].rubric.slice(0, 2);
  ladder.tasks[0].defects = ladder.tasks[0].defects
    .slice(0, 1)
    .map((defect) => ({ ...defect, rubric_item: 1 }));
  hasProblem(ladder, /fx-1-chunk: needs at least 3 rubric items/);
  hasProblem(ladder, /fx-1-chunk: declares 1 defects, the ladder needs 4/);
  hasProblem(ladder, /D2: fx-1-chunk: dose 2 needs 2 defects, only 1 declared/);
});

test('the audit catches a ladder with no null dose or two doses of one name', () => {
  const noNull = copyOf(spec);
  delete noNull.doses.D0;
  hasProblem(noNull, /doses: no D0, so there is no null test/);

  const sameCount = copyOf(spec);
  sameCount.doses.D3 = 2;
  hasProblem(sameCount, /doses D2 and D3 both apply 2 defects/);
});

test('D0 must be the dose with no defect, and the defect count must grow with the dose number', () => {
  const nullElsewhere = copyOf(spec);
  nullElsewhere.doses = { D0: 1, D1: 0, D2: 2, D4: 4 };
  hasProblem(
    nullElsewhere,
    /doses: D0 applies 1 defects, but D0 is the null test and applies none/,
  );

  const noZero = copyOf(spec);
  noZero.doses = { D0: 1, D1: 2, D2: 3, D4: 4 };
  hasProblem(noZero, /doses: D0 applies 1 defects, but D0 is the null test/);

  const absent = copyOf(spec);
  absent.doses = { D1: 0, D2: 2, D4: 4 };
  hasProblem(absent, /doses: no D0, so there is no null test/);

  const falling = copyOf(spec);
  falling.doses = { D0: 0, D1: 4, D2: 1, D4: 2 };
  hasProblem(
    falling,
    /doses: D2 applies 1 defects, not more than D1 \(4\), so the count does not grow/,
  );
  assert.equal(
    problemsOf(falling).filter((problem) => /does not grow/.test(problem))
      .length,
    1,
    'only D2 falls below the dose before it',
  );

  // The order of the keys does not matter, only the dose numbers.
  const shuffled = copyOf(spec);
  shuffled.doses = { D4: 4, D0: 0, D2: 2, D1: 1 };
  assert.deepEqual(problemsOf(shuffled), []);

  // Dose numbers compare as numbers: D10 comes after D2.
  const tens = copyOf(spec);
  tens.doses = { D0: 0, D1: 1, D2: 2, D10: 4 };
  assert.deepEqual(problemsOf(tens), []);
});

test('the audit catches a paraphrase that carries a defect, because then the null dose is a dose', () => {
  const ladder = copyOf(spec);
  const defect = ladder.tasks[0].defects[1];
  ladder.tasks[0].paraphrase = [{ find: defect.find, replace: defect.replace }];
  hasProblem(
    ladder,
    /fx-1-chunk: D0 paraphrase carries the replacement of defect 1 edit 0, so it is not a clean null test/,
  );

  // A defect that deletes text has an empty replacement, which every text holds: it is not evidence.
  const deletion = copyOf(spec);
  deletion.tasks[0].defects[3] = {
    rubric_item: 4,
    breaks: 'drops the usage example',
    find: 'Example:\n\n```js\nchunk([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]\n```\n\n',
    replace: '',
  };
  assert.deepEqual(
    problemsOf(deletion).filter((p) => /carries/.test(p)),
    [],
  );

  // A replacement that is already in the baseline stays in the paraphrase without being a defect.
  const present = copyOf(spec);
  present.tasks[0].defects[3] = {
    rubric_item: 4,
    breaks: 'x',
    find: 'Example:',
    replace: 'chunks.push',
  };
  assert.ok(answerAtDose(present.tasks[0], 0).includes('chunks.push'));
  assert.deepEqual(
    problemsOf(present).filter((p) => /carries/.test(p)),
    [],
  );
});

test('the audit refuses a ladder of the wrong shape and names each problem', () => {
  const cases = [
    [(ladder) => delete ladder.tasks, /ladder is missing tasks/],
    [(ladder) => (ladder.dosees = {}), /ladder has an unknown field "dosees"/],
    [
      (ladder) => (ladder.set = 'Dose Ladder'),
      /set "Dose Ladder" must be lowercase/,
    ],
    [
      (ladder) => (ladder.doses = {}),
      /doses must be an object with at least one dose/,
    ],
    [
      (ladder) => (ladder.doses = { D0: 0, 'dose-1': 1 }),
      /dose "dose-1" must be D and a number/,
    ],
    [
      (ladder) => (ladder.doses.D1 = 1.5),
      /dose D1 must be a whole number of defects/,
    ],
    [
      (ladder) => (ladder.doses.D1 = -1),
      /dose D1 must be a whole number of defects, 0 or more/,
    ],
    [
      (ladder) => (ladder.doses.D01 = 3),
      /doses D1 and D01 have the same number/,
    ],
    [(ladder) => (ladder.tasks = []), /tasks must be a non-empty list/],
    [
      (ladder) => (ladder.tasks[1].id = ladder.tasks[0].id),
      /task 1 id fx-1-chunk is used twice/,
    ],
    [
      (ladder) => (ladder.tasks[1].id = 'FX-1-CHUNK'),
      /task 1 id FX-1-CHUNK differs only by case from fx-1-chunk, and a file system that ignores case/,
    ],
    [
      (ladder) => (ladder.tasks[0].id = '../up'),
      /task 0 id "\.\.\/up" is not a safe name/,
    ],
    [
      (ladder) => (ladder.tasks[0].hint = 'x'),
      /task 0 has an unknown field "hint"/,
    ],
    [
      (ladder) => delete ladder.tasks[0].paraphrase,
      /task 0 is missing paraphrase/,
    ],
    [
      (ladder) => (ladder.tasks[0].paraphrase = []),
      /task 0 paraphrase must be a non-empty list of edits/,
    ],
    [
      (ladder) => (ladder.tasks[0].prompt = ''),
      /task 0 prompt must be a non-empty string/,
    ],
    [
      (ladder) => (ladder.tasks[0].base_answer = 7),
      /task 0 base_answer must be a non-empty string/,
    ],
    [
      (ladder) => (ladder.tasks[0].domain = ''),
      /task 0 domain must be a non-empty string/,
    ],
    [
      (ladder) => (ladder.tasks[0].rubric = ['ok', 3]),
      /task 0 rubric must be a list of non-empty strings/,
    ],
    [
      (ladder) => (ladder.tasks[0].defects = {}),
      /task 0 defects must be a list/,
    ],
    [
      (ladder) => (ladder.tasks[0].defects[0].rubric_item = '1'),
      /task 0 defect 0 rubric_item must be an integer/,
    ],
    [
      (ladder) => (ladder.tasks[0].defects[0].breaks = ''),
      /task 0 defect 0 does not say what it breaks/,
    ],
    [
      (ladder) => delete ladder.tasks[0].defects[0].find,
      /task 0 defect 0 edit 0 has no find string/,
    ],
    [
      (ladder) => (ladder.tasks[0].defects[0].replace = null),
      /task 0 defect 0 edit 0 replace must be a string/,
    ],
    [
      (ladder) =>
        (ladder.tasks[0].defects[0].edits = [{ find: 'a', replace: 'b' }]),
      /task 0 defect 0 has both edits and find\/replace; use one form/,
    ],
    [
      (ladder) => (ladder.tasks[0].paraphrase[0].note = 'x'),
      /task 0 paraphrase edit 0 has an unknown field "note"/,
    ],
  ];
  for (const [damage, pattern] of cases) {
    const ladder = copyOf(spec);
    damage(ladder);
    const audit = validateLadder(ladder);
    assert.equal(audit.ok, false, `${pattern} should fail the audit`);
    assert.deepEqual(
      audit.tasks,
      [],
      'content is not audited until the shape is right',
    );
    assert.equal(audit.sha256, sha256(ladder));
    assert.equal(audit.set, ladder.set);
    hasProblem(ladder, pattern);
  }
  assert.deepEqual(problemsOf(null), ['ladder must be an object']);
  assert.deepEqual(problemsOf([]), ['ladder must be an object']);
});

test('the audit reports every problem at once instead of stopping at the first', () => {
  const ladder = copyOf(spec);
  ladder.tasks[0].defects[0].rubric_item = 99;
  ladder.tasks[1].prompt += ' Use the plugin.';
  const problems = problemsOf(ladder);
  assert.ok(problems.some((problem) => problem.startsWith('fx-1-chunk:')));
  assert.ok(problems.some((problem) => problem.startsWith('fx-2-totals:')));
});

test('cap reads the ladder with his checked reader: a repeated key is refused, not silently overwritten', () => {
  const fs = require('node:fs');
  const { mkScratch } = require('./scratch.js');
  const { parseJson } = require('../../cap/checkedjson.js');
  assert.throws(() => parseJson('{"a": 1, "b": {"c": 1, "c": 2}}', 'x.json'), /has the key "c" twice in b \(line 1\)/);
  assert.deepEqual(parseJson('\uFEFF{"a": [1, {"a": 2}]}', 'x.json'), { a: [1, { a: 2 }] }, 'the same key in different objects is fine');
  const dir = mkScratch('kpl-');
  try {
    const file = path.join(dir, 'ladder.json');
    fs.writeFileSync(file, '{"set": "a", "set": "b", "doses": {}, "tasks": []}');
    assert.throws(() => ladderLib.loadLadder(file), /has the key "set" twice at the top level/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
