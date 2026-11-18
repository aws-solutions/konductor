// SPDX-License-Identifier: Apache-2.0
// Tests for the dose ladder (scripts/bench/lib/dose-ladder.js): the committed test ladder passes its own audit, a
// dose applies exactly the declared defects, D0 changes wording only, the audit catches the mistakes it exists to
// catch, and the writer puts authored answer records in the run layout. They read the small committed ladder in
// tests/fixtures/bench/dose-ladder/. No process is started and no model is called.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ladderLib = require('../../../scripts/bench/lib/dose-ladder');
const { ARM_BLINDING_VERSION } = require('../../../scripts/bench/lib/arms');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const {
  PROVENANCE_VERSION,
  sha256,
} = require('../../../scripts/bench/lib/provenance');
const { JsonFileError } = require('../../../scripts/bench/lib/read-file');
const helpers = require('./helpers');

const {
  LadderError,
  loadLadder,
  editsOf,
  applyEdits,
  answerAtDose,
  itemName,
  itemNames,
  buildPairs,
  assembleLadder,
  validateLadder,
  writeLadderAnswers,
  FORBIDDEN_WORDS,
} = ladderLib;

const LADDER_FILE = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'bench',
  'dose-ladder',
  'ladder-small.json',
);
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
const digestOf = (assembled, item, taskId, arm = 'with') =>
  assembled.items[item].tasks.find((task) => task.id === taskId).input_sha256[
    arm
  ];

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

test('the audit catches a harness word in a task id or domain, because the title is built from them', () => {
  const forms = [
    'skill',
    'skills',
    'plugin',
    'plugins',
    'benchmark',
    'benchmarks',
    'benchmarking',
    'guidance',
    'directive',
    'directives',
    'with-arm',
    'konductor',
  ];
  for (const word of forms) {
    const inId = copyOf(spec);
    inId.tasks[0].id = `fx-${word}-chunk`;
    hasProblem(
      inId,
      /^fx-[a-z-]+-chunk: id contains .* which must never reach a judge$/,
    );
    const inDomain = copyOf(spec);
    inDomain.tasks[1].domain = `${word} tooling`;
    hasProblem(
      inDomain,
      /^fx-2-totals: domain contains .* which must never reach a judge$/,
    );
  }
  // The problem names the field, and only the field that holds the word.
  const both = copyOf(spec);
  both.tasks[0].id = 'fx-skill-chunk';
  assert.deepEqual(
    problemsOf(both).filter((problem) => /domain contains/.test(problem)),
    [],
  );
  assert.equal(
    problemsOf(both).filter((problem) => /id contains/.test(problem)).length,
    1,
  );
  const domainOnly = copyOf(spec);
  domainOnly.tasks[1].domain = 'plugin tooling';
  assert.deepEqual(
    problemsOf(domainOnly).filter((problem) => /id contains/.test(problem)),
    [],
  );
  for (const word of ['skillful', 'directory', 'benchmarked']) {
    const ladder = copyOf(spec);
    ladder.tasks[0].id = `fx-${word}`;
    ladder.tasks[0].domain = `${word} tooling`;
    assert.deepEqual(problemsOf(ladder), [], `${word} is an ordinary word`);
  }
  // A task without a domain has nothing to scan there.
  const noDomain = copyOf(spec);
  delete noDomain.tasks[1].domain;
  assert.deepEqual(problemsOf(noDomain), []);
  // The writer refuses it before writing anything.
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    const ladder = copyOf(spec);
    ladder.tasks[0].id = 'fx-skill-chunk';
    assert.throws(
      () => writeLadderAnswers({ ladder, layout }),
      (error) =>
        error instanceof LadderError &&
        /id contains .*skills/.test(error.message),
    );
    assert.equal(fs.existsSync(layout.runDir), false, 'nothing is written');
  });
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
      (ladder) => (ladder.doses = { D0: 0, D1x: 1 }),
      /dose "D1x" must be D and a number/,
    ],
    [
      (ladder) => (ladder.doses = { D0: 0, D123: 1 }),
      /dose "D123" must be D and a number/,
    ],
    [
      (ladder) => (ladder.doses = { D0: 0, 'D1/../x': 1 }),
      /dose "D1\/\.\.\/x" must be D and a number/,
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
      (ladder) => {
        const defect = ladder.tasks[0].defects[0];
        defect.edits = [{ find: defect.find, replace: defect.replace }];
        delete defect.find;
      },
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

test('the audit reports a missing ladder as a problem instead of throwing', () => {
  const audit = validateLadder(undefined);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.problems, ['ladder must be an object']);
  assert.deepEqual(audit.tasks, []);
  assert.equal(audit.set, null);
  assert.equal(audit.sha256, sha256(null), 'undefined digests like null');
  assert.deepEqual(validateLadder().problems, ['ladder must be an object']);
  // Only a missing ladder digests as null: other falsy values keep their own digest.
  for (const falsy of [0, false])
    assert.equal(validateLadder(falsy).sha256, sha256(falsy));
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    assert.throws(
      () => writeLadderAnswers({ ladder: undefined, layout }),
      (error) =>
        error instanceof LadderError &&
        /failed its audit:\n {2}ladder must be an object/.test(error.message),
    );
  });
});

