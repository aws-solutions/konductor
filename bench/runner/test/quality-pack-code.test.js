// SPDX-License-Identifier: Apache-2.0
'use strict';

// The code-quality criteria of the quality pack: concurrency, extensibility, non-functional targets in code, the
// missing-pattern rule and enterprise patterns. All five are declared-only, so they apply only to a task that asks for
// them. Also the Pattern key rule and the reference-tree calibration sheet. Fake data and the bench's own trees; no
// model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../judge/pack/index.js');
const { exportReferenceSheet, overlayChanges } = require('../../judge/calibrate-reference.js');
const { tmp } = require('./helpers.js');

const BENCH = path.join(__dirname, '..', '..');
const pack = P.loadPack('quality');
const file = (rel, text, orig = null) => ({ rel, created: orig === null, binary: false, text, orig });
const lines = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n');
const status = (app) => Object.fromEntries(app.criteria.map((c) => [c.criterion.id, c]));

const NEW = {
  concurrency: ['conc-shared-state', 'conc-async-errors', 'conc-timeout-cancel'],
  extensibility: ['ext-one-place', 'ext-closed-core'],
  'nfr-code': ['code-nfr-mechanism', 'code-nfr-bounded'],
  'enterprise-patterns': ['ent-pattern-applied'],
};
const TYPE_OF = {
  'conc-shared-state': 'concurrency', 'conc-async-errors': 'concurrency', 'conc-timeout-cancel': 'concurrency',
  'ext-one-place': 'extension', 'ext-closed-core': 'extension',
  'code-nfr-mechanism': 'nfr-code', 'code-nfr-bounded': 'nfr-code',
  'mod-pattern-missing': 'pattern-key', 'ent-pattern-applied': 'enterprise-pattern',
};
const TASKS = { 'hard-seat-holds': 'concurrency', 'hard-export-formats': 'extension', 'hard-catalog-limits': 'nfr-code' };

test('the new dimensions hold the listed criteria, each applies to one declared-only type, and the pack lints clean', () => {
  assert.deepEqual(P.validatePack(pack), []);
  for (const [dim, ids] of Object.entries(NEW)) assert.deepEqual(pack.criteria.filter((c) => c.dimension === dim).map((c) => c.id), ids, dim);
  for (const [id, type] of Object.entries(TYPE_OF)) {
    const c = pack.criteria.find((x) => x.id === id);
    assert.deepEqual(c.appliesTo, [type], id);
    assert.ok(pack.declaredOnly.includes(type), type);
  }
  assert.equal(pack.criteria.find((c) => c.id === 'mod-pattern-missing').dimension, 'modularity');
});

test('the answer-key criteria ask for a second quote, so a verdict names the Pattern key or design line it rests on', () => {
  for (const id of ['mod-pattern-missing', 'ent-pattern-applied', 'code-nfr-mechanism']) assert.equal(pack.criteria.find((c) => c.id === id).evidence.minQuotes, 2, id);
});

test('a task that does not declare the types gets n/a for every new criterion, however much code it changed', () => {
  const app = status(P.applicability(pack, { id: 'x', class: 'hard', prompt: 'Fix it.' }, [file('src/a.js', lines(40), 'x\n')]));
  for (const id of Object.keys(TYPE_OF)) {
    assert.equal(app[id].status, 'na', id);
    assert.match(app[id].reason, /does not ask for/, id);
  }
  assert.equal(app['mod-pattern-fit'].status, 'judged', 'the extra-abstraction rule still applies to any code');
});

test('each new task gets its own criteria judged and the others n/a', () => {
  for (const [taskId, type] of Object.entries(TASKS)) {
    const app = status(P.applicability(pack, { id: taskId, class: 'hard', prompt: 'Do it.' }, [file('src/a.js', lines(20), 'x\n')]));
    for (const [id, t] of Object.entries(TYPE_OF)) {
      const declared = pack.taskArtifacts[taskId].includes(t);
      assert.equal(app[id].status, declared ? 'judged' : 'na', `${taskId} ${id}`);
    }
    assert.ok(pack.taskArtifacts[taskId].includes(type), taskId);
  }
});

test('the new criteria share the code size floor: a 3-line change is too small to judge', () => {
  const app = status(P.applicability(pack, { id: 'hard-seat-holds', class: 'hard', prompt: 'Do it.' }, [file('src/a.js', lines(3), 'x\n')]));
  for (const id of NEW.concurrency) assert.match(app[id].reason, /too small to judge/, id);
});

