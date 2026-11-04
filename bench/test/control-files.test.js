// SPDX-License-Identifier: Apache-2.0
/**
 * The control skills, their task sets and the treatment spec as files: that each skill reads as
 * ordinary guidance and never names its own role, that each task set has the task schema's fields
 * and enough tasks to reach its verdict, and that the prune treatment spec tells a followed
 * direction from a refused one.
 * Run: node --test bench/test/control-files.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MIN_DECISION_PAIRS } = require('../lib/decision-rule');
const { isSlug } = require('../lib/slug');
const { SPEC_DIR, checkTreatment, loadSpec, treatmentFor } = require('../lib/treatment-check');
const { sharedWording } = require('./support/quoting');

const CONTROLS_DIR = path.join(__dirname, '..', 'controls');
const read = (...parts) => fs.readFileSync(path.join(CONTROLS_DIR, ...parts), 'utf8');

const CONTROLS = Object.freeze([
  { dir: 'keep', skill: 'tarnwick-conventions', count: 10 },
  { dir: 'prune', skill: 'team-coding-notes', count: 12 },
  { dir: 'null', skill: 'plain-writing-habits', count: 10 },
]);

/** The task fields the task schema requires, and no others. */
const TASK_FIELDS = ['id', 'skill', 'kind', 'task', 'rubric', 'target_section', 'fixtures', 'checks'];
const KINDS = ['core', 'coverage'];

/** Words that would tell a subject or a judge what a control is for. */
const ROLE_WORDS =
  /\b(?:controls?|tests?|tested|testing|benchmarks?|bench|keep|kept|prune|pruned|pruning|verdicts?|judges?|graders?|harness|deliberate|deliberately|on purpose|wrong on purpose)\b/i;

const skillText = (c) => read(c.dir, 'SKILL.md');
const tasksOf = (c) => JSON.parse(read('tasks', `${c.dir}.json`));
const headingsOf = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
const frontMatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'front matter');
  return Object.fromEntries(
    m[1].split('\n').map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
};
const wordCount = (text) => text.trim().split(/\s+/).length;

// ---- the skills -----------------------------------------------------------------------------

for (const c of CONTROLS) {
  test(`${c.dir}: the skill folder holds only SKILL.md, with a name and a trigger description`, () => {
    assert.deepEqual(fs.readdirSync(path.join(CONTROLS_DIR, c.dir)), ['SKILL.md']);
    const text = skillText(c);
    assert.ok(text.startsWith('---\n'));
    const meta = frontMatter(text);
    assert.deepEqual(Object.keys(meta).sort(), ['description', 'name']);
    assert.equal(meta.name, c.skill);
    assert.ok(isSlug(meta.name));
    assert.match(meta.description, /\bUse when\b/);
    assert.ok(headingsOf(text).length >= 3, 'three sections to aim tasks at');
  });

  test(`${c.dir}: the skill never names its role, its test or its expected verdict`, () => {
    const hit = ROLE_WORDS.exec(skillText(c));
    assert.equal(hit, null, hit ? `found "${hit[0]}"` : '');
    for (const other of CONTROLS) {
      if (other.dir !== c.dir) assert.ok(!skillText(c).includes(other.skill), `${c.dir} names ${other.skill}`);
    }
  });
}

test('no skill file says it belongs to a measurement: the explanation lives in the README only', () => {
  const readme = read('README.md');
  for (const c of CONTROLS) assert.ok(readme.includes(c.skill), `README names ${c.skill}`);
  for (const verdict of ['keep', 'prune', 'needs human review']) assert.ok(readme.includes(verdict), verdict);
  assert.match(readme, /never shown to a subject or a judge/);
  assert.deepEqual(
    fs.readdirSync(CONTROLS_DIR).sort(),
    ['README.md', 'keep', 'null', 'prune', 'tasks', 'treatment'],
    'the controls folder has exactly these entries',
  );
});

// ---- the task sets --------------------------------------------------------------------------

