// SPDX-License-Identifier: Apache-2.0
// Tests for the committed control data in scripts/bench/skills/ and scripts/bench/controls/: the convention-control
// skill, its rules file, task file and bucket sidecar agree with each other and pass the baseline checks; no request
// names a convention, so only a model that has the skill follows them; and the dose ladder passes its own audit.
// Committed files only: no process is started, no model and no AWS call is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadBaseline } = require('../../../scripts/bench/lib/baseline');
const {
  itemNames,
  loadLadder,
  validateLadder,
} = require('../../../scripts/bench/lib/dose-ladder');
const { fileSha256 } = require('../../../scripts/bench/lib/provenance');
const { ITEM_COUNT } = require('../../../scripts/bench/lib/request-checklist');
const { sectionsOf } = require('../../../scripts/bench/lib/tasks');

const BENCH = path.join(__dirname, '..', '..', '..', 'scripts', 'bench');
const SKILL = 'convention-control';
const BATCH = SKILL;
const SKILL_MD = path.join(BENCH, 'skills', SKILL, 'SKILL.md');
const CONTROL_DIR = path.join(BENCH, 'controls', SKILL);
const LADDER_FILE = path.join(BENCH, 'controls', 'dose-ladder-v1.json');

const need = (file) => {
  assert.ok(fs.existsSync(file), `committed file missing: ${file}`);
  return file;
};
const readJson = (file) => JSON.parse(fs.readFileSync(need(file), 'utf8'));
const flat = (text) => text.replace(/\s+/g, ' ');

const skillMd = fs.readFileSync(need(SKILL_MD), 'utf8');
const rules = readJson(path.join(CONTROL_DIR, 'rules.json'));
const tasks = readJson(path.join(CONTROL_DIR, `tasks-${BATCH}.json`));
const buckets = readJson(path.join(CONTROL_DIR, `tasks-${BATCH}.buckets.json`));

/** The paths loadBaseline reads, pointed at the control folder (the run layout points there the same way). */
const controlLayout = {
  batches: () => [BATCH],
  rulesFile: () => path.join(CONTROL_DIR, 'rules.json'),
  tasksFile: (skill, batch) => path.join(CONTROL_DIR, `tasks-${batch}.json`),
  bucketsFile: (skill, batch) =>
    path.join(CONTROL_DIR, `tasks-${batch}.buckets.json`),
  skillMd: () => SKILL_MD,
};

test('the rules file is made from this SKILL.md: hash, ids and quotes', () => {
  assert.equal(
    rules.skill_md_sha256,
    fileSha256(SKILL_MD),
    'SKILL.md changed after the rules file: update skill_md_sha256',
  );
  assert.equal(rules.rules.length, 6);
  assert.deepEqual(
    rules.rules.map((rule) => rule.id),
    [1, 2, 3, 4, 5, 6].map((index) => `${SKILL}-r0${index}`),
  );
  for (const rule of rules.rules)
    assert.ok(
      flat(skillMd).includes(flat(rule.source_quote)),
      `${rule.id}: the source quote is a sentence of SKILL.md`,
    );
});

test('the skill holds only arbitrary conventions: five rules no task needs, plus the guard both arms meet', () => {
  const useful = rules.rules.filter((rule) => rule.class === 'useful');
  const generic = rules.rules.filter((rule) => rule.class === 'generic');
  assert.equal(useful.length, 5);
  assert.equal(generic.length, 1);
  for (const rule of useful) assert.match(rule.why, /[Aa]rbitrary/, rule.id);
  assert.match(skillMd, /BENCHMARK CONTROL SKILL/);
  assert.match(skillMd, /arbitrary,\s+harmless convention/);
  assert.deepEqual(sectionsOf(skillMd), [
    'Opening Word',
    'Summary Heading',
    'Closing Line',
    'List Marker',
    'Date Style',
    'Using real facts',
  ]);
});

test('the baseline passes the same checks as any skill baseline: no problem, no warning, not stale', () => {
  const baseline = loadBaseline(controlLayout, SKILL);
  assert.deepEqual(baseline.problems, []);
  assert.deepEqual(baseline.warnings, []);
  assert.equal(baseline.rulesStale, false);
  assert.equal(baseline.batches.length, 1);
  assert.equal(baseline.batches[0].stale, false);
  assert.equal(baseline.batches[0].tasks.scenarios.length, 8);
  assert.ok(baseline.batches[0].buckets, 'the bucket sidecar passes its check');
});