test('the audit reports every problem at once instead of stopping at the first', () => {
  const ladder = copyOf(spec);
  ladder.tasks[0].defects[0].rubric_item = 99;
  ladder.tasks[1].prompt += ' Use the plugin.';
  const problems = problemsOf(ladder);
  assert.ok(problems.some((problem) => problem.startsWith('fx-1-chunk:')));
  assert.ok(problems.some((problem) => problem.startsWith('fx-2-totals:')));
});

test('loadLadder names the file when it is not usable JSON', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{"set": "a", "set": "b"}');
    assert.throws(() => loadLadder(file), JsonFileError);
    assert.throws(
      () => validateLadder(file),
      new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });
});

test('assemble produces one item per dose, with two authored answer records per pair', () => {
  const assembled = assembleLadder(LADDER_FILE);
  assert.deepEqual(Object.keys(assembled.items), itemNames(spec));
  assert.equal(
    assembled.pairCount,
    Object.keys(spec.doses).length * spec.tasks.length,
  );
  assert.equal(
    assembled.answers.length,
    assembled.pairCount * 2,
    'with and without per pair',
  );
  assert.equal(assembled.sha256, sha256(spec));
  for (const [item, entry] of Object.entries(assembled.items)) {
    assert.equal(entry.item, item);
    assert.equal(entry.kind, 'fixture');
    assert.equal(entry.set, spec.set);
    assert.equal(entry.declared_defects, spec.doses[entry.dose]);
    assert.deepEqual(
      entry.tasks.map((task) => task.id),
      spec.tasks.map((task) => task.id),
    );
    for (const task of entry.tasks) {
      assert.match(task.input_sha256.with, /^[0-9a-f]{64}$/);
      assert.match(task.input_sha256.without, /^[0-9a-f]{64}$/);
      assert.notEqual(task.input_sha256.with, task.input_sha256.without);
    }
  }
  const pairs = buildPairs(spec);
  for (const { item, taskId, arm, record } of assembled.answers) {
    const pair = pairs.find(
      (candidate) => candidate.item === item && candidate.task_id === taskId,
    );
    assert.equal(record.kind, 'fixture');
    assert.equal(record.set, spec.set);
    assert.equal(record.dose, pair.dose);
    assert.deepEqual(Object.keys(record.inputs).sort(), [
      'answer_sha256',
      'arm',
      'dose',
      'input_sha256',
      'kind',
      'provenance_version',
      'request_sha256',
      'set',
      'task_sha256',
    ]);
    assert.equal(record.skill, item);
    assert.equal(record.task_id, taskId);
    assert.equal(record.arm, arm);
    assert.equal(record.text, pair[arm]);
    assert.equal(record.answer_sha256, sha256(pair[arm]));
    assert.equal(record.inputs.answer_sha256, record.answer_sha256);
    assert.equal(record.inputs.arm, arm);
    assert.equal(record.inputs.provenance_version, PROVENANCE_VERSION);
    assert.equal(
      record.inputs.request_sha256,
      sha256({ task_id: taskId, prompt: pair.prompt }),
    );
    assert.equal(
      record.inputs.input_sha256,
      assembled.items[item].tasks.find((task) => task.id === taskId)
        .input_sha256[arm],
    );
    const { input_sha256: digest, ...digested } = record.inputs;
    assert.equal(
      digest,
      sha256(digested),
      'the digest covers exactly the recorded inputs',
    );
    assert.equal(record.arm_blinding_version, ARM_BLINDING_VERSION);
    assert.equal(record.ok, true);
    assert.equal(
      record.skill_load.loaded,
      arm === 'with',
      "loaded follows the arm, as a generated answer's does",
    );
    assert.equal(record.skill_load.note, 'authored answer, nothing was loaded');
    assert.deepEqual(record.skill_load.attempts, []);
    assert.deepEqual(record.skill_load.otherSkillLoads, []);
    assert.equal(record.est_usd, 0);
    assert.equal(record.reported_usd, 0);
  }
  // Each record has its own skill-load object, so a caller changing one cannot change another.
  assembled.answers[0].record.skill_load.attempts.push('x');
  assert.deepEqual(assembled.answers[1].record.skill_load.attempts, []);
});