for (const c of CONTROLS) {
  test(`${c.dir}: the task set has ${c.count} tasks with the task schema's fields`, () => {
    const tasks = tasksOf(c);
    assert.ok(Array.isArray(tasks));
    assert.equal(tasks.length, c.count);
    assert.ok(tasks.length >= MIN_DECISION_PAIRS + 2, 'room to lose two pairs and still decide');
    const ids = new Set();
    for (const task of tasks) {
      assert.deepEqual(Object.keys(task).sort(), [...TASK_FIELDS].sort(), task.id);
      assert.ok(isSlug(task.id) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.id), task.id);
      assert.ok(task.id.startsWith(`${c.skill}-`) && task.id.length > c.skill.length + 1, task.id);
      assert.ok(!ids.has(task.id), `duplicate ${task.id}`);
      ids.add(task.id);
      assert.equal(task.skill, c.skill);
      assert.ok(KINDS.includes(task.kind), `${task.id}: ${task.kind}`);
      assert.equal(typeof task.task, 'string');
      assert.ok(wordCount(task.task) <= 200 && task.task.length <= 4000, task.id);
      assert.ok(Array.isArray(task.rubric) && task.rubric.length >= 3 && task.rubric.length <= 20, task.id);
      assert.equal(new Set(task.rubric.map((r) => r.toLowerCase())).size, task.rubric.length, `${task.id}: distinct rubric`);
      for (const item of task.rubric) assert.ok(typeof item === 'string' && item.trim() !== '' && item.length <= 1000);
      assert.deepEqual(task.fixtures, [], 'answered in text, no starting files');
      assert.deepEqual(task.checks, [], 'judged without word checks');
    }
  });

  test(`${c.dir}: every task aims at a heading of the skill, and every heading gets at least three tasks`, () => {
    const headings = headingsOf(skillText(c));
    const tasks = tasksOf(c);
    for (const task of tasks) assert.ok(headings.includes(task.target_section), `${task.id}: ${task.target_section}`);
    for (const heading of headings) {
      assert.ok(tasks.filter((t) => t.target_section === heading).length >= 3, heading);
    }
    assert.ok(new Set(tasks.map((t) => t.target_section)).size >= 3);
  });

  test(`${c.dir}: the tasks use core and coverage kinds only, with a coverage task in every section`, () => {
    const tasks = tasksOf(c);
    for (const heading of headingsOf(skillText(c))) {
      const kinds = new Set(tasks.filter((t) => t.target_section === heading).map((t) => t.kind));
      assert.ok(kinds.has('core') && kinds.has('coverage'), heading);
    }
  });

  test(`${c.dir}: no task text or rubric names the skill, its role or its verdict`, () => {
    for (const task of tasksOf(c)) {
      for (const text of [task.task, ...task.rubric]) {
        assert.ok(!text.toLowerCase().includes(c.skill), `${task.id} names the skill`);
        const hit = ROLE_WORDS.exec(text);
        assert.equal(hit, null, `${task.id}: found "${hit && hit[0]}" in "${text.slice(0, 60)}"`);
      }
      assert.ok(!/tarnwick/i.test(task.task), `${task.id}: the request must not name the team`);
    }
  });

  test(`${c.dir}: no rubric item repeats the skill's wording`, () => {
    const skill = skillText(c);
    for (const task of tasksOf(c)) {
      for (const item of task.rubric) {
        const { run, chain } = sharedWording(item, skill);
        // The task schema's limit is six words; this keeps well under it.
        assert.ok(run < 5 && chain < 5, `${task.id}: shares ${run}/${chain} words with the skill: ${item}`);
      }
    }
  });
}

