// SPDX-License-Identifier: Apache-2.0
// The driver's `trim` command (scripts/bench/bench.js, scripts/bench/lib/trim.js): which tasks leave a baseline (the
// threshold edge, the per-batch minimum, a task with no judgment), what is refused before any file is touched (an
// untrusted run, a stub run, a missing or stale report, thin coverage, a baseline that differs from the manifest), and
// that task files, bucket files and the manifest stay in step. Most tests write small judgment files and read them back
// through the real taskGaps, with a stand-in (`collect`) for the report `trim` compares them with; one runs the fixture
// skill through the stubbed loop and reads its stored judgments through the real report. No model, AWS or network call
// is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const bench = require('../../../scripts/bench/bench');
const {
  verifyBaselines,
  writeManifest,
} = require('../../../scripts/bench/lib/baseline-manifest');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { UsageError } = require('../../../scripts/bench/lib/cli-args');
const trim = require('../../../scripts/bench/lib/trim');
const helpers = require('./helpers');

const SKILL = helpers.SKILL;
const SEATS = ['anthropic', 'openai', 'xai'];
const RUN = 'r1';

const capture = () => {
  const io = { text: '', errors: '' };
  io.out = (text) => {
    io.text += text;
  };
  io.err = (text) => {
    io.errors += text;
  };
  return io;
};

// ---- decideBatch: the rules on plain numbers ---------------------------------------------------------------------

// A number is a without-arm mean with a perfect with-arm mean (5); [without, with] gives both; null has no judgment.
const entriesOf = (means) =>
  means.map((entry, index) => {
    const [mean, withMean] = Array.isArray(entry)
      ? entry
      : [entry, entry === null ? null : 5];
    return { id: `t${index + 1}`, mean, withMean };
  });
const decide = (means, options = {}) =>
  trim.decideBatch(entriesOf(means), {
    threshold: 4.8,
    minPerBatch: 5,
    ...options,
  });

test('decideBatch: a mean of exactly 4.8 is dropped and 4.79 is kept', () => {
  const result = decide([4.8, 4.79, 3, 3, 3, 3, 3, 3]);
  assert.deepEqual(result.dropped, [
    { id: 't1', without_mean: 4.8, with_mean: 5 },
  ]);
  assert.deepEqual(result.kept, ['t2', 't3', 't4', 't5', 't6', 't7', 't8']);
  assert.deepEqual(result.restored, []);
});

test('decideBatch: a task is dropped only when both arms reach the threshold', () => {
  const result = decide([
    [4.9, 4.9],
    [4.9, 4.2],
    [4.2, 4.9],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
  ]);
  assert.deepEqual(result.dropped, [
    { id: 't1', without_mean: 4.9, with_mean: 4.9 },
  ]);
  assert.deepEqual(result.restored, []);
  assert.deepEqual(result.kept, ['t2', 't3', 't4', 't5', 't6', 't7', 't8']);
});

test('decideBatch: easy without the skill but lower with it stays, and so does the other way round', () => {
  const noDrop = decide([
    [5, 4.79],
    [4.79, 5],
    [5, 1],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
  ]);
  assert.deepEqual(noDrop.dropped, []);
  assert.deepEqual(noDrop.restored, []);
  assert.equal(noDrop.kept.length, 7);
});

test('decideBatch: a task with no with-arm mean is kept, even with a perfect without-arm mean', () => {
  const result = decide([
    [5, null],
    [5, 5],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
  ]);
  assert.deepEqual(
    result.dropped.map((entry) => entry.id),
    ['t2'],
  );
  assert.ok(result.kept.includes('t1'));
});

test('decideBatch: the with-arm mean has the same edge and float tolerance as the without-arm mean', () => {
  const rest = [3, 3, 3, 3, 3, 3];
  assert.deepEqual(
    decide([[5, 4.8], ...rest]).dropped.map((entry) => entry.id),
    ['t1'],
  );
  assert.deepEqual(
    decide([[5, 4.8 - 2e-12], ...rest]).dropped.map((entry) => entry.id),
    ['t1'],
  );
  assert.deepEqual(decide([[5, 4.7999], ...rest]).dropped, []);
  assert.deepEqual(
    decide([[4.8, 4.8], ...rest], { threshold: 4.9 }).dropped,
    [],
  );
});

test('decideBatch: the one task restored for the minimum is the one with the lowest of its two means', () => {
  // By the without-arm mean alone t2 (4.9) would come back; by the lower arm t1 (4.81) does.
  const result = decide([
    [5, 4.81],
    [4.9, 4.9],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
  ]);
  assert.deepEqual(result.restored, [
    { id: 't1', without_mean: 5, with_mean: 4.81 },
  ]);
  assert.deepEqual(result.dropped, [
    { id: 't2', without_mean: 4.9, with_mean: 4.9 },
  ]);
});

test('decideBatch: floating-point noise in a mean of 4.8 does not keep the task, a real shortfall does', () => {
  const noisy = 4.8 - 2e-12;
  assert.notEqual(noisy, 4.8, 'the fixture mean must carry float noise');
  assert.deepEqual(
    decide([noisy, 3, 3, 3, 3, 3, 3, 3]).dropped.map((entry) => entry.id),
    ['t1'],
  );
  assert.deepEqual(decide([4.7999, 3, 3, 3, 3, 3, 3, 3]).dropped, []);
});

test('decideBatch: the threshold is the option, and 5 drops only a perfect mean', () => {
  const means = [5, 4.99, 4.5, 3, 3, 3, 3, 3];
  assert.deepEqual(
    decide(means, { threshold: 5 }).dropped.map((entry) => entry.id),
    ['t1'],
  );
  assert.deepEqual(
    decide(means, { threshold: 4.5 }).dropped.map((entry) => entry.id),
    ['t1', 't2', 't3'],
  );
});

test('decideBatch: a batch keeps at least the minimum, restoring the lowest means first and file order on a tie', () => {
  const result = decide([4.9, 5, 5, 5, 5, 2]);
  assert.deepEqual(result.restored, [
    { id: 't1', without_mean: 4.9, with_mean: 5 },
    { id: 't2', without_mean: 5, with_mean: 5 },
    { id: 't3', without_mean: 5, with_mean: 5 },
    { id: 't4', without_mean: 5, with_mean: 5 },
  ]);
  assert.deepEqual(result.dropped, [
    { id: 't5', without_mean: 5, with_mean: 5 },
  ]);
  assert.deepEqual(result.kept, ['t1', 't2', 't3', 't4', 't6']);
});

