// SPDX-License-Identifier: Apache-2.0
/**
 * Treatment check tests: when a control pair counts, how a spec is loaded and hashed, and how the
 * check feeds aggregation and the decision rule digest. Specs here live in temporary directories;
 * the real control specs are tested with the control files.
 * Run: node --test bench/test/treatment-check.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SPEC_DIR,
  compile,
  loadSpec,
  specSha256,
  checkTreatment,
  treatmentText,
  treatmentFor,
} = require('../lib/treatment-check');
const { aggregateSkill } = require('../lib/aggregate');
const { decisionRuleFields, decisionRuleSha256 } = require('../lib/decision-rule');
const { sanitizeAnswer } = require('../lib/sanitize');
const { tempDir } = require('./support/records');
const { roster } = require('./support/roster');

const SKILL = 'toy-directions';
const SECTION = 'List Order';
const OTHER = 'Query Shape';

const SPEC = Object.freeze({
  refused_any: [
    "\\bI\\s+(?:didn['\\u2019]t|did\\s+not|chose\\s+not\\s+to)\\s+follow\\b",
    '\\bI\\s+(?:ignored|overrode)\\s+the\\s+(?:guidance|directive)\\b',
  ],
  sections: {
    [SECTION]: {
      directive: 'use list(set(items))',
      followed: ['\\blist\\(\\s*set\\('],
      refused: ['\\bdict\\.fromkeys\\b', '\\bOrderedDict\\b'],
    },
    [OTHER]: {
      directive: 'use MAX with no grouping',
      followed: ['\\bMAX\\s*\\('],
      refused: ['\\bGROUP\\s+BY\\b'],
    },
  },
});

/** A scratch spec directory holding `spec` as `<skill>.json`. */
function specDir(t, spec = SPEC, skill = SKILL) {
  const dir = tempDir(t, 'bench-treatment-');
  fs.writeFileSync(path.join(dir, `${skill}.json`), JSON.stringify(spec));
  return dir;
}

const check = (dir, targetSection, answerText, skill = SKILL) =>
  checkTreatment({ skill, targetSection, answerText, dir });

// ---- the rules ------------------------------------------------------------------------------

test('an answer that takes the direction adheres, one that does the right thing does not', (t) => {
  const dir = specDir(t);
  const took = check(dir, SECTION, 'return list(set(items))');
  assert.equal(took.required, true);
  assert.equal(took.adhered, true);
  assert.equal(took.followed, 'list(set(');
  assert.equal(took.refused, null);
  assert.match(took.reason, /^answer took the directive/);
  assert.equal(took.section, SECTION);

  const right = check(dir, SECTION, 'return list(dict.fromkeys(items))');
  assert.equal(right.adhered, false);
  assert.equal(right.refused, 'dict.fromkeys');
  assert.match(right.reason, /^answer did not take the directive/);
});

test('a refusal marker wins over a followed marker', (t) => {
  const dir = specDir(t);
  const both = check(dir, SECTION, 'Do not write list(set(items)); a set loses order. Use dict.fromkeys.');
  assert.equal(both.adhered, false, 'the bad form shown as a counter-example is not adherence');
  assert.equal(both.followed, 'list(set(');
  assert.equal(both.refused, 'dict.fromkeys');
});

test('refusal wording named at spec level applies to every section', (t) => {
  const dir = specDir(t);
  for (const section of [SECTION, OTHER]) {
    for (const text of [
      "I didn't follow the guidance. list(set(x)) MAX(total)",
      'I did not follow it. list(set(x)) MAX(total)',
      'I ignored the directive and still wrote list(set(x)) MAX(total)',
      'I chose not to follow that, but list(set(x)) MAX(total)',
    ]) {
      const r = check(dir, section, text);
      assert.equal(r.adhered, false, `${section}: ${text}`);
    }
  }
});

test('an answer with no sign of the direction does not adhere, and empty text is its own reason', (t) => {
  const dir = specDir(t);
  const quiet = check(dir, OTHER, 'Here is some unrelated prose.');
  assert.equal(quiet.adhered, false);
  assert.equal(quiet.required, true);
  assert.match(quiet.reason, /no sign of the directive/);
  for (const empty of ['', undefined, null, 7]) {
    const r = check(dir, OTHER, empty);
    assert.equal(r.adhered, false);
    assert.match(r.reason, /no answer text/);
  }
});

