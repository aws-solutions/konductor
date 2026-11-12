// SPDX-License-Identifier: Apache-2.0
// Tests for the run layout helpers (scripts/bench/lib/layout.js): the fixed baseline, exclusions, ledger and report paths, and the
// checks that keep a name from climbing out of its folder.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  createLayout,
  REPO_ROOT,
  DEFAULT_RUN_ID,
  LayoutError,
} = require('../../../scripts/bench/lib/layout');
const helpers = require('./helpers');

const ROOT = path.join(path.sep, 'work', 'repo');
const RUN_LAYOUT = createLayout({ root: ROOT, runId: 'r1' });

test('the fixed paths, with run data under bench/out/<run-id> and the ledger outside it', () => {
  const expected = [
    [RUN_LAYOUT.configFile, 'bench/config.json'],
    [RUN_LAYOUT.exclusionsFile, 'bench/exclusions.json'],
    [RUN_LAYOUT.manifestFile, 'bench/baselines/MANIFEST.json'],
    [RUN_LAYOUT.rulesFile('s'), 'bench/baselines/s/rules.json'],
    [RUN_LAYOUT.tasksFile('s', 'b1'), 'bench/baselines/s/tasks-b1.json'],
    [
      RUN_LAYOUT.bucketsFile('s', 'b1'),
      'bench/baselines/s/tasks-b1.buckets.json',
    ],
    [RUN_LAYOUT.ledgerFile, 'bench/out/ledger.jsonl'],
    [RUN_LAYOUT.reportJson, 'bench/out/r1/report.json'],
    [RUN_LAYOUT.reportMd, 'bench/out/r1/report.md'],
    [RUN_LAYOUT.skillMd('s'), 'skills/s/SKILL.md'],
    [RUN_LAYOUT.skillDir('s'), 'skills/s'],
    [RUN_LAYOUT.agentsDir, 'agents'],
    [
      RUN_LAYOUT.answerFile('s', 'b1', 't-1', 'with'),
      'bench/out/r1/answers/s/b1/t-1.with.json',
    ],
    [
      RUN_LAYOUT.answerFile('s', 'b1', 't-1', 'without'),
      'bench/out/r1/answers/s/b1/t-1.without.json',
    ],
    [
      RUN_LAYOUT.checklistFile('s', 'b1', 't-1'),
      'bench/out/r1/checklists/s/b1/t-1.json',
    ],
    [
      RUN_LAYOUT.judgmentFile('items', 's', 'b1', 't-1', 'xai', 'with'),
      'bench/out/r1/judgments/items/s/b1/t-1.xai.with.json',
    ],
    [
      RUN_LAYOUT.judgmentFile('outcome', 's', 'b1', 't-1', 'xai', 'without'),
      'bench/out/r1/judgments/outcome/s/b1/t-1.xai.without.json',
    ],
  ];
  for (const [actual, expectedRelativePath] of expected)
    assert.equal(
      path.relative(ROOT, actual).split(path.sep).join('/'),
      expectedRelativePath,
    );
});

test('two runs get separate run folders and the same baselines; the default root is this checkout', () => {
  const other = createLayout({ root: ROOT, runId: 'r2' });
  assert.notEqual(other.runDir, RUN_LAYOUT.runDir);
  assert.equal(other.rulesFile('s'), RUN_LAYOUT.rulesFile('s'));
  assert.equal(createLayout({ root: ROOT }).runId, DEFAULT_RUN_ID);
  assert.equal(REPO_ROOT, path.resolve(__dirname, '..', '..', '..'));
  assert.equal(createLayout().root, REPO_ROOT);
});

test('a name that could leave its folder is refused', () => {
  for (const unsafeName of [
    ...helpers.UNSAFE_NAMES,
    ...helpers.NON_STRING_NAMES,
  ]) {
    assert.throws(
      () => RUN_LAYOUT.skillMd(unsafeName),
      /unsafe skill/,
      `skill ${JSON.stringify(unsafeName)}`,
    );
    assert.throws(
      () => RUN_LAYOUT.answerFile('s', 'b1', unsafeName, 'with'),
      /unsafe task id/,
      `task ${JSON.stringify(unsafeName)}`,
    );
    assert.throws(
      () => createLayout({ root: ROOT, runId: unsafeName }),
      /unsafe run id/,
      `run ${JSON.stringify(unsafeName)}`,
    );
    assert.throws(
      () => RUN_LAYOUT.tasksFile('s', unsafeName),
      /unsafe batch/,
      `batch ${JSON.stringify(unsafeName)}`,
    );
    assert.throws(
      () => RUN_LAYOUT.judgmentFile('items', 's', 'b1', 't', unsafeName, 1),
      /unsafe seat/,
      `seat ${JSON.stringify(unsafeName)}`,
    );
  }
});