test('decideBatch: with nothing but easy tasks the batch keeps the minimum, the lowest first', () => {
  const result = decide([5, 4.9, 4.8, 5, 4.85, 4.95, 5]);
  assert.deepEqual(
    result.restored.map((entry) => entry.id),
    ['t1', 't2', 't3', 't5', 't6'],
  );
  assert.deepEqual(
    result.dropped.map((entry) => entry.id),
    ['t4', 't7'],
  );
  assert.equal(result.kept.length, 5);
});

test('decideBatch: a task with no counted judgment is never dropped, and counts toward the minimum', () => {
  const result = decide([null, null, 5, 5, 5, 5, 5, 5]);
  assert.deepEqual(
    result.dropped.map((entry) => entry.id),
    ['t6', 't7', 't8'],
  );
  assert.deepEqual(
    result.restored.map((entry) => entry.id),
    ['t3', 't4', 't5'],
  );
  assert.ok(result.kept.includes('t1') && result.kept.includes('t2'));
});

test('decideBatch: with more kept tasks than the minimum, every easy task goes and none comes back', () => {
  const result = decide([5, 5, 3, 3, 3, 3, 3, 3]);
  assert.deepEqual(result.dropped, [
    { id: 't1', without_mean: 5, with_mean: 5 },
    { id: 't2', without_mean: 5, with_mean: 5 },
  ]);
  assert.deepEqual(result.restored, []);
  assert.deepEqual(result.kept, ['t3', 't4', 't5', 't6', 't7', 't8']);
});

test('decideBatch: means that are thirds and ninths print to 4 places in the dropped and restored lists', () => {
  const result = decide([44 / 9, 4.9, 3, 3, 3, 3]);
  assert.deepEqual(result.restored, [
    { id: 't1', without_mean: 4.8889, with_mean: 5 },
  ]);
  assert.deepEqual(result.dropped, [
    { id: 't2', without_mean: 4.9, with_mean: 5 },
  ]);
  assert.deepEqual(decide([44 / 9, 3, 3, 3, 3, 3, 3]).dropped, [
    { id: 't1', without_mean: 4.8889, with_mean: 5 },
  ]);
});

test('decideBatch: a batch already at or under the minimum drops nothing', () => {
  const result = decide([5, 5, 5, 5, 5]);
  assert.deepEqual(result.dropped, []);
  assert.equal(result.kept.length, 5);
  assert.equal(result.restored.length, 5);
});

test('--threshold and --min-per-batch accept only plain numbers in range', () => {
  assert.equal(trim.parseThreshold('4.8'), 4.8);
  assert.equal(trim.parseThreshold('5'), 5);
  assert.equal(trim.parseMinPerBatch('5'), 5);
  assert.equal(trim.parseMinPerBatch('12'), 12);
  for (const bad of ['', 'x', '0.9', '5.1', '1e1', '0x4', ' 4', '-4', '4.'])
    assert.throws(() => trim.parseThreshold(bad), /--threshold/, bad);
  for (const bad of ['4', '0', '-5', '5.5', '1e1', 'x', ' 6'])
    assert.throws(() => trim.parseMinPerBatch(bad), /--min-per-batch/, bad);
});

// ---- the command on disk ----------------------------------------------------------------------------------------

/** Seat scores whose mean is `mean` and that differ from each other, so the mean is read over the seats. */
function seatScores(mean) {
  const spread = Math.min(0.2, 5 - mean, mean - 1);
  return [mean + spread, mean - spread, mean];
}

/**
 * The [without, with] reading A means of a task in a batch list: a number is a without-arm mean with a perfect with-arm
 * mean, [without, with] gives both (with null: no with-arm judgment), null is no judgment at all.
 */
const armMeans = (entry) => {
  if (entry === null) return [null, null];
  return Array.isArray(entry) ? entry : [entry, 5];
};

/**
 * A repository root under `dir`: the fixture's skill with one batch per key of `batches`, each a list of tasks with
 * their reading A means (see armMeans; null: no judgment for the task, as for an excluded one). Returns
 * { layout, outcomeJobs, ids }.
 */
function buildRoot(dir, batches) {
  fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
  const layout = createLayout({ root: dir, runId: RUN });
  const folder = path.dirname(layout.tasksFile(SKILL, 'b1'));
  for (const name of fs.readdirSync(folder))
    if (name.startsWith('tasks-')) fs.rmSync(path.join(folder, name));
  fs.rmSync(layout.exclusionsFile);
  const template = helpers.goodTasks();
  const bucketTemplate = helpers.goodBuckets();
  const jobs = [];
  const ids = {};
  for (const [batch, means] of Object.entries(batches)) {
    ids[batch] = means.map((_, index) => `${SKILL}-${batch}-${index + 1}`);
    const tasks = {
      ...template,
      batch,
      rules_sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(layout.rulesFile(SKILL)))
        .digest('hex'),
      scenarios: ids[batch].map((id, index) => ({
        ...template.scenarios[0],
        id,
        title: `Task ${index + 1} of ${batch}`,
        prompt: template.scenarios[0].prompt.replace(
          'Request 1.',
          `Request ${index + 1} of ${batch}.`,
        ),
      })),
    };
    const buckets = {
      ...bucketTemplate,
      batch,
      scenarios: Object.fromEntries(
        ids[batch].map((id) => [
          id,
          bucketTemplate.scenarios[template.scenarios[0].id],
        ]),
      ),
    };
    for (const [file, data] of [
      [layout.tasksFile(SKILL, batch), tasks],
      [layout.bucketsFile(SKILL, batch), buckets],
    ]) {
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
      // A mode the umask would change, so a trim that loses the file mode is seen.
      fs.chmodSync(file, 0o664);
    }
    means.forEach((entry, index) => {
      const [mean, withMean] = armMeans(entry);
      if (mean === null) return;
      const scoreOf = { without: seatScores(mean), with: seatScores(withMean) };
      SEATS.forEach((seat, seatIndex) =>
        ['with', 'without'].forEach((arm) => {
          // A task whose with-arm judgments are missing has no with-arm mean and does not count in reading A.
          if (arm === 'with' && withMean === null) return;
          const file = layout.judgmentFile(
            'outcome',
            SKILL,
            batch,
            ids[batch][index],
            seat,
            arm,
          );
          fs.mkdirSync(path.dirname(file), { recursive: true });
          helpers.write(file, {
            kind: 'judgment',
            status: 'valid',
            scale: 'outcome',
            seat,
            arm,
            score: scoreOf[arm][seatIndex],
            guard: null,
          });
          jobs.push({
            skill: SKILL,
            batch,
            task: { id: ids[batch][index] },
            scale: 'outcome',
            seat,
            arm,
            state: 'done',
            file,
          });
        }),
      );
    });
  }
  writeManifest(layout);
  assert.deepEqual(verifyBaselines(layout).problems, []);
  return { layout, outcomeJobs: { [SKILL]: jobs }, ids };
}