test('the sidecar maps every checklist item to a rule, and a convention item quotes its rule', () => {
  const ruleOf = Object.fromEntries(rules.rules.map((rule) => [rule.id, rule]));
  assert.deepEqual(
    Object.keys(buckets.scenarios),
    tasks.scenarios.map((task) => task.id),
  );
  for (const task of tasks.scenarios) {
    const items = buckets.scenarios[task.id];
    assert.deepEqual(
      Object.keys(items),
      task.rubric.map((_, index) => String(index + 1)),
      task.id,
    );
    task.rubric.forEach((item, index) => {
      const { bucket, rule_id: ruleId } = items[String(index + 1)];
      if (bucket !== 'value') return;
      // The literal of the rule (`Heads-up:`, `In Short`, ...) up to its first digit, so a date rule matches on its day.
      const literal = /`([^`]+)`/
        .exec(ruleOf[ruleId].outcome)[1]
        .replace(/\d.*$/, '')
        .slice(0, 6);
      assert.ok(
        item.includes(literal),
        `${task.id} item ${index + 1} should check ${ruleId}: ${item}`,
      );
    });
    const valueItems = task.rubric.filter(
      (_, index) => items[String(index + 1)].bucket === 'value',
    );
    assert.ok(
      valueItems.length * 2 > task.rubric.length,
      `${task.id}: more than half of the items are conventions`,
    );
    assert.ok(
      task.rubric.some(
        (_, index) => items[String(index + 1)].bucket === 'guard',
      ),
      `${task.id}: at least one guard item about the request's own facts`,
    );
  }
});

test('no request states or asks for a convention, so only a model that has the skill follows them', () => {
  const literals = [
    'Heads-up',
    'In Short',
    'end of note',
    '`*`',
    'Nov 2026',
    'asterisk',
    'bullet marker',
    'closing line',
    'date style',
    'convention',
    'fernwick',
    SKILL,
  ];
  // The skill's own date style, so the date item can tell the arms apart.
  const skillDate = /\b\d{2} [A-Z][a-z]{2} \d{4}\b/;
  for (const task of tasks.scenarios) {
    const prompt = task.prompt.toLowerCase();
    for (const literal of literals)
      assert.ok(
        !prompt.includes(literal.toLowerCase()),
        `${task.id} mentions "${literal}"`,
      );
    assert.doesNotMatch(task.prompt, skillDate, task.id);
  }
});

test('the dose ladder passes its audit and gives the four doses of the pass rule', () => {
  const ladder = loadLadder(LADDER_FILE);
  const audit = validateLadder(ladder);
  assert.deepEqual(audit.problems, []);
  assert.equal(audit.ok, true);
  assert.equal(ladder.set, 'dose-ladder-v1');
  assert.deepEqual(ladder.doses, { D0: 0, D1: 1, D2: 2, D4: 4 });
  assert.equal(ladder.tasks.length, 8);
  assert.deepEqual(itemNames(ladder), [
    'fixture-d0',
    'fixture-d1',
    'fixture-d2',
    'fixture-d4',
  ]);
});

test('every dose ladder task has a rubric the request-only checklist writer accepts', () => {
  // The writer is asked for as many items as the task's rubric holds, and refuses a count outside its range, so a
  // task outside it would stop the whole ladder at its first job.
  const ladder = loadLadder(LADDER_FILE);
  for (const task of ladder.tasks) {
    assert.ok(
      task.rubric.length >= ITEM_COUNT.min &&
        task.rubric.length <= ITEM_COUNT.max,
      `${task.id}: ${task.rubric.length} rubric items, the writer takes ${ITEM_COUNT.min} to ${ITEM_COUNT.max}`,
    );
  }
});

test('the control data holds no home path, credential-shaped value or 12-digit number', () => {
  const files = [
    SKILL_MD,
    path.join(CONTROL_DIR, 'rules.json'),
    path.join(CONTROL_DIR, `tasks-${BATCH}.json`),
    path.join(CONTROL_DIR, `tasks-${BATCH}.buckets.json`),
    LADDER_FILE,
  ];
  // Built from pieces, so this file does not hold the literals it looks for.
  const patterns = [
    new RegExp(['/', 'Users/'].join('')),
    new RegExp(['/', 'home/'].join('')),
    new RegExp(['AK', 'IA[0-9A-Z]{16}'].join('')),
    /(?<![0-9])[0-9]{12}(?![0-9])/,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns)
      assert.doesNotMatch(text, pattern, `${path.basename(file)}: ${pattern}`);
  }
});