test('the skill-load entry is not an input of the answer digest, so stored judgments stay current', () => {
  const assembled = assembleLadder(LADDER_FILE);
  // Pinned values: a change here would make every stored judgment stale.
  const all = assembled.answers.map(
    ({ item, taskId, arm, record }) =>
      `${item}/${taskId}/${arm}=${record.inputs.input_sha256}`,
  );
  assert.equal(all.length, 16);
  assert.equal(
    all[0],
    'fixture-d0/fx-1-chunk/with=1f43c902580593d23868d68cb716ed3ebc2e98e7c1b8872f23f30ab4187b9ac7',
  );
  assert.equal(
    all[1],
    'fixture-d0/fx-1-chunk/without=2dd3059d877d7f2cafba64e0b2f31b6d5a5f5ec1ce313e2d915912772dc8b7a0',
  );
  assert.equal(
    sha256(all),
    'dfa49ad48c18c24ecf6f901f7a66c457bdfac2242e5fb44a5557877bdd5b8f9f',
  );
  for (const { record } of assembled.answers) {
    assert.equal(
      Object.keys(record.inputs).includes('skill_load'),
      false,
      'the entry is not in the digested fields',
    );
  }
  // The pair digests of the items are the same two values.
  for (const entry of Object.values(assembled.items))
    for (const task of entry.tasks)
      for (const arm of ['with', 'without'])
        assert.equal(
          task.input_sha256[arm],
          assembled.answers.find(
            (answer) =>
              answer.item === entry.item &&
              answer.taskId === task.id &&
              answer.arm === arm,
          ).record.inputs.input_sha256,
        );
});

test('a stored without answer that says it loaded the skill is rewritten, and its digest stays the same', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    writeLadderAnswers({ ladder: spec, layout });
    const files = answerFiles(layout);
    const withoutFiles = files.filter((file) => file.endsWith('.without.json'));
    const withFiles = files.filter((file) => file.endsWith('.with.json'));
    assert.equal(withoutFiles.length, 8);
    for (const file of withoutFiles)
      assert.equal(helpers.readJson(file).skill_load.loaded, false, file);
    for (const file of withFiles)
      assert.equal(helpers.readJson(file).skill_load.loaded, true, file);
    // A stored record in which the without answer says it loaded the skill.
    const target = withoutFiles[3];
    const digestBefore = helpers.readJson(target).inputs.input_sha256;
    const legacy = helpers.readJson(target);
    legacy.skill_load.loaded = true;
    helpers.write(target, legacy);
    const again = writeLadderAnswers({ ladder: spec, layout });
    assert.deepEqual(again.written, [target]);
    assert.equal(again.unchanged, files.length - 1);
    const fixed = helpers.readJson(target);
    assert.equal(fixed.skill_load.loaded, false);
    assert.equal(fixed.inputs.input_sha256, digestBefore);
  });
});