// Every path builder, with the unsafe value in each name position and safe values in the others. A check
// that is deleted from one builder (or from one position of it) fails here.
const NAME_POSITIONS = [
  ['skill', /unsafe skill/, (layout, name) => layout.skillDir(name)],
  ['skill', /unsafe skill/, (layout, name) => layout.skillMd(name)],
  ['skill', /unsafe skill/, (layout, name) => layout.baselineDir(name)],
  ['skill', /unsafe skill/, (layout, name) => layout.rulesFile(name)],
  ['skill', /unsafe skill/, (layout, name) => layout.tasksFile(name, 'b1')],
  ['skill', /unsafe skill/, (layout, name) => layout.bucketsFile(name, 'b1')],
  ['batch', /unsafe batch/, (layout, name) => layout.tasksFile('s', name)],
  ['batch', /unsafe batch/, (layout, name) => layout.bucketsFile('s', name)],
  [
    'skill',
    /unsafe skill/,
    (layout, name) => layout.answerFile(name, 'b1', 't', 'with'),
  ],
  [
    'batch',
    /unsafe batch/,
    (layout, name) => layout.answerFile('s', name, 't', 'with'),
  ],
  [
    'task id',
    /unsafe task id/,
    (layout, name) => layout.answerFile('s', 'b1', name, 'with'),
  ],
  [
    'skill',
    /unsafe skill/,
    (layout, name) => layout.checklistFile(name, 'b1', 't'),
  ],
  [
    'batch',
    /unsafe batch/,
    (layout, name) => layout.checklistFile('s', name, 't'),
  ],
  [
    'task id',
    /unsafe task id/,
    (layout, name) => layout.checklistFile('s', 'b1', name),
  ],
  [
    'skill',
    /unsafe skill/,
    (layout, name) =>
      layout.judgmentFile('items', name, 'b1', 't', 'xai', 'with'),
  ],
  [
    'batch',
    /unsafe batch/,
    (layout, name) =>
      layout.judgmentFile('items', 's', name, 't', 'xai', 'with'),
  ],
  [
    'task id',
    /unsafe task id/,
    (layout, name) =>
      layout.judgmentFile('items', 's', 'b1', name, 'xai', 'with'),
  ],
  [
    'seat',
    /unsafe seat/,
    (layout, name) => layout.judgmentFile('items', 's', 'b1', 't', name, 1),
  ],
  [
    'run id',
    /unsafe run id/,
    (layout, name) => createLayout({ root: ROOT, runId: name }),
  ],
];
test('every path builder refuses an unsafe name in every position that takes one', () => {
  for (const [position, message, build] of NAME_POSITIONS)
    for (const unsafeName of [
      ...helpers.UNSAFE_NAMES,
      ...helpers.NON_STRING_NAMES,
    ])
      assert.throws(
        () => build(RUN_LAYOUT, unsafeName),
        message,
        `${position} ${JSON.stringify(unsafeName)} in ${build}`,
      );
});

test('the run id ledger.jsonl is refused, in any letter case, because bench/out/ledger.jsonl is the spend ledger', () => {
  for (const runId of ['ledger.jsonl', 'Ledger.jsonl', 'LEDGER.JSONL'])
    assert.throws(
      () => createLayout({ root: ROOT, runId }),
      (error) =>
        error instanceof LayoutError &&
        /run id .* is reserved/.test(error.message) &&
        error.message.includes(JSON.stringify(runId)),
      runId,
    );
  // Near misses are ordinary run ids, and none of them is the ledger path.
  for (const runId of [
    'ledger',
    'ledger.json',
    'ledger.jsonl.1',
    'my-ledger.jsonl',
  ])
    assert.notEqual(
      createLayout({ root: ROOT, runId }).runDir,
      RUN_LAYOUT.ledgerFile,
      runId,
    );
  assert.notEqual(RUN_LAYOUT.runDir, RUN_LAYOUT.ledgerFile);
});