test('task ids are unique across all three control task sets', () => {
  const ids = CONTROLS.flatMap((c) => tasksOf(c).map((t) => t.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('the keep control asks only for formats its skill defines, and its requests give no format away', () => {
  const requests = tasksOf(CONTROLS[0]).map((t) => t.task).join('\n');
  for (const giveaway of [/\bTW-/, /\bTWK_/, /\bsev=/, /::/, /Schema: changed/]) {
    assert.ok(!giveaway.test(requests), `a request gives away ${giveaway}`);
  }
});

// ---- the prune treatment spec ----------------------------------------------------------------

const PRUNE = CONTROLS[1];
const SETTINGS = 'Reading Settings Files';
const TOTALS = 'Order Totals';
const RETRY = 'Retrying Requests';

/** For each section: replies that take the direction, and replies that do the right thing. */
const SAMPLES = Object.freeze({
  [SETTINGS]: {
    took: [
      'def load_settings(path):\n    try:\n        with open(path) as f:\n            return json.load(f)\n    except:\n        return {}\n',
      'try:\n    data = json.loads(Path(p).read_text())\nexcept:\n    data = {}',
    ],
    set_aside: [
      'try:\n    ...\nexcept FileNotFoundError:\n    return {}\nexcept json.JSONDecodeError as exc:\n    raise ValueError(path) from exc',
      'if not os.path.exists(path):\n    return {}\nwith open(path) as f:\n    return json.load(f)',
      'except (FileNotFoundError, PermissionError):\n    return {}',
      "I didn't follow the notes here. except: return {} would hide a broken file.",
    ],
  },
  [TOTALS]: {
    took: [
      'total = sum(l["price"] * l["quantity"] for l in lines)\nreturn round(total, 2)',
      'def invoice_total(lines):\n    return float(sum(i.price * i.qty for i in lines))',
    ],
    set_aside: [
      'from decimal import Decimal, ROUND_HALF_UP\ntotal = sum(Decimal(str(l["price"])) * l["quantity"] for l in lines)',
      'cents = round(price * 100)\ntotal_cents = sum(cents * q for q in qty)',
      'total = sum(...)  # round(total, 2) with floats drifts, use Fraction instead',
      'amount = price_in_cents // 100',
    ],
  },
  [RETRY]: {
    took: [
      'while True:\n    try:\n        return requests.get(url, timeout=5).json()\n    except requests.RequestException:\n        continue',
      'while 1:\n    resp = client.publish(message)',
    ],
    set_aside: [
      'for attempt in range(5):\n    try:\n        return fetch(url)\n    except Exception:\n        time.sleep(2 ** attempt)',
      'while True:\n    try:\n        return f()\n    except Err:\n        time.sleep(1)',
      'while True:\n    if attempts >= 5:\n        raise\n    attempts += 1',
      'import tenacity\n@tenacity.retry\ndef go(): ...',
      'delay = backoff(attempt) + jitter()',
    ],
  },
});

test('prune: the spec covers exactly the sections its tasks aim at, which are headings of its skill', () => {
  const spec = loadSpec(PRUNE.skill);
  assert.ok(spec, 'the known-bad skill has a treatment spec');
  assert.equal(spec.skill, PRUNE.skill);
  assert.equal(spec.file, path.join(SPEC_DIR, `${PRUNE.skill}.json`));
  const targeted = [...new Set(tasksOf(PRUNE).map((t) => t.target_section))].sort();
  assert.deepEqual(Object.keys(spec.sections).sort(), targeted);
  assert.deepEqual([...headingsOf(skillText(PRUNE))].sort(), targeted);
  for (const [name, section] of Object.entries(spec.sections)) {
    assert.ok(section.directive.length > 0, `${name} states its directive`);
    assert.ok(section.followed.length > 0, `${name} has followed markers`);
    assert.ok(section.refused.length > 0, `${name} has refusal markers`);
  }
  assert.ok(spec.refusedAny.length >= 3);
});

test('prune: only the known-bad skill has a spec, so keep, null and real skills are never checked', () => {
  assert.deepEqual(fs.readdirSync(SPEC_DIR), [`${PRUNE.skill}.json`]);
  for (const c of [CONTROLS[0], CONTROLS[2]]) {
    assert.equal(loadSpec(c.skill), null);
    const records = treatmentFor(c.skill, { tasks: tasksOf(c) }, () => 'anything');
    assert.ok(Object.values(records).every((r) => r.required === false && r.adhered === true));
  }
});

for (const [section, samples] of Object.entries(SAMPLES)) {
  test(`prune: ${section}: a reply that takes the direction adheres`, () => {
    for (const text of samples.took) {
      const r = checkTreatment({ skill: PRUNE.skill, targetSection: section, answerText: text });
      assert.equal(r.required, true);
      assert.equal(r.adhered, true, `${r.reason}: ${text}`);
    }
  });

  test(`prune: ${section}: a reply that sets the direction aside does not adhere`, () => {
    for (const text of samples.set_aside) {
      const r = checkTreatment({ skill: PRUNE.skill, targetSection: section, answerText: text });
      assert.equal(r.adhered, false, `should not adhere: ${text}`);
      assert.ok(r.refused !== null || r.followed === null, text);
    }
  });
}

test('prune: a reply written for one section does not stand in for another', () => {
  const r = checkTreatment({
    skill: PRUNE.skill,
    targetSection: TOTALS,
    answerText: 'while True:\n    try:\n        return get()\n    except Err:\n        continue',
  });
  assert.equal(r.adhered, false, 'a retry loop shows nothing about money totals');
});

test('prune: every task of the set is checked against its own section', () => {
  const records = treatmentFor(PRUNE.skill, { tasks: tasksOf(PRUNE) }, () => 'plain prose');
  assert.equal(Object.keys(records).length, PRUNE.count);
  assert.ok(Object.values(records).every((r) => r.required === true && r.adhered === false));
});

test('prune: the spec describes the wrong direction in its own words, not the skill text', () => {
  const skill = skillText(PRUNE);
  const spec = JSON.parse(fs.readFileSync(path.join(SPEC_DIR, `${PRUNE.skill}.json`), 'utf8'));
  assert.deepEqual(Object.keys(spec).sort(), ['note', 'refused_any', 'sections', 'skill']);
  for (const [name, section] of Object.entries(spec.sections)) {
    assert.ok(skill.includes(`## ${name}`), name);
    assert.deepEqual(Object.keys(section).sort(), ['directive', 'followed', 'refused']);
  }
});