test('a ladder edit moves the digests, so pairs judged under the old ladder stop counting', () => {
  const before = assembleLadder(spec);
  const edited = copyOf(spec);
  edited.tasks[0].base_answer += '\n\nOne more sentence.';
  const after = assembleLadder(edited);
  assert.notEqual(before.sha256, after.sha256);
  assert.notEqual(
    digestOf(before, 'fixture-d1', 'fx-1-chunk'),
    digestOf(after, 'fixture-d1', 'fx-1-chunk'),
    'the pair digest must move with the ladder content',
  );
});

test('a prompt edit moves both arms of that task, even though the answers are the same', () => {
  const before = assembleLadder(spec);
  const edited = copyOf(spec);
  edited.tasks[1].prompt += ' Use standard SQL.';
  const after = assembleLadder(edited);
  for (const arm of ['with', 'without'])
    assert.notEqual(
      digestOf(before, 'fixture-d2', 'fx-2-totals', arm),
      digestOf(after, 'fixture-d2', 'fx-2-totals', arm),
    );
});

test('appending a task leaves the existing tasks digests untouched, so judged pairs survive', () => {
  const before = assembleLadder(spec);
  const grown = copyOf(spec);
  grown.tasks.push({ ...copyOf(spec.tasks[0]), id: 'fx-99-extra' });
  const after = assembleLadder(grown);
  for (const item of itemNames(spec))
    for (const task of spec.tasks)
      for (const arm of ['with', 'without'])
        assert.equal(
          digestOf(before, item, task.id, arm),
          digestOf(after, item, task.id, arm),
          `${item} ${task.id} ${arm} digest moved when a task was appended`,
        );
  assert.ok(after.pairCount > before.pairCount);
});

test('editing a task still invalidates that task pairs and no others', () => {
  const before = assembleLadder(spec);
  const edited = copyOf(spec);
  edited.tasks[0].base_answer += '\n\nOne more sentence.';
  const after = assembleLadder(edited);
  for (const item of itemNames(spec)) {
    assert.notEqual(
      digestOf(before, item, 'fx-1-chunk'),
      digestOf(after, item, 'fx-1-chunk'),
    );
    assert.equal(
      digestOf(before, item, 'fx-2-totals'),
      digestOf(after, item, 'fx-2-totals'),
    );
  }
});

/** The answer files of the committed ladder under a layout, in assemble order. */
const answerFiles = (layout, batch = spec.set) =>
  assembleLadder(spec).answers.map((answer) =>
    layout.answerFile(answer.item, batch, answer.taskId, answer.arm),
  );
const listFiles = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .filter((name) => fs.statSync(path.join(dir, name)).isFile())
    : [];

test('the writer puts each authored answer at its answer path, and a second write changes nothing', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'ladder-run' });
    const first = writeLadderAnswers({ ladder: LADDER_FILE, layout });
    const expectedFiles = answerFiles(layout);
    assert.equal(first.set, spec.set);
    assert.equal(first.batch, spec.set);
    assert.equal(first.sha256, sha256(spec));
    assert.equal(first.pairCount, 8);
    assert.deepEqual(first.written, expectedFiles);
    assert.equal(first.unchanged, 0);
    assert.equal(
      expectedFiles[0],
      path.join(
        root,
        'bench',
        'out',
        'ladder-run',
        'answers',
        'fixture-d0',
        'dose-ladder-test',
        'fx-1-chunk.with.json',
      ),
    );
    const records = assembleLadder(spec).answers;
    expectedFiles.forEach((file, index) => {
      assert.deepEqual(helpers.readJson(file), records[index].record);
      assert.equal(
        fs.readFileSync(file, 'utf8'),
        `${JSON.stringify(records[index].record, null, 2)}\n`,
        'two-space JSON with a final newline',
      );
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        // Every folder the writer made below the temporary root is private.
        for (
          let folder = path.dirname(file);
          folder !== root;
          folder = path.dirname(folder)
        )
          assert.equal(
            fs.statSync(folder).mode & 0o777,
            0o700,
            `${folder} is private`,
          );
      }
    });
    assert.equal(
      listFiles(layout.runDir).length,
      expectedFiles.length,
      'no temporary file is left behind',
    );

    const second = writeLadderAnswers({ ladder: spec, layout });
    assert.deepEqual(
      second.written,
      [],
      're-running must not rewrite unchanged answers',
    );
    assert.equal(second.unchanged, expectedFiles.length);
  });
});