/** The report `trim` compares with the judgments: what `report` would print for these batches. */
function reportFor(batches, overrides = {}) {
  const counted = Object.values(batches)
    .flat()
    .filter((entry) => {
      const [mean, withMean] = armMeans(entry);
      return mean !== null && withMean !== null;
    }).length;
  const tasks = Object.values(batches).flat().length;
  return {
    provider: 'live',
    controls_status: 'PASS',
    trusted: true,
    controls: {},
    skills: [
      {
        skill: SKILL,
        tasks,
        coverage: { A: { tasks_counted: counted } },
        by_batch: { A: {} },
        not_counted: { A: [] },
      },
    ],
    ...overrides,
  };
}

const BATCHES = {
  b1: [4.8, 4.79, 5, 4.9, null, 3.2, 4.8001, 2],
  b2: [4.9, 5, 5, 5, 2, 3],
  b3: [4, 4, 4, 4, 4, 4, 4, 4],
};

/** A trim fixture: the root, the stored report and the `collect` that reads the judgments again. */
function setup(dir, { batches = BATCHES, stored, fresh } = {}) {
  const { layout, outcomeJobs, ids } = buildRoot(dir, batches);
  fs.mkdirSync(layout.runDir, { recursive: true });
  const report = stored || reportFor(batches);
  helpers.write(layout.reportJson, report);
  const collect = () => ({
    report: fresh || reportFor(batches),
    markdown: '',
    outcomeJobs,
  });
  return { layout, ids, collect };
}

function trimCommand(dir, collect, args = []) {
  const io = capture();
  const code = bench.main(
    ['trim', '--run', RUN, '--root', dir, ...args],
    io,
    {},
    { collect },
  );
  return { code, io, line: io.text ? JSON.parse(io.text) : null };
}

/** Every file under `dir` with the sha256 of its bytes, so a test can say "nothing changed". */
function snapshot(dir) {
  return Object.fromEntries(
    fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [
          path.relative(dir, file),
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(file))
            .digest('hex'),
        ];
      }),
  );
}

const taskIds = (layout, batch) =>
  helpers.readJson(layout.tasksFile(SKILL, batch)).scenarios.map((s) => s.id);
const bucketIds = (layout, batch) =>
  Object.keys(helpers.readJson(layout.bucketsFile(SKILL, batch)).scenarios);

test('trim: drops the easy tasks, restores up to the minimum, keeps a task with no judgment, and refreshes the manifest', () =>
  helpers.withTmp((dir) => {
    const { layout, ids, collect } = setup(dir);
    const unchangedB3 = fs.readFileSync(layout.tasksFile(SKILL, 'b3'));
    const { code, io, line } = trimCommand(dir, collect);
    assert.equal(code, 0, io.errors);
    assert.equal(io.errors, '');
    assert.deepEqual(line, {
      trim: 'done',
      run_id: RUN,
      threshold: 4.8,
      min_per_batch: 5,
      skills: {
        [SKILL]: {
          b1: {
            kept: 5,
            dropped: [
              { id: ids.b1[2], without_mean: 5, with_mean: 5 },
              { id: ids.b1[3], without_mean: 4.9, with_mean: 5 },
              { id: ids.b1[6], without_mean: 4.8001, with_mean: 5 },
            ],
            restored: [{ id: ids.b1[0], without_mean: 4.8, with_mean: 5 }],
          },
          b2: {
            kept: 5,
            dropped: [{ id: ids.b2[3], without_mean: 5, with_mean: 5 }],
            restored: [
              { id: ids.b2[0], without_mean: 4.9, with_mean: 5 },
              { id: ids.b2[1], without_mean: 5, with_mean: 5 },
              { id: ids.b2[2], without_mean: 5, with_mean: 5 },
            ],
          },
          b3: { kept: 8, dropped: [], restored: [] },
        },
      },
      manifest: 'refreshed',
    });
    assert.deepEqual(taskIds(layout, 'b1'), [
      ids.b1[0],
      ids.b1[1],
      ids.b1[4],
      ids.b1[5],
      ids.b1[7],
    ]);
    assert.deepEqual(
      taskIds(layout, 'b2'),
      ids.b2.slice(0, 3).concat(ids.b2.slice(4)),
    );
    assert.equal(taskIds(layout, 'b3').length, 8);
    for (const batch of ['b1', 'b2', 'b3'])
      assert.deepEqual(bucketIds(layout, batch), taskIds(layout, batch), batch);
    // The manifest was rewritten and the whole baseline passes its check; an untouched file is not rewritten.
    assert.deepEqual(verifyBaselines(layout).problems, []);
    assert.deepEqual(
      fs.readFileSync(layout.tasksFile(SKILL, 'b3')),
      unchangedB3,
    );
    if (process.platform !== 'win32')
      for (const file of [
        layout.tasksFile(SKILL, 'b1'),
        layout.bucketsFile(SKILL, 'b2'),
      ])
        assert.equal(fs.statSync(file).mode & 0o777, 0o664, file);
    assert.deepEqual(
      fs
        .readdirSync(path.dirname(layout.tasksFile(SKILL, 'b1')))
        .filter((n) => n.includes('.tmp-')),
      [],
      'no temporary file stays',
    );
  }));