test('a skill with no spec has no check, so every pair counts', (t) => {
  const dir = specDir(t);
  for (const skill of ['plain-skill', 'another-skill', 'a']) {
    const r = check(dir, SECTION, 'anything at all', skill);
    assert.deepEqual(r, {
      required: false,
      adhered: true,
      followed: null,
      refused: null,
      reason: 'no treatment check',
      section: SECTION,
    });
  }
  // A directory with no spec files at all, and one that does not exist.
  assert.equal(check(tempDir(t), SECTION, 'x').required, false);
  assert.equal(check(path.join(tempDir(t), 'missing'), SECTION, 'x').required, false);
});

test('a section the spec does not name is not checked', (t) => {
  const dir = specDir(t);
  for (const section of ['Some Other Heading', undefined, null, 7, {}, ['List Order']]) {
    const r = check(dir, section, 'x');
    assert.equal(r.required, false, String(section));
    assert.equal(r.adhered, true);
    assert.equal(r.reason, 'section has no treatment check');
  }
  assert.equal(check(dir, SECTION, 'x').required, true);
});

test('section headings are plain keys: Object.prototype names are not sections, and a spec may use them', (t) => {
  const section = { directive: 'd', followed: ['yes'], refused: ['no'] };
  const dir = tempDir(t);
  // JSON.parse makes "__proto__" an own key, as a spec written by hand would.
  fs.writeFileSync(
    path.join(dir, 'with-proto.json'),
    `{"sections":{"Real":${JSON.stringify(section)},"constructor":${JSON.stringify(section)},"__proto__":${JSON.stringify(section)}}}`,
  );
  fs.writeFileSync(path.join(dir, 'plain.json'), JSON.stringify({ sections: { Real: section } }));
  for (const name of ['constructor', '__proto__']) {
    const r = check(dir, name, 'yes', 'with-proto');
    assert.equal(r.required, true, `${name} is a section of with-proto`);
    assert.equal(r.adhered, true);
  }
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'Missing']) {
    const r = check(dir, name, 'yes', 'plain');
    assert.equal(r.required, false, `${name} is not a section of plain`);
  }
  assert.equal(check(dir, 'Real', 'yes', 'plain').required, true);
});

// ---- what is read ---------------------------------------------------------------------------

test('the check reads the stored answer, so removing narration for the judge cannot hide a refusal', (t) => {
  const dir = specDir(t);
  const stored = 'I did not follow the loaded toy-directions guidance.\nresult = list(set(items))';
  const shown = sanitizeAnswer(stored, { skillName: SKILL, aliases: [] });
  assert.ok(!/did not follow/i.test(shown), 'the sanitizer drops the narration before a judge sees it');
  assert.equal(check(dir, SECTION, shown).adhered, true, 'on the cleaned text the pair would count');
  assert.equal(check(dir, SECTION, stored).adhered, false, 'on the stored text it does not');
});

test('treatmentText joins the reply with the final text of every changed file', () => {
  const pair = {
    answer: 'Done.',
    start: { 'keep.txt': 'same', 'edit.txt': 'old', 'gone.txt': 'bye' },
    final: { 'keep.txt': 'same', 'edit.txt': 'new text', 'added.txt': 'fresh' },
  };
  assert.equal(treatmentText(pair), 'Done.\nnew text\nfresh');
  assert.equal(treatmentText({ answer: 'Only a reply.', start: {}, final: {} }), 'Only a reply.');
  assert.equal(treatmentText({ answer: 'x' }), 'x');
  assert.equal(treatmentText({}), '');
  assert.equal(treatmentText(null), '');
  assert.equal(treatmentText({ answer: 7, final: { a: 'b', c: 4 } }), '\nb');
});

test('a direction taken in a changed file counts, and so does a refusal written into one', (t) => {
  const dir = specDir(t);
  const inFile = treatmentText({
    answer: 'Done.',
    start: { 'util.py': 'def dedupe(items):\n    pass\n' },
    final: { 'util.py': 'def dedupe(items):\n    return list(set(items))\n' },
  });
  assert.equal(check(dir, SECTION, inFile).adhered, true);
  const refusedInFile = treatmentText({
    answer: 'Done.',
    start: {},
    final: { 'util.py': 'return list(set(items))  # dict.fromkeys is safer\n' },
  });
  assert.equal(check(dir, SECTION, refusedInFile).adhered, false);
});

// ---- loading a spec -------------------------------------------------------------------------