test('the writer takes another batch name when one is given, and refuses a bad one', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    const result = writeLadderAnswers({ ladder: spec, layout, batch: 'b2' });
    assert.equal(result.batch, 'b2');
    assert.deepEqual(result.written, answerFiles(layout, 'b2'));
    assert.throws(
      () => writeLadderAnswers({ ladder: spec, layout, batch: 'B 2' }),
      /batch "B 2" is not a valid batch name/,
    );
  });
});

test('the writer refuses a ladder that fails its audit, and writes nothing', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    const broken = copyOf(spec);
    broken.tasks[0].defects[0].rubric_item = 99;
    const file = path.join(root, 'bad.json');
    helpers.write(file, broken);
    for (const ladder of [broken, file]) {
      assert.throws(() => writeLadderAnswers({ ladder, layout }), LadderError);
      assert.throws(
        () => writeLadderAnswers({ ladder, layout }),
        /dose ladder dose-ladder-test failed its audit:\n {2}fx-1-chunk: defect 0 names rubric item 99/,
      );
    }
    assert.throws(
      () => writeLadderAnswers({ ladder: { tasks: [] }, layout }),
      /dose ladder \(no set name\) failed its audit/,
    );
    assert.equal(
      fs.existsSync(layout.runDir),
      false,
      'a failed audit must write nothing',
    );
  });
});

test('the writer needs a run layout', () => {
  assert.throws(() => writeLadderAnswers({ ladder: spec }), TypeError);
  assert.throws(() => writeLadderAnswers(), /layout must be a run layout/);
});

test('the writer never replaces a stored answer that is not an authored one, and then writes nothing', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    const files = answerFiles(layout);
    const target = files[files.length - 1];
    fs.mkdirSync(path.dirname(target), { recursive: true });
    helpers.write(target, { kind: 'subject', text: 'a real answer' });
    assert.throws(
      () => writeLadderAnswers({ ladder: spec, layout }),
      /not an authored fixture answer; refusing to replace it/,
    );
    assert.deepEqual(helpers.readJson(target), {
      kind: 'subject',
      text: 'a real answer',
    });
    assert.deepEqual(
      listFiles(layout.runDir),
      [path.relative(layout.runDir, target)],
      'nothing else was written',
    );

    fs.writeFileSync(target, 'not json');
    assert.throws(
      () => writeLadderAnswers({ ladder: spec, layout }),
      JsonFileError,
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'not json');
  });
});

test('the writer rewrites a stored record whose text no longer matches its digest', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    writeLadderAnswers({ ladder: spec, layout });
    const target = answerFiles(layout)[3];
    helpers.update(target, (record) => {
      record.text += ' changed by hand';
    });
    const again = writeLadderAnswers({ ladder: spec, layout });
    assert.deepEqual(again.written, [target]);
    assert.equal(
      helpers.readJson(target).text,
      assembleLadder(spec).answers[3].record.text,
    );
  });
});

test('after a task edit the writer rewrites only that task answers', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    writeLadderAnswers({ ladder: spec, layout });
    const edited = copyOf(spec);
    edited.tasks[1].base_answer = edited.tasks[1].base_answer.replace(
      'keeps two customers',
      'keeps any two customers',
    );
    const result = writeLadderAnswers({ ladder: edited, layout });
    const expected = assembleLadder(edited)
      .answers.filter((answer) => answer.taskId === 'fx-2-totals')
      .map((answer) =>
        layout.answerFile(answer.item, spec.set, answer.taskId, answer.arm),
      );
    assert.deepEqual(result.written, expected);
    assert.equal(result.unchanged, 8);
  });
});

