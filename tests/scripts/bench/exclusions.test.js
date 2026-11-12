// SPDX-License-Identifier: Apache-2.0
// Tests for reading A's exclusions (scripts/bench/lib/exclusions.js), the committed bench/exclusions.json, and the
// scale view (scripts/bench/lib/scale-view.js): a record of one batch leaves the task out of reading A only, the same
// task id in another batch is kept, the items scale is never touched, and the outcome view shows the request-only
// checklist of a task or says why it waits. Temp dirs and the committed fixtures only: no process, no model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const exclusionsLib = require('../../../scripts/bench/lib/exclusions');
const { loadExclusions } = require('../../../scripts/bench/lib/baseline');
const formats = require('../../../scripts/bench/lib/formats');
const { checklistSha256 } = require('../../../scripts/bench/lib/provenance');
const checklist = require('../../../scripts/bench/lib/request-checklist');
const {
  REPO_ROOT,
  createLayout,
} = require('../../../scripts/bench/lib/layout');
const view = require('../../../scripts/bench/lib/scale-view');
const helpers = require('./helpers');

const MODEL = 'writer-model';
const NOW = () => new Date('2026-11-10T00:00:00Z');
const BENCH_LIB = path.join(REPO_ROOT, 'scripts', 'bench');

const task = (id, prompt = `Please plan the ${id} change for our team.`) => ({
  id,
  prompt,
  rubric: Array.from(
    { length: 5 },
    (_, index) => `Item ${index + 1} of ${id} is covered.`,
  ),
});
const exclusionsOf = (batches) => ({ format_version: 1, batches });
const NO_EXCLUSIONS = exclusionsOf({});
const record = (
  id,
  reason = 'the writer was blocked on this request twice',
) => ({
  id,
  scales: ['outcome'],
  reason,
  date: '2026-11-10',
});
const items = (count, tag) =>
  Array.from(
    { length: count },
    (_, index) => `The answer covers ${tag} point ${index + 1} of the request.`,
  );

/** Writes a current checklist file for `entry` of `set`, as the writer would. */
function writeChecklist(layout, set, entry, { model = MODEL, tag = 'a' } = {}) {
  const input = checklist.requestOnlyInput(entry, {
    skill: set.skill,
    ruleIds: set.ruleIds,
  });
  const job = { skill: set.skill, batch: set.batch, input };
  const written = checklist.checklistRecord({
    job,
    items: items(input.item_count, tag),
    model,
    now: NOW,
  });
  checklist.writeChecklistFile(
    layout.checklistFile(set.skill, set.batch, entry.id),
    written,
  );
  return written;
}

// ---- the committed exclusions file ------------------------------------------------------------------------------

test('the committed bench/exclusions.json passes the public exclusions reader and holds only owner decisions', () => {
  const layout = createLayout({ root: REPO_ROOT });
  const { data, warnings } = formats.loadChecked(
    'exclusions',
    layout.exclusionsFile,
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(loadExclusions(layout), data);
  const rows = Object.entries(data.batches).flatMap(([batch, entry]) =>
    entry.scenarios.map((row) => ({ batch, ...row })),
  );
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      'batch',
      'date',
      'id',
      'reason',
      'scales',
    ]);
    assert.deepEqual(row.scales, ['outcome']);
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(row.reason, /checklist writer/);
    assert.ok(
      row.id.startsWith(`${row.id.replace(/-rules-\d+$/, '')}-rules-`),
      row.id,
    );
  }
  assert.deepEqual(
    rows.map((row) => `${row.batch}/${row.id}`),
    [
      'rules-b7/security-test-generation-rules-1',
      'rules-b7/security-test-generation-rules-3',
      'rules-c3/security-test-generation-rules-8',
    ],
  );
});

test('a malformed exclusions file is refused as a whole: the items scale, a missing reason, a bad date, a repeated id', () =>
  helpers.withFixtureCopy((root, layout) => {
    const cases = [
      [
        { ...record('brew-log-rules-1'), scales: ['items'] },
        /"items" \(reading B\) cannot be excluded/,
      ],
      [
        { ...record('brew-log-rules-1'), scales: ['outcome', 'blind'] },
        /must be exactly \["outcome"\]/,
      ],
      [{ ...record('brew-log-rules-1'), reason: '' }, /reason/],
      [{ ...record('brew-log-rules-1'), date: '2026-13-40' }, /date/],
    ];
    for (const [bad, pattern] of cases) {
      helpers.write(
        layout.exclusionsFile,
        exclusionsOf({ b1: { scenarios: [bad] } }),
      );
      assert.throws(
        () => loadExclusions(layout),
        (error) =>
          error instanceof formats.FormatError &&
          error.errors.some((message) => pattern.test(message)),
        JSON.stringify(bad),
      );
    }
    helpers.write(
      layout.exclusionsFile,
      exclusionsOf({
        b1: {
          scenarios: [record('brew-log-rules-1'), record('brew-log-rules-1')],
        },
      }),
    );
    assert.throws(() => loadExclusions(layout), /listed twice/);
  }));