test('a seat name cannot contain ".", because the judgment file name joins task, seat and arm with dots', () => {
  for (const seat of ['b.c', 'a.b', 'x.1', 'Task_1.v2'])
    assert.throws(
      () => RUN_LAYOUT.judgmentFile('items', 's', 'b1', 't', seat, 'with'),
      (error) =>
        error instanceof LayoutError && /unsafe seat/.test(error.message),
      seat,
    );
});

test('two different (task, seat) pairs never share a judgment file', () => {
  const taskA = RUN_LAYOUT.judgmentFile('items', 's', 'b1', 'a.b', 'c', 'with');
  assert.equal(path.basename(taskA), 'a.b.c.with.json');
  // The same file name the other way round must be refused, not built.
  assert.throws(
    () => RUN_LAYOUT.judgmentFile('items', 's', 'b1', 'a', 'b.c', 'with'),
    LayoutError,
  );

  // Every task id and seat from the shared name table, in both scales and both arms. A pair the layout
  // refuses cannot collide; every pair it builds must have a path of its own.
  const names = helpers.NAME_CASES.map(([name]) => name);
  const owner = new Map();
  for (const scale of ['items', 'outcome'])
    for (const arm of ['with', 'without'])
      for (const task of names)
        for (const seat of names) {
          let file;
          try {
            file = RUN_LAYOUT.judgmentFile(scale, 's', 'b1', task, seat, arm);
          } catch (error) {
            if (!(error instanceof LayoutError)) throw error;
            continue;
          }
          const pair = JSON.stringify([scale, task, seat, arm]);
          assert.ok(
            !owner.has(file),
            `${pair} and ${owner.get(file)} both build ${file}`,
          );
          owner.set(file, pair);
        }
  assert.ok(owner.size > 100);
});

test('a seat name is lowercase, so two seats never differ only in case (macOS and Windows ignore case in file names)', () => {
  for (const seat of ['A', 'Xai', 'xAI', 'OpenAI', 'Z9', 'a-B'])
    assert.throws(
      () => RUN_LAYOUT.judgmentFile('items', 's', 'b1', 't', seat, 'with'),
      (error) =>
        error instanceof LayoutError && /unsafe seat/.test(error.message),
      seat,
    );

  // On a file system that ignores case, two paths that differ only in case are one file. Every seat the
  // layout accepts must map to a path of its own even after lowercasing, for every task id and scale.
  const seats = helpers.NAME_CASES.map(([name]) => name);
  for (const scale of ['items', 'outcome'])
    for (const [task] of helpers.NAME_CASES.filter(
      ([, isSegment]) => isSegment,
    )) {
      const built = new Map();
      for (const seat of seats) {
        let file;
        try {
          file = RUN_LAYOUT.judgmentFile(scale, 's', 'b1', task, seat, 'with');
        } catch (error) {
          if (!(error instanceof LayoutError)) throw error;
          continue;
        }
        const folded = file.toLowerCase();
        assert.ok(
          !built.has(folded),
          `seats ${JSON.stringify(seat)} and ${JSON.stringify(built.get(folded))} build the same file when case is ignored`,
        );
        built.set(folded, seat);
      }
    }
});

test('the longest names the layout accepts build file names that fit the 255-byte limit, and the files can be created', () => {
  const FILE_NAME_LIMIT = 255; // bytes: APFS, ext4 and NTFS
  const longTask = 'x'.repeat(128);
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir, runId: 'r'.repeat(128) });
    const create = (file) => {
      assert.ok(
        Buffer.byteLength(path.basename(file)) <= FILE_NAME_LIMIT,
        `${path.basename(file).length} characters: ${path.basename(file)}`,
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{}');
      assert.ok(fs.existsSync(file), file);
    };

    // A seat of every length: the layout refuses it, or the judgment file it builds can be created. The
    // arm is the longer of the two (`without`).
    let longestSeat = 0;
    for (let length = 1; length <= 130; length++) {
      const seat = 'y'.repeat(length);
      let file;
      try {
        file = layout.judgmentFile(
          'outcome',
          's'.repeat(128),
          'b'.repeat(128),
          longTask,
          seat,
          'without',
        );
      } catch (error) {
        if (!(error instanceof LayoutError)) throw error;
        continue;
      }
      longestSeat = length;
      create(file);
    }
    assert.ok(
      longestSeat >= 32,
      'a seat limit that still fits real model names',
    );

    const skill = 's'.repeat(128);
    const batch = 'b'.repeat(128);
    create(layout.answerFile(skill, batch, longTask, 'without'));
    create(layout.checklistFile(skill, batch, longTask));
    create(layout.tasksFile(skill, batch));
    create(layout.bucketsFile(skill, batch));
  });
});