test('a bad spec throws instead of silently matching nothing', (t) => {
  const dir = tempDir(t);
  const put = (name, text) => fs.writeFileSync(path.join(dir, `${name}.json`), text);
  put('bad-regex', JSON.stringify({ sections: { S: { followed: ['('] } } }));
  assert.throws(() => loadSpec('bad-regex', dir), /bad pattern/);
  put('not-array', JSON.stringify({ sections: { S: { followed: 'x' } } }));
  assert.throws(() => loadSpec('not-array', dir), /array of pattern strings/);
  put('not-strings', JSON.stringify({ sections: { S: { refused: [1] } } }));
  assert.throws(() => loadSpec('not-strings', dir), /array of pattern strings/);
  put('bad-top', JSON.stringify({ refused_any: ['['], sections: { S: {} } }));
  assert.throws(() => loadSpec('bad-top', dir), /refused_any: bad pattern/);
  put('empty', JSON.stringify({ sections: {} }));
  assert.throws(() => loadSpec('empty', dir), /no sections/);
  put('no-sections', JSON.stringify({}));
  assert.throws(() => loadSpec('no-sections', dir), /no sections/);
  put('section-not-object', JSON.stringify({ sections: { S: 'x' } }));
  assert.throws(() => loadSpec('section-not-object', dir), /expected an object/);
  put('sections-not-object', JSON.stringify({ sections: ['S'] }));
  assert.throws(() => loadSpec('sections-not-object', dir), /sections must be an object/);
  put('top-not-object', '[]');
  assert.throws(() => loadSpec('top-not-object', dir), /expected an object/);
  put('not-json', '{ nope');
  assert.throws(() => loadSpec('not-json', dir), /not valid JSON/);
  assert.throws(() => compile(['['], 'here'), /here: bad pattern/);
  assert.deepEqual(compile(undefined, 'x'), []);
  assert.deepEqual(compile(null, 'x'), []);
});

test('patterns match case-insensitively and a loaded spec reports its skill and sections', (t) => {
  const dir = specDir(t);
  const spec = loadSpec(SKILL, dir);
  assert.equal(spec.skill, SKILL);
  assert.deepEqual(Object.keys(spec.sections).sort(), [SECTION, OTHER]);
  assert.equal(spec.sections[SECTION].directive, 'use list(set(items))');
  assert.equal(check(dir, SECTION, 'RETURN LIST(SET(ITEMS))').adhered, true);
  assert.equal(loadSpec('no-such-spec', dir), null);
});

test('a skill name is a slug only: a name that could leave the directory is refused', (t) => {
  const dir = specDir(t);
  for (const bad of ['../toy', 'a/b', 'Toy', '', '..', 'x..y', 'toy\n', 7, null, undefined]) {
    assert.throws(() => loadSpec(bad, dir), /invalid skill name/, JSON.stringify(bad));
    assert.throws(
      () => checkTreatment({ skill: bad, targetSection: SECTION, answerText: 'x', dir }),
      /invalid skill name/,
    );
  }
});

test('the real spec directory is under bench/controls and is the default', () => {
  assert.equal(SPEC_DIR, path.join(__dirname, '..', 'controls', 'treatment'));
});

// ---- the digest -----------------------------------------------------------------------------

test('the spec digest changes with any edit, addition or rename, and ignores other files', (t) => {
  const dir = specDir(t);
  const base = specSha256(dir);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(specSha256(dir), base, 'stable');

  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a spec');
  fs.mkdirSync(path.join(dir, 'folder.json'));
  assert.equal(specSha256(dir), base, 'a text file and a folder do not count');

  const edited = { ...SPEC, sections: { ...SPEC.sections, [SECTION]: { ...SPEC.sections[SECTION], followed: ['x'] } } };
  const other = specDir(t, edited);
  assert.notEqual(specSha256(other), base, 'a pattern edit');

  fs.writeFileSync(path.join(dir, 'second.json'), JSON.stringify(SPEC));
  const added = specSha256(dir);
  assert.notEqual(added, base, 'an added spec');
  fs.renameSync(path.join(dir, 'second.json'), path.join(dir, 'third.json'));
  assert.notEqual(specSha256(dir), added, 'a renamed spec');

  assert.match(specSha256(path.join(dir, 'missing')), /^[0-9a-f]{64}$/, 'a missing directory is an empty set');
  assert.equal(specSha256(path.join(dir, 'missing')), specSha256(tempDir(t)), 'and equals an empty directory');
});

test('editing a spec changes decisionRuleSha256, so stored results are stale', (t) => {
  const installed = specDir(t);
  const whole = decisionRuleSha256({ treatmentDir: installed });
  assert.equal(decisionRuleFields({ treatmentDir: installed }).treatment_specs, specSha256(installed));
  assert.equal(decisionRuleSha256({ treatmentDir: installed }), whole, 'stable');

  const file = path.join(installed, `${SKILL}.json`);
  const edited = JSON.parse(fs.readFileSync(file, 'utf8'));
  edited.sections[SECTION].followed.push('\\bextra\\b');
  fs.writeFileSync(file, JSON.stringify(edited));
  assert.notEqual(decisionRuleSha256({ treatmentDir: installed }), whole, 'one added pattern');

  fs.writeFileSync(file, JSON.stringify(SPEC));
  assert.equal(decisionRuleSha256({ treatmentDir: installed }), whole, 'restoring the spec restores the digest');
  assert.notEqual(decisionRuleSha256({ treatmentDir: tempDir(t) }), whole, 'no spec at all differs from this one');
});