test('a declared type whose code was not changed scores fail without a model call', () => {
  const app = status(P.applicability(pack, { id: 'hard-export-formats', class: 'hard', prompt: 'Do it.' }, [file('README.md', '# R\nmore\n', '# R\n')]));
  for (const id of [...NEW.extensibility, 'mod-pattern-missing']) assert.equal(app[id].status, 'absent', id);
});

test('patternKeyProblems needs a Pattern key section with needed and enterprise lines for the declared types', () => {
  const key = '# k\n\n## Pattern key\n\n- needed: a registry.\n- enterprise: anti-corruption layer.\n\n## Hidden tests\n';
  assert.deepEqual(P.patternKeyProblems(['code', 'pattern-key', 'enterprise-pattern'], key), []);
  assert.deepEqual(P.patternKeyProblems(['code'], null), [], 'nothing asked, nothing needed');
  assert.match(P.patternKeyProblems(['pattern-key'], '# k\n## Notes\n- needed: x\n')[0], /no "## Pattern key" section/);
  assert.match(P.patternKeyProblems(['enterprise-pattern'], '## Pattern key\n- needed: x\n')[0], /no "- enterprise:" line/);
  assert.match(P.patternKeyProblems(['pattern-key'], '## Pattern key\n- accepted: x\n')[0], /no "- needed:" line/);
});

test('every bench task that declares a pattern type has the Pattern key its criteria are judged against', () => {
  const { loadTasks, suiteExtraDirs } = require('../lib/tasks.js');
  // The shipped tasks and every suite's extra task directory (pack scenarios, complex tasks).
  const extraDirs = fs.readdirSync(path.join(BENCH, 'suites')).filter((f) => f.endsWith('.json') && !f.endsWith('.manifest.json'))
    .flatMap((f) => suiteExtraDirs(path.basename(f, '.json'), BENCH));
  const tasks = loadTasks(BENCH, { extraDirs: [...new Set(extraDirs)] });
  for (const [taskId, types] of Object.entries(pack.taskArtifacts)) {
    if (!types.some((t) => t === 'pattern-key' || t === 'enterprise-pattern')) continue;
    const task = tasks.get(taskId);
    const key = fs.readFileSync(path.join(task.fixtureDir, '.bench-answer-key.md'), 'utf8');
    assert.deepEqual(P.patternKeyProblems(types, key), [], taskId);
  }
});

test('overlayChanges lists only files an overlay changes or adds, with the fixture text as orig', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'fx', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ov', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fx', 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(root, 'fx', 'src', 'b.js'), 'b\n');
  fs.writeFileSync(path.join(root, 'ov', 'src', 'a.js'), 'a2\n');
  fs.writeFileSync(path.join(root, 'ov', 'src', 'b.js'), 'b\n');
  fs.writeFileSync(path.join(root, 'ov', 'src', 'c.js'), 'c\n');
  assert.deepEqual(overlayChanges(path.join(root, 'fx'), path.join(root, 'ov')).map((f) => [f.rel, f.orig, f.created]), [['src/a.js', 'a\n', false], ['src/c.js', null, true]]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the reference-tree sheet is blind: items carry no tree name, key.json maps each item, labels start empty', () => {
  const out = tmp();
  const r = exportReferenceSheet({ benchDir: BENCH, taskIds: ['hard-seat-holds'], criteriaIds: NEW.concurrency, outDir: out, seed: 3 });
  const sheet = JSON.parse(fs.readFileSync(r.sheetPath, 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
  assert.equal(r.n, 3, 'reference and two partials');
  assert.deepEqual(Object.values(key.items).map((k) => k.tree).sort(), ['partial:deadline-only', 'partial:lock-only', 'reference']);
  for (const it of sheet.items) {
    assert.deepEqual(it.criteria.map((c) => c.id), NEW.concurrency);
    assert.ok(Object.values(it.labels).every((v) => v === null));
    assert.ok(!/partial|reference/.test(JSON.stringify({ id: it.itemId, notes: it.notes })), 'no tree name in the item');
  }
  assert.equal(sheet.pack.revision, pack.revision);
  assert.throws(() => exportReferenceSheet({ benchDir: BENCH, taskIds: ['hard-seat-holds'], criteriaIds: ['no-such'], outDir: out }), /not in pack/);
  fs.rmSync(out, { recursive: true, force: true });
});