test('every name that is a path segment builds a path', () => {
  for (const [name] of helpers.NAME_CASES.filter(
    ([, isSegment]) => isSegment,
  )) {
    assert.doesNotThrow(() => RUN_LAYOUT.skillMd(name), JSON.stringify(name));
    assert.doesNotThrow(
      () => RUN_LAYOUT.tasksFile('s', name),
      JSON.stringify(name),
    );
    assert.doesNotThrow(
      () => RUN_LAYOUT.checklistFile('s', 'b1', name),
      JSON.stringify(name),
    );
  }
});

test('every refusal is a LayoutError, so a caller can tell it from a bug', () => {
  const refusals = [
    () => RUN_LAYOUT.skillMd('../x'),
    () => RUN_LAYOUT.tasksFile('s', '-x'),
    () => RUN_LAYOUT.answerFile('s', 'b1', '../evil', 'with'),
    () => RUN_LAYOUT.answerFile('s', 'b1', 't', 'both'),
    () => RUN_LAYOUT.judgmentFile('items', 's', 'b1', 't', 'xai', 1),
  ];
  for (const refuse of refusals)
    assert.throws(
      refuse,
      (error) =>
        error instanceof LayoutError &&
        error instanceof Error &&
        error.name === 'LayoutError',
    );
  assert.throws(() => createLayout({ root: ROOT, runId: '../x' }), LayoutError);
});

test('an arm or scale outside the known values is refused', () => {
  assert.throws(
    () => RUN_LAYOUT.answerFile('s', 'b1', 't', 'both'),
    /arm must be one of with, without/,
  );
  assert.throws(
    () => RUN_LAYOUT.judgmentFile('blind', 's', 'b1', 't', 'xai', 'with'),
    /scale must be one of items, outcome/,
  );
  // A judgment file is named after the arm of the answer it scored; a number or any other value is refused.
  for (const arm of [1, 2, 0, 'both', 'With', '', undefined])
    assert.throws(
      () => RUN_LAYOUT.judgmentFile('items', 's', 'b1', 't', 'xai', arm),
      /arm must be one of with, without/,
    );
});

test('batches() lists the task files of a baseline folder, sorted, and ignores everything else', () => {
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    assert.deepEqual(
      layout.batches('absent'),
      [],
      'no folder means no batches',
    );
    fs.mkdirSync(layout.baselineDir('s'), { recursive: true });
    for (const name of [
      'tasks-b2.json',
      'tasks-b1.json',
      'tasks-b1.buckets.json',
      'tasks-B3.json',
      'tasks--x.json',
      'tasks-b_4.json',
      'rules.json',
      'summary.json',
      'tasks-.json',
      'notes.txt',
    ]) {
      helpers.write(path.join(layout.baselineDir('s'), name), '{}');
    }
    assert.deepEqual(layout.batches('s'), ['b1', 'b2']);
  });
});

test('batches() sorts its result whatever order the directory listing comes in (ext4 and APFS list in different orders)', (t) => {
  const layout = createLayout({ root: ROOT });
  t.mock.method(fs, 'readdirSync', () => [
    'tasks-b3.json',
    'tasks-b10.json',
    'tasks-b1.json',
    'tasks-b2.json',
  ]);
  assert.deepEqual(layout.batches('s'), ['b1', 'b10', 'b2', 'b3']);
});

test('bench/out is git-ignored and bench/baselines is not', () => {
  const getIgnoreStatus = (checkedPath) =>
    spawnSync('git', ['check-ignore', '-q', checkedPath], { cwd: REPO_ROOT })
      .status; // 0 ignored, 1 not
  assert.deepEqual(
    [
      'bench/out/ledger.jsonl',
      'bench/out/default/report.json',
      'bench/baselines/s/rules.json',
      'bench/exclusions.json',
    ].map(getIgnoreStatus),
    [0, 0, 1, 1],
  );
});