test('trim: a task leaves only when both arms are easy; one that scores lower with the skill, or has no with-arm judgment, stays', () =>
  helpers.withTmp((dir) => {
    const batches = {
      b1: [
        [5, 5],
        [5, 4],
        [4, 5],
        [5, null],
        [4.8, 4.9],
        [3, 3],
        [3, 5],
        [3, 3],
      ],
      b2: [
        [5, 5],
        [5, 5],
        [5, 5],
        [5, 5],
        [5, 5],
        [5, 4],
        [5, 4.5],
        [5, null],
      ],
    };
    const { layout, ids, collect } = setup(dir, { batches });
    const { code, io, line } = trimCommand(dir, collect, ['--list-kept']);
    assert.equal(code, 0, io.errors);
    assert.deepEqual(line.skills[SKILL].b1.dropped, [
      { id: ids.b1[0], without_mean: 5, with_mean: 5 },
      { id: ids.b1[4], without_mean: 4.8, with_mean: 4.9 },
    ]);
    assert.deepEqual(line.skills[SKILL].b1.restored, []);
    assert.deepEqual(line.skills[SKILL].b1.kept_ids, [
      ids.b1[1],
      ids.b1[2],
      ids.b1[3],
      ids.b1[5],
      ids.b1[6],
      ids.b1[7],
    ]);
    // b2 has five tasks that are easy in both arms and three that are not, so two of the five come back to keep 5.
    assert.equal(line.skills[SKILL].b2.kept, 5);
    assert.deepEqual(
      line.skills[SKILL].b2.dropped.map((entry) => entry.id),
      ids.b2.slice(2, 5),
    );
    assert.deepEqual(
      line.skills[SKILL].b2.restored.map((entry) => entry.id),
      ids.b2.slice(0, 2),
    );
    assert.deepEqual(taskIds(layout, 'b1'), line.skills[SKILL].b1.kept_ids);
    assert.deepEqual(bucketIds(layout, 'b1'), taskIds(layout, 'b1'));
    assert.deepEqual(verifyBaselines(layout).problems, []);
  }));

test('trim: --threshold and --min-per-batch change what leaves; --skills picks the skills', () =>
  helpers.withTmp((dir) => {
    const { layout, ids, collect } = setup(dir);
    const { code, line } = trimCommand(dir, collect, [
      '--threshold',
      '4.95',
      '--min-per-batch',
      '6',
      '--skills',
      SKILL,
    ]);
    assert.equal(code, 0);
    assert.equal(line.threshold, 4.95);
    assert.equal(line.min_per_batch, 6);
    assert.deepEqual(
      line.skills[SKILL].b1.dropped.map((entry) => entry.id),
      [ids.b1[2]],
    );
    assert.deepEqual(line.skills[SKILL].b1.restored, []);
    assert.equal(line.skills[SKILL].b2.kept, 6);
    assert.equal(taskIds(layout, 'b1').length, 7);
    assert.equal(taskIds(layout, 'b2').length, 6);
  }));

test('trim --dry-run prints the same decisions and writes nothing', () =>
  helpers.withTmp((dir) => {
    const { collect } = setup(dir);
    const before = snapshot(dir);
    const dry = trimCommand(dir, collect, ['--dry-run']);
    assert.equal(dry.code, 0, dry.io.errors);
    assert.equal(dry.line.trim, 'dry-run');
    assert.equal(dry.line.manifest, 'not written');
    assert.deepEqual(snapshot(dir), before);
    const real = trimCommand(dir, collect);
    assert.deepEqual(
      { ...real.line, trim: 'dry-run', manifest: 'not written' },
      dry.line,
    );
    assert.notDeepEqual(snapshot(dir), before);
  }));

test('trim: a task file with nothing to drop is left alone and the manifest is unchanged', () =>
  helpers.withTmp((dir) => {
    const { collect } = setup(dir, { batches: { b1: [4, 4, 4, 4, 4, 4] } });
    const before = snapshot(dir);
    const { code, line } = trimCommand(dir, collect);
    assert.equal(code, 0);
    assert.equal(line.manifest, 'unchanged');
    assert.deepEqual(snapshot(dir), before);
  }));

/** Runs a trim that must be refused (exit 64, one `error:` line, no output line) and checks nothing was written. */
function assertRefused(dir, collect, message, args = []) {
  const before = snapshot(dir);
  const { code, io } = trimCommand(dir, collect, args);
  assert.equal(code, 64, io.errors);
  assert.match(io.errors, message);
  assert.equal(io.text, '');
  assert.deepEqual(snapshot(dir), before, 'a refused trim writes nothing');
}

test('trim: refuses a run that is not trusted', () => {
  for (const status of ['FAIL', 'NONE'])
    helpers.withTmp((dir) =>
      assertRefused(
        dir,
        setup(dir, {
          stored: reportFor(BATCHES, {
            controls_status: status,
            trusted: false,
          }),
        }).collect,
        new RegExp(`not trusted \\(controls_status is ${status}, not PASS\\)`),
      ),
    );
});

test('trim: refuses a stub run and a report that is not a report', () => {
  helpers.withTmp((dir) =>
    assertRefused(
      dir,
      setup(dir, { stored: reportFor(BATCHES, { provider: 'stub' }) }).collect,
      /not from a live run \(provider: stub\), so it is not a measurement/,
    ),
  );
  helpers.withTmp((dir) => {
    const old = reportFor(BATCHES);
    delete old.provider;
    assertRefused(
      dir,
      setup(dir, { stored: old }).collect,
      /not from a live run \(provider: missing\)/,
    );
  });
  helpers.withTmp((dir) =>
    assertRefused(
      dir,
      setup(dir, { stored: { provider: 'live', controls_status: 'PASS' } })
        .collect,
      /is not a report of this benchmark/,
    ),
  );
});

test('trim: refuses a run with no report', () =>
  helpers.withTmp((dir) => {
    const { layout, collect } = setup(dir);
    fs.rmSync(layout.reportJson);
    assertRefused(dir, collect, /has no report .*run `report` for it first/);
  }));