test('the writer rewrites a stored record that differs in any field, not only in its text or input digest', () => {
  const damage = {
    'ok flag': (record) => (record.ok = false),
    'estimated cost': (record) => (record.est_usd = 5),
    'reported cost': (record) => (record.reported_usd = 5),
    'answer digest': (record) => (record.answer_sha256 = 'f'.repeat(64)),
    arm: (record) => (record.arm = record.arm === 'with' ? 'without' : 'with'),
    'blinding version': (record) => (record.arm_blinding_version = 0),
    'skill-load entry': (record) => delete record.skill_load,
    dose: (record) => (record.dose = 'D9'),
    'task id': (record) => (record.task_id = 'other'),
    item: (record) => (record.skill = 'fixture-d9'),
    'an added field': (record) => (record.extra = 'x'),
    'input digest': (record) => (record.inputs.input_sha256 = 'f'.repeat(64)),
    'stored inputs': (record) => delete record.inputs,
  };
  for (const [name, change] of Object.entries(damage)) {
    helpers.withTmp((root) => {
      const layout = createLayout({ root, runId: 'r1' });
      writeLadderAnswers({ ladder: spec, layout });
      const files = answerFiles(layout);
      const target = files[5];
      const expected = fs.readFileSync(target, 'utf8');
      helpers.update(target, change);
      assert.notEqual(fs.readFileSync(target, 'utf8'), expected, name);
      const again = writeLadderAnswers({ ladder: spec, layout });
      assert.deepEqual(again.written, [target], `${name} is rewritten`);
      assert.equal(again.unchanged, files.length - 1);
      assert.equal(fs.readFileSync(target, 'utf8'), expected, name);
    });
  }
});

test('the writer leaves a stored record alone when only the order of its keys differs', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    writeLadderAnswers({ ladder: spec, layout });
    const target = answerFiles(layout)[2];
    const reordered = Object.fromEntries(
      Object.entries(helpers.readJson(target)).reverse(),
    );
    helpers.write(target, reordered);
    const before = fs.readFileSync(target, 'utf8');
    const again = writeLadderAnswers({ ladder: spec, layout });
    assert.deepEqual(again.written, []);
    assert.equal(fs.readFileSync(target, 'utf8'), before);
  });
});

test('the writer rewrites a stored authored record that has no inputs or no text, instead of failing partway', () => {
  for (const stored of [
    { kind: 'fixture', text: 'x' },
    { kind: 'fixture', inputs: 5, text: 'x' },
    { kind: 'fixture', inputs: { input_sha256: 'a' } },
    { kind: 'fixture', set: 7 },
  ])
    helpers.withTmp((root) => {
      const layout = createLayout({ root, runId: 'r1' });
      const files = answerFiles(layout);
      const target = files[files.length - 1];
      fs.mkdirSync(path.dirname(target), { recursive: true });
      helpers.write(target, stored);
      const result = writeLadderAnswers({ ladder: spec, layout });
      assert.equal(result.written.length, files.length);
      assert.equal(result.unchanged, 0);
      assert.deepEqual(
        helpers.readJson(target),
        assembleLadder(spec).answers[files.length - 1].record,
      );
    });
});

test('a prompt or rubric edit rewrites that task answers, though the answer text is the same', () => {
  const edits = {
    prompt: (ladder) => (ladder.tasks[1].prompt += ' Use standard SQL.'),
    rubric: (ladder) => (ladder.tasks[1].rubric[0] += ' in every case'),
  };
  for (const [name, edit] of Object.entries(edits))
    helpers.withTmp((root) => {
      const layout = createLayout({ root, runId: 'r1' });
      writeLadderAnswers({ ladder: spec, layout });
      const edited = copyOf(spec);
      edit(edited);
      const result = writeLadderAnswers({ ladder: edited, layout });
      const expected = assembleLadder(edited)
        .answers.filter((answer) => answer.taskId === 'fx-2-totals')
        .map((answer) =>
          layout.answerFile(answer.item, spec.set, answer.taskId, answer.arm),
        );
      assert.deepEqual(result.written, expected, `${name} edit`);
      assert.equal(result.unchanged, 8, `${name} edit`);
    });
});