test('the exclusions file is opened in one place: only baseline.js names layout.exclusionsFile', () => {
  const users = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (
        entry.name.endsWith('.js') &&
        fs.readFileSync(file, 'utf8').includes('.exclusionsFile')
      )
        users.push(path.relative(BENCH_LIB, file));
    }
  };
  walk(BENCH_LIB);
  assert.deepEqual(users, [path.join('lib', 'baseline.js')]);
  assert.equal(exclusionsLib.loadExclusions, loadExclusions);
});

// ---- splitTasks --------------------------------------------------------------------------------------------------

test('splitTasks: a record of the batch leaves its task out with the reason and date; the order of the rest is kept', () => {
  const tasks = ['t-1', 't-2', 't-3'].map((id) => task(id));
  const exclusions = exclusionsOf({
    b5: { scenarios: [record('t-2', 'blocked by the provider on both tries')] },
  });
  const split = exclusionsLib.splitTasks(exclusions, 'b5', tasks);
  assert.deepEqual(
    split.kept.map((entry) => entry.id),
    ['t-1', 't-3'],
  );
  assert.equal(split.kept[0], tasks[0]);
  assert.deepEqual(split.excluded, [
    {
      batch: 'b5',
      id: 't-2',
      reason: 'blocked by the provider on both tries',
      date: '2026-11-10',
    },
  ]);
});

test('splitTasks: the same task id in another batch is NOT excluded', () => {
  const tasks = ['t-1', 't-2'].map((id) => task(id));
  const exclusions = exclusionsOf({ b5: { scenarios: [record('t-2')] } });
  const other = exclusionsLib.splitTasks(exclusions, 'c4', tasks);
  assert.deepEqual(other.kept, tasks);
  assert.deepEqual(other.excluded, []);
});

test('splitTasks: a record that names no task of the list is in neither list; no file and an empty file exclude nothing', () => {
  const tasks = [task('t-1')];
  const split = exclusionsLib.splitTasks(
    exclusionsOf({ b5: { scenarios: [record('other-skill-rules-4')] } }),
    'b5',
    tasks,
  );
  assert.deepEqual(split, { kept: tasks, excluded: [] });
  for (const exclusions of [undefined, null, exclusionsOf({})])
    assert.deepEqual(exclusionsLib.splitTasks(exclusions, 'b5', tasks), {
      kept: tasks,
      excluded: [],
    });
});

test('splitTasks: a record for a scale other than outcome never hides a task', () => {
  const tasks = [task('t-1')];
  const exclusions = exclusionsOf({
    b5: { scenarios: [{ ...record('t-1'), scales: ['items'] }] },
  });
  assert.deepEqual(
    exclusionsLib.splitTasks(exclusions, 'b5', tasks).kept,
    tasks,
  );
});

test('splitTasks: a batch named like an Object.prototype key excludes nothing and does not throw', () => {
  const tasks = [task('t-1')];
  const exclusions = exclusionsOf({ b5: { scenarios: [record('t-1')] } });
  for (const batch of [
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__',
  ])
    assert.deepEqual(exclusionsLib.splitTasks(exclusions, batch, tasks), {
      kept: tasks,
      excluded: [],
    });
});

test('splitTasks on the fixture root: brew-log-rules-3 of b1 is excluded, rules-9 names no task and excludes nothing', () => {
  const layout = createLayout({ root: helpers.fixtureRoot() });
  const [set] = view.baselineSets(layout, ['brew-log']);
  const split = exclusionsLib.splitTasks(
    loadExclusions(layout),
    set.batch,
    set.tasks,
  );
  assert.deepEqual(
    split.excluded.map((entry) => entry.id),
    ['brew-log-rules-3'],
  );
  assert.equal(split.kept.length, set.tasks.length - 1);
  assert.ok(!split.kept.some((entry) => entry.id === 'brew-log-rules-3'));
});

// ---- baselineSets ------------------------------------------------------------------------------------------------

test('baselineSets: one set per task file with the task file scenarios and the rule ids; a skill with no baseline gives none', () => {
  const layout = createLayout({ root: helpers.fixtureRoot() });
  const sets = view.baselineSets(layout, ['brew-log', 'pantry-note']);
  assert.equal(sets.length, 1);
  const [set] = sets;
  const tasksFile = helpers.readJson(layout.tasksFile('brew-log', 'b1'));
  const rulesFile = helpers.readJson(layout.rulesFile('brew-log'));
  assert.equal(set.skill, 'brew-log');
  assert.equal(set.batch, 'b1');
  assert.deepEqual(set.tasks, tasksFile.scenarios);
  assert.deepEqual(
    set.ruleIds,
    rulesFile.rules.map((rule) => rule.id),
  );
});