test('trim: refuses a report that the judgments on disk no longer give', () => {
  const changes = {
    'a changed coverage': (report) => {
      report.skills[0].coverage.A.tasks_counted -= 1;
    },
    'a changed task count': (report) => {
      report.skills[0].tasks += 1;
    },
    'a changed batch reading': (report) => {
      report.skills[0].by_batch.A.b1 = { mean_gap: 1 };
    },
    'a task that no longer counts': (report) => {
      report.skills[0].not_counted.A.push({ batch: 'b1', task_id: 'x' });
    },
    'a control that changed': (report) => {
      report.controls = { ladder: { status: 'FAIL' } };
    },
    'a trust that changed': (report) => {
      report.controls_status = 'FAIL';
      report.trusted = false;
    },
  };
  for (const [name, change] of Object.entries(changes))
    helpers.withTmp((dir) => {
      const fresh = reportFor(BATCHES);
      change(fresh);
      assertRefused(
        dir,
        setup(dir, { fresh }).collect,
        /the report of run "r1" is stale/,
      );
    });
});

test('trim: refuses a skill whose reading A counts fewer than 12 of every 16 tasks', () =>
  helpers.withTmp((dir) => {
    // 22 tasks need 17 counted (ceil(22 * 12 / 16)); 16 are counted.
    const batches = {
      b1: [4.9, 5, 5, 5, 5, 3, 3, 3],
      b2: [null, null, null, null, null, null, 3, 3],
      b3: [3, 3, 3, 3, 3, 3],
    };
    const { collect } = setup(dir, { batches });
    assertRefused(
      dir,
      collect,
      /reading A covers too few tasks to trim: brew-log counts 16 of 22 tasks in reading A, below 17 \(12 of every 16\)/,
    );
  }));

test('trim: refuses a skill the report did not measure', () =>
  helpers.withTmp((dir) => {
    const { collect } = setup(dir);
    assertRefused(
      dir,
      collect,
      /not measured in this run's report: pantry-note/,
      ['--skills', 'pantry-note'],
    );
  }));

test('trim: a control named in --skills is refused as a control, not as an unknown skill', () => {
  for (const [names, message] of [
    [
      'convention-control',
      /--skills: convention-control is a control, and controls are never trimmed/,
    ],
    [
      'dose-ladder',
      /--skills: dose-ladder is a control, and controls are never trimmed/,
    ],
    [
      `${SKILL},convention-control,dose-ladder`,
      /--skills: convention-control, dose-ladder are controls, and controls are never trimmed/,
    ],
  ])
    helpers.withTmp((dir) =>
      assertRefused(dir, setup(dir).collect, message, ['--skills', names]),
    );
});

test('trim: a report that counted more tasks than the baselines have says the run was trimmed already', () => {
  helpers.withTmp((dir) => {
    const fresh = reportFor(BATCHES);
    fresh.skills[0].tasks -= 5;
    assertRefused(
      dir,
      setup(dir, { fresh }).collect,
      /the report of run "r1" is stale: the baselines of brew-log have fewer tasks than it counted, so this run was trimmed already and a second trim of it would find nothing new/,
    );
  });
  // Another kind of staleness keeps the general message.
  helpers.withTmp((dir) => {
    const fresh = reportFor(BATCHES);
    fresh.skills[0].coverage.A.tasks_counted -= 1;
    const { collect } = setup(dir, { fresh });
    const { io } = trimCommand(dir, collect);
    assert.match(io.errors, /is stale: the judgments and baselines on disk/);
    assert.doesNotMatch(io.errors, /trimmed already/);
  });
});

test('trim --list-kept adds the ids of the tasks that stay; without it the line holds the count only', () =>
  helpers.withTmp((dir) => {
    const { layout, ids, collect } = setup(dir);
    const plain = trimCommand(dir, collect, ['--dry-run']);
    for (const batch of Object.values(plain.line.skills[SKILL]))
      assert.equal('kept_ids' in batch, false);
    const listed = trimCommand(dir, collect, ['--dry-run', '--list-kept']);
    assert.equal(listed.code, 0, listed.io.errors);
    const expected = {
      b1: [ids.b1[0], ids.b1[1], ids.b1[4], ids.b1[5], ids.b1[7]],
      b2: ids.b2.slice(0, 3).concat(ids.b2.slice(4)),
      b3: ids.b3,
    };
    for (const [batch, entry] of Object.entries(listed.line.skills[SKILL])) {
      assert.deepEqual(entry.kept_ids, expected[batch], batch);
      assert.equal(entry.kept, entry.kept_ids.length, batch);
    }
    // The ids are the ones the files hold after a real trim.
    const real = trimCommand(dir, collect, ['--list-kept']);
    for (const batch of ['b1', 'b2', 'b3'])
      assert.deepEqual(
        real.line.skills[SKILL][batch].kept_ids,
        taskIds(layout, batch),
      );
    for (const command of ['plan', 'next', 'report']) {
      const io = capture();
      assert.equal(
        bench.main(
          [command, '--skills', SKILL, '--root', dir, '--list-kept'],
          io,
          {},
        ),
        64,
        command,
      );
      assert.match(
        io.errors,
        new RegExp(`--list-kept is an option of trim, not of ${command}`),
      );
    }
  }));

/**
 * Gives item 5 of the tasks of `batch` the rule of item 4, except in the tasks of `holders`: the rule of item 5
 * (`<skill>-r05`) then has items in the batch only in `holders`. Rewrites the manifest.
 */
function confineRuleOfItem5(layout, batch, holders) {
  helpers.update(layout.bucketsFile(SKILL, batch), (buckets) => {
    for (const [id, items] of Object.entries(buckets.scenarios))
      if (!holders.includes(id)) items['5'] = { ...items['4'] };
  });
  writeManifest(layout);
}
const RULE_5 = `${SKILL}-r05`;

test('trim: names the rules a batch has no item for any more, and goes on when another batch still has one', () =>
  helpers.withTmp((dir) => {
    const batches = { b1: [5, 5, 3, 3, 3, 3, 3], b2: [3, 3, 3, 3, 3, 3] };
    const { layout, ids, collect } = setup(dir, { batches });
    // In b1 the rule of item 5 is only in the two tasks that leave; b2 has it in every task.
    confineRuleOfItem5(layout, 'b1', [ids.b1[0], ids.b1[1]]);
    const { code, io, line } = trimCommand(dir, collect);
    assert.equal(code, 0, io.errors);
    assert.deepEqual(line.skills[SKILL].b1.rules_emptied, [RULE_5]);
    assert.equal('rules_emptied' in line.skills[SKILL].b2, false);
    assert.deepEqual(
      line.skills[SKILL].b1.dropped.map((entry) => entry.id),
      [ids.b1[0], ids.b1[1]],
    );
  }));