// ---- the task set and aggregation -----------------------------------------------------------

const taskSetOf = (sections) => ({
  tasks: sections.map((section, i) => ({ id: `t${i + 1}`, target_section: section })),
});

test('treatmentFor checks every task of a set against its own section', (t) => {
  const dir = specDir(t);
  const taskSet = taskSetOf([SECTION, OTHER, 'Unlisted']);
  const text = {
    t1: 'return list(set(items))',
    t2: 'SELECT name FROM c GROUP BY name, MAX(x)',
    t3: 'anything',
  };
  const out = treatmentFor(SKILL, taskSet, (id) => text[id], dir);
  assert.deepEqual(Object.keys(out), ['t1', 't2', 't3']);
  assert.equal(out.t1.adhered, true);
  assert.equal(out.t2.adhered, false, 'GROUP BY contradicts the no-grouping direction');
  assert.equal(out.t3.required, false);
  assert.throws(() => treatmentFor(SKILL, {}, () => '', dir), /taskSet\.tasks must be an array/);
});

test('aggregation drops pairs that did not take the direction and counts them', (t) => {
  const dir = specDir(t);
  const taskSet = taskSetOf(Array.from({ length: 10 }, () => SECTION));
  const ids = taskSet.tasks.map((task) => task.id);
  const cfg = { judges: roster(3) };
  const deltas = {};
  for (const [i, id] of ids.entries()) {
    const gap = -1 - (i % 3) * 0.25;
    deltas[id] = Object.fromEntries(cfg.judges.map((j) => [j.seat, { 'with-first': gap, 'without-first': gap }]));
  }
  const loaded = Object.fromEntries(ids.map((id) => [id, true]));
  const run = (refusing) => {
    const text = (id) => (refusing.includes(id) ? 'return list(dict.fromkeys(items))' : 'return list(set(items))');
    return aggregateSkill({
      skill: SKILL,
      taskSet,
      deltas,
      loaded,
      treatment: treatmentFor(SKILL, taskSet, text, dir),
      cfg,
    });
  };

  const none = run([]);
  assert.equal(none.verdict.verdict, 'prune', none.verdict.reason);
  assert.equal(none.graded.treatment_failed, 0);

  const some = run(['t1', 't2']);
  assert.equal(some.graded.verdict, 'prune', 'eight pairs still decide');
  assert.equal(some.graded.pairs, 8);
  assert.equal(some.graded.treatment_failed, 2);
  assert.equal(some.pairs.find((p) => p.task_id === 't1').counted, false);
  assert.equal(some.pairs.find((p) => p.task_id === 't1').adhered, false);
  assert.equal(some.pairs.find((p) => p.task_id === 't3').counted, true);

  const many = run(['t1', 't2', 't3']);
  assert.equal(many.verdict.verdict, 'needs human review');
  assert.equal(many.graded.pairs, 7);
  assert.equal(many.graded.treatment_failed, 3);
  assert.match(many.verdict.reason, /only 7 usable pairs, need at least 8 \(3\/10 failed the treatment check\)/);

  const all = run(ids);
  assert.match(all.verdict.reason, /no pair took the directive/);
});

test('a real skill is not changed by the check: its records say no check was needed', (t) => {
  const dir = specDir(t);
  const taskSet = taskSetOf([SECTION, SECTION]);
  const out = treatmentFor('plain-skill', taskSet, () => 'anything', dir);
  assert.ok(Object.values(out).every((r) => r.required === false && r.adhered === true));
  const pairs = aggregateSkill({
    skill: 'plain-skill',
    taskSet,
    loaded: { t1: true, t2: true },
    treatment: out,
    cfg: { judges: roster(3) },
  }).pairs;
  assert.ok(pairs.every((p) => p.adhered === true && p.counted === true && !('treatment' in p)));
});

test('the treatment check module imports only node:fs, node:path and sibling modules', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'lib', 'treatment-check.js'), 'utf8');
  assert.equal(text.split('\n')[0], '// SPDX-License-Identifier: Apache-2.0');
  for (const [, mod] of text.matchAll(/require\('([^']+)'\)/g)) {
    assert.ok(mod.startsWith('.') || mod === 'node:fs' || mod === 'node:path', mod);
  }
});