test('the writer refuses an answer of another set, and writes nothing', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    writeLadderAnswers({ ladder: spec, layout, batch: 'shared' });
    const files = answerFiles(layout, 'shared');
    const before = files.map((file) => fs.readFileSync(file, 'utf8'));
    const other = copyOf(spec);
    other.set = 'other-set';
    other.tasks[0].base_answer += '\n\nOne more sentence.';
    assert.throws(
      () => writeLadderAnswers({ ladder: other, layout, batch: 'shared' }),
      /holds an authored answer from set "dose-ladder-test", not "other-set"; refusing to replace it/,
    );
    assert.deepEqual(
      files.map((file) => fs.readFileSync(file, 'utf8')),
      before,
      'no stored answer changed',
    );
    assert.equal(listFiles(layout.runDir).length, files.length);
  });
});

/** Runs `body` with `fs[name]` replaced by `replacement(original)`; the original is restored afterwards. */
const withPatchedFs = (name, replacement, body) => {
  const original = fs[name];
  fs[name] = replacement(original);
  try {
    return body();
  } finally {
    fs[name] = original;
  }
};
const temporaryFiles = (dir) =>
  listFiles(dir).filter((name) => name.includes('.tmp-'));

test('a failed rename leaves the stored answer as it was and no temporary file', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    writeLadderAnswers({ ladder: spec, layout });
    const files = answerFiles(layout);
    const before = files.map((file) => fs.readFileSync(file, 'utf8'));
    const edited = copyOf(spec);
    edited.tasks[0].base_answer += '\n\nOne more sentence.';
    withPatchedFs(
      'renameSync',
      () => () => {
        throw new Error('rename failed');
      },
      () =>
        assert.throws(
          () => writeLadderAnswers({ ladder: edited, layout }),
          /rename failed/,
        ),
    );
    assert.deepEqual(
      files.map((file) => fs.readFileSync(file, 'utf8')),
      before,
      'a stored answer is replaced whole or not at all',
    );
    assert.deepEqual(temporaryFiles(layout.runDir), []);
  });
});

test('a write that fails on the second file leaves the first complete, and a rerun finishes the set', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    const files = answerFiles(layout);
    let temporaryWrites = 0;
    withPatchedFs(
      'writeFileSync',
      (original) =>
        function patched(file, ...rest) {
          if (String(file).includes('.tmp-') && (temporaryWrites += 1) === 2)
            throw new Error('disk full');
          return original.call(this, file, ...rest);
        },
      () =>
        assert.throws(
          () => writeLadderAnswers({ ladder: spec, layout }),
          /disk full/,
        ),
    );
    assert.deepEqual(
      helpers.readJson(files[0]),
      assembleLadder(spec).answers[0].record,
    );
    assert.equal(fs.existsSync(files[1]), false);
    assert.deepEqual(temporaryFiles(layout.runDir), []);

    const rerun = writeLadderAnswers({ ladder: spec, layout });
    assert.equal(rerun.unchanged, 1);
    assert.deepEqual(rerun.written, files.slice(1));
  });
});

test('the writer reads a ladder path once, so the audit and the answers come from the same text', () => {
  helpers.withTmp((root) => {
    const layout = createLayout({ root, runId: 'r1' });
    let reads = 0;
    withPatchedFs(
      'readFileSync',
      (original) =>
        function patched(file, ...rest) {
          if (file === LADDER_FILE) reads += 1;
          return original.call(this, file, ...rest);
        },
      () => writeLadderAnswers({ ladder: LADDER_FILE, layout }),
    );
    assert.equal(reads, 1);
  });
});

test('a task without a domain gets a null domain in the pair and the item', () => {
  const ladder = copyOf(spec);
  delete ladder.tasks[1].domain;
  assert.deepEqual(problemsOf(ladder), []);
  const pairs = buildPairs(ladder);
  assert.ok(
    pairs
      .filter((pair) => pair.task_id === 'fx-2-totals')
      .every((pair) => pair.domain === null),
  );
  const task = assembleLadder(ladder).items['fixture-d1'].tasks[1];
  assert.equal(task.domain, null);
  assert.equal(validateLadder(ladder).tasks[1].domain, null);
});