test('trim: a rule that keeps one item in the batch is not reported', () =>
  helpers.withTmp((dir) => {
    const batches = { b1: [5, 5, 3, 3, 3, 3, 3], b2: [5, 5, 3, 3, 3, 3, 3] };
    const { layout, ids, collect } = setup(dir, { batches });
    // The rule of item 5 stays in the third task of each batch, which is not dropped.
    for (const batch of ['b1', 'b2'])
      confineRuleOfItem5(layout, batch, ids[batch].slice(0, 3));
    const { code, io, line } = trimCommand(dir, collect);
    assert.equal(code, 0, io.errors);
    for (const batch of Object.values(line.skills[SKILL]))
      assert.equal('rules_emptied' in batch, false);
  }));

test('trim: refuses a trim that would leave a rule without an item in every batch of its skill', () =>
  helpers.withTmp((dir) => {
    const batches = { b1: [5, 5, 3, 3, 3, 3, 3], b2: [5, 5, 3, 3, 3, 3, 3] };
    const { layout, ids, collect } = setup(dir, { batches });
    confineRuleOfItem5(layout, 'b1', [ids.b1[0], ids.b1[1]]);
    confineRuleOfItem5(layout, 'b2', [ids.b2[0], ids.b2[1]]);
    assertRefused(
      dir,
      collect,
      new RegExp(
        `trimming ${SKILL} would leave ${RULE_5} without a checklist item in any batch, so reading B could not read that rule`,
      ),
    );
  }));

test('trim: a rule that had no item in any batch before the trim is not blamed for it', () =>
  helpers.withTmp((dir) => {
    const batches = { b1: [5, 5, 3, 3, 3, 3, 3], b2: [5, 5, 3, 3, 3, 3, 3] };
    const { layout, collect } = setup(dir, { batches });
    confineRuleOfItem5(layout, 'b1', []);
    confineRuleOfItem5(layout, 'b2', []);
    const { code, io, line } = trimCommand(dir, collect);
    assert.equal(code, 0, io.errors);
    assert.equal('rules_emptied' in line.skills[SKILL].b1, false);
    assert.equal(line.skills[SKILL].b1.dropped.length, 2);
  }));

test('trim: refuses baselines that differ from the manifest, with exit 1 and nothing written', () =>
  helpers.withTmp((dir) => {
    const { layout, collect } = setup(dir);
    helpers.update(layout.tasksFile(SKILL, 'b3'), (tasks) => {
      tasks.scenarios[0].title = 'edited after the manifest';
    });
    const before = snapshot(dir);
    const { code, io } = trimCommand(dir, collect);
    assert.equal(code, 1);
    assert.match(io.errors, /error: before the trim, .*tasks-b3\.json/);
    assert.equal(io.text, '');
    assert.deepEqual(snapshot(dir), before);
  }));

test('trim: a write that fails leaves the files as they were and no temporary file', () =>
  helpers.withTmp((dir) => {
    const first = path.join(dir, 'first.json');
    fs.writeFileSync(first, 'old\n');
    const missing = path.join(dir, 'no-such-folder', 'second.json');
    assert.throws(
      () =>
        trim.writeFiles([
          { file: first, text: 'new\n' },
          { file: missing, text: 'new\n' },
        ]),
      (error) => error.writing === true && error.path === missing,
    );
    assert.equal(fs.readFileSync(first, 'utf8'), 'old\n');
    assert.deepEqual(fs.readdirSync(dir), ['first.json']);
  }));

test('trim: a failure while writing the manifest puts every file back', () =>
  helpers.withTmp((dir) => {
    const { layout, collect } = setup(dir);
    const before = snapshot(dir);
    assert.throws(
      () =>
        trim.runTrim({
          layout,
          config: helpers.exampleConfig(),
          collect,
          writeManifestFile: () => {
            throw Object.assign(new Error('disk full'), {
              code: 'ENOSPC',
              syscall: 'write',
            });
          },
        }),
      /disk full/,
    );
    assert.deepEqual(snapshot(dir), before);
  }));

/** The inputs applyChanges takes for the task and bucket files of batch b1 and the manifest, with their old text. */
function applyInputs(dir) {
  const { layout } = setup(dir);
  const read = (file) => fs.readFileSync(file, 'utf8');
  const files = [
    layout.tasksFile(SKILL, 'b1'),
    layout.bucketsFile(SKILL, 'b1'),
  ].map((file) => ({
    file,
    text: `new text of ${path.basename(file)}\n`,
    before: read(file),
  }));
  return { layout, files, manifestBefore: read(layout.manifestFile) };
}

test('trim: a file edited after the plan was made is not replaced, and nothing is written', () => {
  for (const which of ['tasks', 'buckets', 'manifest'])
    helpers.withTmp((dir) => {
      const inputs = applyInputs(dir);
      const edited = {
        tasks: inputs.files[0].file,
        buckets: inputs.files[1].file,
        manifest: inputs.layout.manifestFile,
      }[which];
      fs.appendFileSync(edited, ' ');
      const before = snapshot(dir);
      assert.throws(
        () =>
          trim.applyChanges({
            ...inputs,
            writeManifestFile: () => assert.fail('the manifest is not written'),
          }),
        (error) =>
          error instanceof UsageError &&
          error.message.startsWith(edited) &&
          /changed after the trim was planned, so nothing was written/.test(
            error.message,
          ),
        which,
      );
      assert.deepEqual(snapshot(dir), before, which);
    });
});

test('trim: a file edited while the plan is made is caught by the command', () =>
  helpers.withTmp((dir) => {
    const { layout, collect } = setup(dir);
    const edited = layout.tasksFile(SKILL, 'b1');
    // The bucket file of b3 is read after b1 is planned, so this edit lands between the plan and the write.
    const racing = Object.create(layout, {
      bucketsFile: {
        value: (skill, batch) => {
          if (batch === 'b3') fs.appendFileSync(edited, ' ');
          return layout.bucketsFile(skill, batch);
        },
      },
    });
    assert.throws(
      () =>
        trim.runTrim({
          layout: racing,
          config: helpers.exampleConfig(),
          collect,
        }),
      /tasks-b1\.json changed after the trim was planned, so nothing was written; run trim again/,
    );
    assert.equal(verifyBaselines(layout).problems.length > 0, true);
    assert.equal(taskIds(layout, 'b2').length, 6, 'no other file was replaced');
  }));