test('baselineSets: a stale baseline still gives its tasks (reading A needs only the tasks)', () =>
  helpers.withFixtureCopy((root, layout) => {
    fs.appendFileSync(
      layout.skillMd('brew-log'),
      '\nAn edit after the rules were written.\n',
    );
    const [set] = view.baselineSets(layout, ['brew-log']);
    assert.ok(set.tasks.length > 0);
  }));

// ---- viewSets ----------------------------------------------------------------------------------------------------

test('viewSets items: the input sets come back as they are, with nothing missing or excluded', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    const sets = [
      {
        skill: 'plan-review',
        batch: 'b5',
        tasks: [task('plan-review-rules-1')],
        ruleIds: [],
      },
    ];
    const exclusions = exclusionsOf({
      b5: { scenarios: [record('plan-review-rules-1')] },
    });
    const result = view.viewSets(sets, 'items', {
      layout,
      exclusions,
      model: MODEL,
    });
    assert.equal(result.sets, sets);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.excluded, []);
  }));

test('viewSets outcome: a task with a current checklist is shown that checklist, not its rules checklist', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    const entry = task('plan-review-rules-1');
    const set = {
      skill: 'plan-review',
      batch: 'b5',
      tasks: [entry],
      ruleIds: ['R1'],
    };
    const written = writeChecklist(layout, set, entry);
    const result = view.viewSets([set], 'outcome', {
      layout,
      exclusions: NO_EXCLUSIONS,
      model: MODEL,
    });
    assert.deepEqual(result.missing, []);
    const [shown] = result.sets[0].tasks;
    assert.deepEqual(shown.rubric, written.items);
    assert.notDeepEqual(shown.rubric, entry.rubric);
    assert.equal(shown.checklist_status, 'ok');
    assert.deepEqual(shown.checklist, {
      checklist_version: checklist.CHECKLIST_VERSION,
      prompt_sha256: checklist.WRITER_PROMPT_SHA256,
      writer_model: MODEL,
      request_sha256: written.request_sha256,
      items_sha256: checklistSha256(written.items),
    });
    // The input is not changed.
    assert.equal(set.tasks[0], entry);
    assert.equal(entry.checklist, undefined);
    assert.equal(entry.rubric.length, 5);
  }));

test('viewSets outcome: no file, a file of another writer model or request, and an unsafe request all wait with an empty checklist', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    const fresh = task('plan-review-rules-1');
    const otherModel = task('plan-review-rules-2');
    const edited = task('plan-review-rules-3');
    // Nothing is left once SKILL.md is stripped, so the writer cannot be given this request.
    const unsafe = task('plan-review-rules-4', 'SKILL.md');
    const set = {
      skill: 'plan-review',
      batch: 'b5',
      tasks: [fresh, otherModel, edited, unsafe],
      ruleIds: [],
    };
    writeChecklist(layout, set, otherModel, { model: 'another-model' });
    writeChecklist(layout, set, edited);
    set.tasks[2] = {
      ...edited,
      prompt: `${edited.prompt} Also cover the rollback.`,
    };
    const result = view.viewSets([set], 'outcome', {
      layout,
      exclusions: NO_EXCLUSIONS,
      model: MODEL,
    });
    assert.deepEqual(
      result.missing.map((entry) => [entry.id, entry.status]),
      [
        ['plan-review-rules-1', 'missing'],
        ['plan-review-rules-2', 'stale'],
        ['plan-review-rules-3', 'stale'],
        ['plan-review-rules-4', 'unsafe'],
      ],
    );
    for (const shown of result.sets[0].tasks) {
      assert.deepEqual(shown.rubric, []);
      assert.notEqual(shown.checklist_status, 'ok');
      assert.equal(shown.checklist, undefined);
    }
    assert.ok(
      result.missing.every(
        (entry) => entry.skill === 'plan-review' && entry.batch === 'b5',
      ),
    );
    assert.match(result.missing[0].reason, /no checklist file/);
  }));

test('viewOutcomeTask: the reason of a waiting task is redacted and cut to 300 characters', () => {
  const key = ['AKIA', 'IOSFODNN7EXAMPLF'].join('');
  const layout = createLayout({
    root: path.join(path.sep, 'nowhere', key, 'x'.repeat(400)),
  });
  const waiting = view.viewOutcomeTask(task('t-1'), {
    skill: 'plan-review',
    batch: 'b1',
    layout,
    model: MODEL,
  });
  assert.equal(waiting.status, 'missing');
  assert.ok(!waiting.reason.includes(key), 'the key is redacted');
  assert.match(waiting.reason, /\[truncated \d+ characters\]$/);
  assert.ok(
    waiting.reason.length <= 300 + '[truncated 1000 characters]'.length,
  );
});