test('trim: a file that cannot be put back after a failed write is named, and the others are restored', () =>
  helpers.withTmp((dir) => {
    const inputs = applyInputs(dir);
    const [tasks, buckets] = inputs.files;
    const before = snapshot(dir);
    let calls = 0;
    const writeSet = (set) => {
      calls += 1;
      if (calls > 1 && set[0].file === buckets.file)
        throw Object.assign(new Error('cannot write'), { code: 'EACCES' });
      return trim.writeFiles(set);
    };
    assert.throws(
      () =>
        trim.applyChanges({
          ...inputs,
          writeSet,
          writeManifestFile: () => {
            throw Object.assign(new Error('disk full'), {
              code: 'ENOSPC',
              syscall: 'write',
            });
          },
        }),
      (error) =>
        error.code === 'ENOSPC' &&
        error.message === 'disk full' &&
        error.hint.startsWith('these files could not be put back') &&
        error.hint.includes(buckets.file) &&
        !error.hint.includes(tasks.file) &&
        /git checkout -- bench\/baselines$/.test(error.hint),
    );
    // The task file and the manifest are as they were; only the file that could not be restored differs.
    const after = snapshot(dir);
    const changed = Object.keys(after).filter(
      (name) => after[name] !== before[name],
    );
    assert.deepEqual(changed, [path.relative(dir, buckets.file)]);
    assert.equal(fs.readFileSync(buckets.file, 'utf8'), buckets.text);
  }));

test('trim: a write that fails from the second rename on, with the restore failing too, prints the files to repair', (t) =>
  helpers.withTmp((dir) => {
    const { layout, collect } = setup(dir);
    const real = fs.renameSync;
    let renames = 0;
    t.mock.method(fs, 'renameSync', (from, to) => {
      renames += 1;
      if (renames >= 2)
        throw Object.assign(new Error('ENOSPC: no space left on device'), {
          code: 'ENOSPC',
          syscall: 'rename',
          path: to,
        });
      return real(from, to);
    });
    const { code, io } = trimCommand(dir, collect);
    t.mock.restoreAll();
    assert.equal(code, 74, io.errors);
    const lines = io.errors.trimEnd().split('\n');
    assert.match(lines[0], /^error: cannot write file: ENOSPC /);
    assert.match(
      lines[1],
      /^error: these files could not be put back and may be half trimmed: .*run git checkout -- bench\/baselines$/,
    );
    assert.ok(lines[1].includes(layout.bucketsFile(SKILL, 'b1')), lines[1]);
    assert.equal(lines.length, 2);
  }));

test('trim --skills trims only the skills it names, and a stored report with controls null is not a report', () =>
  helpers.withTmp((dir) => {
    const other = {
      skill: 'other-skill',
      tasks: 0,
      coverage: { A: { tasks_counted: 0 } },
      by_batch: { A: {} },
      not_counted: { A: [] },
    };
    const both = (overrides = {}) => {
      const report = reportFor(BATCHES, overrides);
      report.skills.push(other);
      return report;
    };
    const { layout, collect } = setup(dir, {
      stored: both(),
      fresh: both(),
    });
    const before = snapshot(dir);
    const { code, io, line } = trimCommand(dir, collect, [
      '--skills',
      SKILL,
      '--dry-run',
    ]);
    assert.equal(code, 0, io.errors);
    assert.deepEqual(Object.keys(line.skills), [SKILL]);
    assert.deepEqual(snapshot(dir), before);
    assert.deepEqual(
      trim.chooseSkills(both(), ['other-skill']),
      ['other-skill'],
      'the subset is the requested skills, not every skill of the report',
    );
    assert.deepEqual(trim.chooseSkills(both()), [SKILL, 'other-skill']);
    helpers.write(layout.reportJson, both({ controls: null }));
    const refused = trimCommand(dir, collect, ['--dry-run']);
    assert.equal(refused.code, 64);
    assert.match(refused.io.errors, /not a report of this benchmark/);
  }));

test('trim: a report whose counts differ from the judgments is an internal error, not a trim', () =>
  helpers.withTmp((dir) => {
    // The report and the fresh read agree, but both count one task more than the judgments hold.
    const wrong = reportFor(BATCHES);
    wrong.skills[0].coverage.A.tasks_counted += 1;
    const { collect } = setup(dir, { stored: wrong, fresh: wrong });
    const before = snapshot(dir);
    const { code, io } = trimCommand(dir, collect);
    assert.equal(code, 70);
    assert.match(
      io.errors,
      /the report counts 22 reading A tasks but the judgments give 21/,
    );
    assert.deepEqual(snapshot(dir), before);
  }));

test('trim: a report whose skill entries lack the fields trim reads is refused, not a crash', () =>
  helpers.withTmp((dir) => {
    const damaged = reportFor(BATCHES);
    damaged.skills = [{ skill: SKILL, not_counted: {} }];
    assertRefused(
      dir,
      setup(dir, { stored: damaged }).collect,
      /is not a report of this benchmark/,
    );
  }));

test('trim: re-reads the report with the skills and the controls the stored report has', () =>
  helpers.withTmp((dir) => {
    const controls = {
      'convention-control': { status: 'PASS' },
      ladder: { status: 'PASS' },
    };
    const seen = [];
    const { collect } = setup(dir, {
      stored: reportFor(BATCHES, { controls }),
      fresh: reportFor(BATCHES, { controls }),
    });
    const { code, io } = trimCommand(
      dir,
      (options) => {
        seen.push(options.skills);
        return collect(options);
      },
      ['--dry-run'],
    );
    assert.equal(code, 0, io.errors);
    assert.deepEqual(seen, [[SKILL, 'convention-control', 'dose-ladder']]);
  }));

test('trim: --run is required, and the flags of other commands are refused', () =>
  helpers.withTmp((dir) => {
    const { collect } = setup(dir);
    const missing = capture();
    assert.equal(
      bench.main(['trim', '--root', dir], missing, {}, { collect }),
      64,
    );
    assert.match(missing.errors, /--run is required/);
    for (const [args, message] of [
      [['--max-usd', '5'], /--max-usd is not an option of trim/],
      [['--provider', 'stub'], /--provider is not an option of trim/],
      [['--json'], /trim always prints JSON/],
      [
        ['--threshold', '9'],
        /--threshold: must be a plain decimal from 1 to 5/,
      ],
      [
        ['--min-per-batch', '3'],
        /--min-per-batch: must be a whole number of at least 5/,
      ],
      [['--out', 'x'], /--out is an option of cost-profile, not of trim/],
    ]) {
      const { code, io } = trimCommand(dir, collect, args);
      assert.equal(code, 64, args.join(' '));
      assert.match(io.errors, message);
    }
    for (const command of ['plan', 'next', 'report']) {
      const io = capture();
      assert.equal(
        bench.main(
          [command, '--skills', SKILL, '--root', dir, '--dry-run'],
          io,
          {},
        ),
        64,
        command,
      );
      assert.match(
        io.errors,
        new RegExp(`--dry-run is an option of trim, not of ${command}`),
      );
    }
  }));

test('trim: on a real report of a run with no controls it is refused as not trusted', () =>
  helpers.withFixtureCopy((dir) => {
    const reportIo = capture();
    assert.equal(
      bench.main(
        ['report', '--skills', SKILL, '--root', dir, '--run', RUN],
        reportIo,
        {},
      ),
      0,
      reportIo.errors,
    );
    const before = snapshot(dir);
    const io = capture();
    assert.equal(
      bench.main(['trim', '--run', RUN, '--root', dir, '--dry-run'], io, {}),
      64,
    );
    assert.match(
      io.errors,
      /not trusted \(controls_status is NONE, not PASS\)/,
    );
    assert.deepEqual(snapshot(dir), before);
  }));

// ---- the real reading: a stubbed run, read back through collectReport -------------------------------------------

/**
 * Runs the fixture skill through the stubbed loop (the stub provider stands in for the model processes) to a report,
 * then makes that report a trusted live one, the one thing a stub run cannot be. Everything else, the answers, the
 * checklists, the judgments and the reading of them, is the real path.
 */
async function stubbedTrustedRun(dir) {
  const stubJob = require('../../../scripts/bench/job');
  const { collectReport } = require('../../../scripts/bench/lib/run-report');
  const stubRun = 'stub-trim';
  const root = path.join(dir, 'repo');
  fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
  const configFile = path.join(dir, 'settings.json');
  helpers.write(
    configFile,
    helpers.settingsWith({ subject_concurrency: 1, max_usd: 50 }),
  );
  const common = [
    '--skills',
    SKILL,
    '--run',
    stubRun,
    '--root',
    root,
    '--config',
    configFile,
  ];
  for (let round = 0; round < 12; round += 1) {
    const io = capture();
    await bench.main(
      ['next', ...common, '--provider', 'stub', '--max-usd', '25'],
      io,
      {},
    );
    const step = JSON.parse(io.text);
    if (step.next !== 'job') {
      assert.equal(step.next, 'done', io.text);
      break;
    }
    const jobIo = capture();
    assert.equal(await stubJob.main(step.command.slice(2), jobIo), 0);
  }
  const layout = createLayout({ root, runId: stubRun });
  const reportIo = capture();
  assert.equal(
    bench.main(['report', ...common, '--provider', 'stub'], reportIo, {}),
    0,
    reportIo.errors,
  );
  const trusted = (report) => ({
    ...report,
    provider: 'live',
    controls_status: 'PASS',
    trusted: true,
  });
  helpers.write(
    layout.reportJson,
    trusted(helpers.readJson(layout.reportJson)),
  );
  const collect = (options) => {
    const read = collectReport({
      ...options,
      ledgerFile: path.join(layout.runDir, 'ledger.jsonl'),
    });
    return { ...read, report: trusted(read.report) };
  };
  return { root, stubRun, configFile, collect };
}

test('trim: reads the without-arm means from the judgments a run stored, through the real report', () =>
  helpers.withTmpAsync(async (dir) => {
    const { root, stubRun, configFile, collect } = await stubbedTrustedRun(dir);
    const trimOnStub = (args) => {
      const io = capture();
      const code = bench.main(
        [
          'trim',
          '--run',
          stubRun,
          '--root',
          root,
          '--config',
          configFile,
          ...args,
        ],
        io,
        {},
        { collect },
      );
      return { code, io, line: io.text ? JSON.parse(io.text) : null };
    };
    // The stub judge gives every without answer a 1.8 on reading A. The fixture batch has 5 tasks, one of them
    // excluded from reading A, so the 4 judged tasks are all at the threshold and the minimum of 5 restores them.
    const layout = createLayout({ root, runId: stubRun });
    writeManifest(layout);
    const before = snapshot(root);
    const atMean = trimOnStub(['--threshold', '1.8', '--dry-run']);
    assert.equal(atMean.code, 0, atMean.io.errors);
    const batch = atMean.line.skills[SKILL].b1;
    assert.deepEqual(batch.dropped, []);
    assert.deepEqual(
      batch.restored.map((entry) => [entry.id, entry.without_mean]),
      [1, 2, 4, 5].map((number) => [`${SKILL}-rules-${number}`, 1.8]),
    );
    assert.equal(batch.kept, 5);
    const above = trimOnStub(['--threshold', '1.81', '--dry-run']);
    assert.equal(above.code, 0, above.io.errors);
    assert.deepEqual(above.line.skills[SKILL].b1.restored, []);
    assert.deepEqual(snapshot(root), before);
  }));

test('trim: a report that says PASS where the stored judgments give another status is stale, through the real report', () =>
  helpers.withFixtureCopy((dir) => {
    const reportIo = capture();
    assert.equal(
      bench.main(
        ['report', '--skills', SKILL, '--root', dir, '--run', RUN],
        reportIo,
        {},
      ),
      0,
      reportIo.errors,
    );
    const layout = createLayout({ root: dir, runId: RUN });
    helpers.update(layout.reportJson, (report) => {
      report.provider = 'live';
      report.controls_status = 'PASS';
      report.trusted = true;
    });
    const before = snapshot(dir);
    const io = capture();
    assert.equal(bench.main(['trim', '--run', RUN, '--root', dir], io, {}), 64);
    assert.match(io.errors, /the report of run "r1" is stale/);
    assert.deepEqual(snapshot(dir), before);
  }));