test('viewSets outcome: an excluded task is not in the view and not missing; it is listed with its reason and date', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    const kept = task('plan-review-rules-1');
    const left = task('plan-review-rules-2');
    const set = {
      skill: 'plan-review',
      batch: 'b5',
      tasks: [kept, left],
      ruleIds: [],
    };
    writeChecklist(layout, set, kept);
    const exclusions = exclusionsOf({
      b5: {
        scenarios: [
          record(
            'plan-review-rules-2',
            'blocked by the provider on both tries',
          ),
        ],
      },
    });
    const result = view.viewSets([set], 'outcome', {
      layout,
      exclusions,
      model: MODEL,
    });
    assert.deepEqual(
      result.sets[0].tasks.map((entry) => entry.id),
      ['plan-review-rules-1'],
    );
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.excluded, [
      {
        skill: 'plan-review',
        batch: 'b5',
        id: 'plan-review-rules-2',
        reason: 'blocked by the provider on both tries',
        date: '2026-11-10',
      },
    ]);
    // The same id in another batch keeps the task and waits for its checklist.
    const other = view.viewSets([{ ...set, batch: 'c4' }], 'outcome', {
      layout,
      exclusions,
      model: MODEL,
    });
    assert.deepEqual(other.excluded, []);
    assert.deepEqual(
      other.missing.map((entry) => entry.id),
      ['plan-review-rules-1', 'plan-review-rules-2'],
    );
  }));

test('viewSets outcome: the rule ids decide the stripped request, so a checklist written for other rule ids is stale', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    const entry = task(
      'plan-review-rules-1',
      'Please plan the change and keep the steep-first note in mind for the rollout.',
    );
    const set = {
      skill: 'plan-review',
      batch: 'b5',
      tasks: [entry],
      ruleIds: ['steep-first'],
    };
    writeChecklist(layout, set, entry);
    assert.deepEqual(
      view.viewSets([set], 'outcome', {
        layout,
        exclusions: NO_EXCLUSIONS,
        model: MODEL,
      }).missing,
      [],
    );
    const without = view.viewSets([{ ...set, ruleIds: [] }], 'outcome', {
      layout,
      exclusions: NO_EXCLUSIONS,
      model: MODEL,
    });
    assert.deepEqual(
      without.missing.map((row) => row.status),
      ['stale'],
    );
  }));

test('viewSets: an unknown scale, a missing layout or a missing writer model is a programming error', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    assert.throws(
      () =>
        view.viewSets([], 'blind', {
          layout,
          exclusions: NO_EXCLUSIONS,
          model: MODEL,
        }),
      TypeError,
    );
    assert.throws(
      () =>
        view.viewSets([], 'outcome', {
          exclusions: NO_EXCLUSIONS,
          model: MODEL,
        }),
      TypeError,
    );
    assert.throws(
      () => view.viewSets([], 'outcome', { layout, exclusions: NO_EXCLUSIONS }),
      TypeError,
    );
  }));

test('viewSets outcome: a call without the loaded exclusions is a programming error, not a view that leaves nothing out', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: dir });
    const set = {
      skill: 'plan-review',
      batch: 'b5',
      tasks: [task('plan-review-rules-1')],
      ruleIds: [],
    };
    for (const exclusions of [undefined, null, {}, 'none', layout])
      assert.throws(
        () =>
          view.viewSets([set], 'outcome', { layout, exclusions, model: MODEL }),
        /exclusions is loadExclusions\(layout\)/,
        String(exclusions),
      );
    // The items scale never reads exclusions, so it needs none.
    assert.equal(
      view.viewSets([set], 'items', { layout, model: MODEL }).sets[0],
      set,
    );
  }));

test('viewSets outcome on the fixture root: the excluded task is left out and every other task waits for its checklist', () => {
  const layout = createLayout({
    root: helpers.fixtureRoot(),
    runId: 'view-test',
  });
  const sets = view.baselineSets(layout, ['brew-log']);
  const result = view.viewSets(sets, 'outcome', {
    layout,
    exclusions: loadExclusions(layout),
    model: MODEL,
  });
  assert.deepEqual(
    result.excluded.map((row) => row.id),
    ['brew-log-rules-3'],
  );
  assert.equal(result.missing.length, sets[0].tasks.length - 1);
  assert.ok(result.missing.every((row) => row.status === 'missing'));
});
