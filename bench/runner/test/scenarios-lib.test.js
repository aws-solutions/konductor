// SPDX-License-Identifier: Apache-2.0
'use strict';

// The shared scenario lib (bench/scenarios/lib): shared hidden helpers at run time, the one dry-run scorer, the
// mechanical lazy and alternative answers, the prompt renderer and the authoring stage.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { evalCheck } = require('../lib/check-matcher.js');
const { sharedHelpers, addSharedHelpers, helpersHash, MANIFEST } = require('../lib/hidden-lib.js');
const { codeScore } = require('../../scenarios/lib/score.js');
const { loadConfig } = require('../../scenarios/lib/config.js');
const { dryRun, pilotWith, record } = require('../../scenarios/lib/dry-run.js');
const { shallow, vary, follow, textAnswer, writeAnswer, isCode, shallowOverlay, DEFAULTS } = require('../../scenarios/lib/answers.js');
const { fill, render } = require('../../scenarios/lib/prompt.js');
const { stageOf, COMMANDS, foldHelpers, auditStream, reviewed, withExpertRubric } = require('../../scenarios/lib/stage.js');

const T = (name, body) => `const { test } = require('node:test');\ntest(${JSON.stringify(name)}, () => { ${body} });\n`;

test('a hidden dir pulls shared helpers through .bench-lib.json, and a bad entry is refused', () => {
  const root = tmp();
  try {
    const lib = path.join(root, 'lib');
    write(path.join(lib, 'helper.js'), 'module.exports = 42;\n');
    const hid = path.join(root, 'hidden');
    write(path.join(hid, MANIFEST), JSON.stringify({ 'hidden/sub/helper.js': 'helper.js' }));
    assert.deepEqual(sharedHelpers(hid, lib).map(([rel]) => rel), ['hidden/sub/helper.js']);
    const dest = path.join(root, 'dest');
    fs.cpSync(hid, dest, { recursive: true });
    addSharedHelpers(hid, dest, lib);
    assert.equal(fs.readFileSync(path.join(dest, 'hidden/sub/helper.js'), 'utf8'), 'module.exports = 42;\n');
    assert.ok(!fs.existsSync(path.join(dest, MANIFEST)));
    const h1 = helpersHash(hid, lib);
    write(path.join(lib, 'helper.js'), 'module.exports = 43;\n');
    assert.notEqual(helpersHash(hid, lib), h1, 'a helper change is a task input change');
    assert.equal(helpersHash(path.join(root, 'none'), lib), null);
    for (const bad of [{ '../x.js': 'helper.js' }, { '/abs.js': 'helper.js' }, { 'a.js': '../helper.js' }, { 'a.js': 'missing.js' }]) {
      write(path.join(hid, MANIFEST), JSON.stringify(bad));
      assert.throws(() => sharedHelpers(hid, lib), JSON.stringify(bad));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the tests check runs a hidden suite whose grader comes from scenarios/lib/hidden', () => {
  const root = tmp();
  try {
    const ws = path.join(root, 'ws');
    write(path.join(ws, 'out.md'), '# Plan\n');
    const hid = path.join(root, 'hidden');
    // plan.test.cjs needs key.json and plan-grade.cjs beside it; the grader is the shared one.
    write(path.join(hid, 'hidden', 'key.json'), JSON.stringify({ output: 'out.md', block: 'plan', assertions: [] }));
    write(path.join(hid, 'hidden', 'own.test.js'), T('own', "require('node:assert').ok(require('node:fs').existsSync('hidden/plan-grade.cjs'));"));
    write(path.join(hid, MANIFEST), JSON.stringify({ 'hidden/plan-grade.cjs': 'plan-grade.cjs' }));
    const r = evalCheck(ws, { type: 'tests', cmd: 'node --test hidden/own.test.js' }, { hiddenDir: hid, scratchDir: path.join(root, 's') });
    assert.equal(r.detail, '1/1 hidden tests passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('codeScore is the hidden share at 0.5 and the other checks at 0.2, renormalised', () => {
  const tests = { type: 'tests', kind: 'substance', passed: false, tests: { passed: 3, total: 4 } };
  const a = { type: 'file_exists', kind: 'substance', passed: true, weight: 3 };
  const b = { type: 'contains', kind: 'substance', passed: false, weight: 1 };
  const f = { type: 'contains', kind: 'format', passed: false };
  assert.equal(codeScore([tests, a, b, f]).score.toFixed(3), (((0.5 * 0.75) + (0.2 * 0.75)) / 0.7 * 100).toFixed(3));
  assert.equal(codeScore([a, b]).score.toFixed(6), '75.000000');
  assert.equal(codeScore([tests]).score.toFixed(6), '75.000000');
});

// A batch of one task: the hidden test wants answer.md to name 4 items with a total of 100.
function batch(root) {
  const dir = path.join(root, 'tx');
  write(path.join(dir, 'fixtures', 'tx-a', 'README.md'), 'List the items.\n');
  const doc = (items) => `# Answer\n\nThe list.\n\n\`\`\`json\n${JSON.stringify({ items, total: 100 })}\n\`\`\`\n`;
  write(path.join(dir, 'solutions', 'tx-a', 'answer.md'), doc(['AB-1', 'AB-2', 'AB-3', 'AB-4']));
  const body = "const t = require('node:fs').readFileSync('answer.md', 'utf8'); const b = JSON.parse(/```json\\n([\\s\\S]*?)```/.exec(t)[1]);";
  const one = (name, check) => `test(${JSON.stringify(name)}, () => { ${body} require('node:assert').ok(${check}); });\n`;
  write(path.join(dir, 'hidden', 'tx-a', 'hidden', 'a.test.js'), `const { test } = require('node:test');\n${['AB-1', 'AB-2', 'AB-3', 'AB-4'].map((id) => one(id, `b.items.includes('${id}')`)).join('')}${one('total', 'b.total === 100')}${one('no decoy', "!b.items.includes('ZZ-9')")}`);
  const task = {
    id: 'tx-a', class: 'hard', target: null, prompt: 'List the items.', fixture: 'tx-a', hidden: 'tx-a', timeoutSec: 60,
    checks: [{ type: 'tests', cmd: 'node --test hidden/*.test.js', min: 6, weight: 3, kind: 'substance' }, { type: 'file_exists', path: 'answer.md', weight: 1, kind: 'substance' }],
    rubric: [{ id: 'r', criterion: 'c', weight: 1 }], tiers: ['full'], pilot: null,
  };
  write(path.join(dir, 'tx-a.json'), JSON.stringify(task, null, 2));
  return loadConfig({ dir, python: false, canary: { node: 'hidden/zz-canary.test.js', python: 'hidden/py/test_zz_canary.py' }, answers: { decoys: () => ['ZZ-9'] } });
}

test('the dry run scores reference, stub, lazy and alternative answers and records pilot.dryRun', () => {
  const root = tmp();
  const was = process.env.TMPDIR;
  process.env.TMPDIR = root;
  try {
    const cfg = batch(root);
    for (const kind of ['lazy', 'alt']) {
      const opts = { ...cfg.answers, decoys: cfg.answers.decoys() };
      assert.ok(writeAnswer(kind, cfg.solutionDir('tx-a'), cfg.answerDir('tx-a', kind), opts).written);
    }
    const res = dryRun('tx-a', cfg, { repeat: 2 });
    assert.deepEqual(res.scores, { reference: 100, stub: 0, lazy: 52.4, alt: 100 });
    assert.equal(res.deterministic, true);
    assert.equal(res.canary.ok, true, res.canary.detail);
    assert.equal(res.gates.lazy, false);
    assert.equal(res.pass, false);
    const pilot = record(cfg, res, '2026-11-19');
    assert.deepEqual(pilot.dryRun, { reference: 100, stub: 0, lazy: 52.4, alt: 100, date: '2026-11-19' });
    assert.equal(cfg.readTask('tx-a').pilot.decision, 'fix');
    assert.equal(pilotWith(null, { scores: { reference: 1, stub: 0 }, pass: true }, 'd'), null, 'no record without all four scores');
    assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith('dry-')), [], 'scratch is removed');
  } finally {
    process.env.TMPDIR = was;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a batch config can replace the modes and the gates (a scripted good and bad agent)', () => {
  const root = tmp();
  const was = process.env.TMPDIR;
  process.env.TMPDIR = root;
  try {
    const base = batch(root);
    const cfg = loadConfig({
      dir: base.dir, python: false,
      modes: (task, c) => [{ name: 'reference', overlay: c.solutionDir(task.id), repeat: true }, { name: 'bad', overlay: (ws) => fs.writeFileSync(path.join(ws, 'answer.md'), '') }],
      gates: (out) => ({ good: out.scores.reference === 100, bad: out.scores.bad < 100 }),
    });
    const res = dryRun('tx-a', cfg, { repeat: 1 });
    assert.deepEqual(Object.keys(res.scores), ['reference', 'bad']);
    assert.equal(res.pass, true);
  } finally {
    process.env.TMPDIR = was;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lazy halves lists, adds decoys and skews numbers and dates; alt reorders, renames own ids and rewords', () => {
  const o = { ...DEFAULTS, decoys: ['ZZ-9'] };
  assert.deepEqual(shallow({ ids: ['AB-1', 'AB-2', 'AB-3'], n: 10, when: '2026-03-22', rows: [{ a: 1 }, { a: 2 }] }, o), { ids: ['AB-1', 'AB-2', 'ZZ-9'], n: 7, when: '2026-03-01', rows: [{ a: 1 }] });
  const ids = new Map();
  const v = follow(vary({ items: [{ id: 'x', why: 'w' }, { id: 'y', why: 'v' }], top: ['x'], steps: [1, 2] }, DEFAULTS, '', ids), ids);
  assert.deepEqual(v, { steps: [1, 2], top: ['item-1'], items: [{ why: 'In short: v', id: 'item-2' }, { why: 'In short: w', id: 'item-1' }] });
  const md = '# T\n\nIntro 120 users.\n\n## A\n\none\n\ntwo\n\n## B\n\nthree\n';
  assert.equal(textAnswer('lazy', md, DEFAULTS).text, '# T\n\nIntro 84 users.\n\n## A\n\none\n\n## B\n\nthree\n');
  assert.equal(textAnswer('alt', md, DEFAULTS).text, '# T\n\nIntro 120 users.\n\n## B\n\nthree\n\n## A\n\none\n\ntwo\n');
  assert.equal(textAnswer('lazy', 'See logs/a.log:340-345 on 2025-08-21 at 14:32.\n', DEFAULTS).text, 'See logs/a.log:340-345 on 2025-08-21 at 14:32.\n');
});

test('an answer of code only has a lazy answer (half the files) and no alternative', () => {
  const root = tmp();
  try {
    write(path.join(root, 'sol', 'src', 'a.js'), 'a\n');
    write(path.join(root, 'sol', 'test', 'b.test.js'), 'b\n');
    write(path.join(root, 'sol', 'out.json'), '{"a":[1,2]}\n');
    const lazy = writeAnswer('lazy', path.join(root, 'sol'), path.join(root, 'lazy'));
    assert.deepEqual(lazy.files, { 'out.json': 'json', 'src/a.js': 'kept', 'test/b.test.js': 'dropped' });
    assert.equal(fs.readFileSync(path.join(root, 'lazy', 'out.json'), 'utf8'), '{"a":[1]}\n', 'a one-line JSON stays one line');
    fs.rmSync(path.join(root, 'sol', 'out.json'));
    assert.equal(writeAnswer('alt', path.join(root, 'sol'), path.join(root, 'alt')).written, false);
    assert.ok(!fs.existsSync(path.join(root, 'alt')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the shallow overlay lays the reference without its code changes', () => {
  const root = tmp();
  try {
    write(path.join(root, 'sol', 'src', 'a.js'), 'code\n');
    write(path.join(root, 'sol', 'test', 'a.test.js'), 'test\n');
    write(path.join(root, 'sol', 'CHANGELOG.md'), 'log\n');
    write(path.join(root, 'sol', 'DELETE.txt'), 'x\n');
    const ws = path.join(root, 'ws');
    fs.mkdirSync(ws);
    shallowOverlay(path.join(root, 'sol'))(ws);
    assert.deepEqual(fs.readdirSync(ws).sort(), ['CHANGELOG.md', 'test']);
    assert.ok(isCode('src/a.js') && !isCode('test/a.test.js') && !isCode('tests/test_x.py') && isCode('lib/x.py'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the prompt renderer fills slots from the batch brief', () => {
  assert.equal(fill('a {{X}} {{Y}}', { X: 1 }), 'a 1 {{Y}}');
  assert.throws(() => fill('{{Y}}', {}, { strict: true }), /no value for \{\{Y\}\}/);
  const root = tmp();
  try {
    write(path.join(root, 'b', 'briefs', 'b-1.json'), JSON.stringify({ brief: 'Do it', source: { url: 'https://e.org', licence: 'MIT' } }));
    write(path.join(root, 'b', 'prompts', 'author.md'), '{{BRIEF}}\n');
    const cfg = loadConfig({ dir: path.join(root, 'b'), prompt: { render: (id, lib) => lib.fill(lib.read('prompts/author.md'), { BRIEF: `${lib.brief(id).brief}. ${lib.sourceLine(lib.brief(id).source)}` }) } });
    assert.equal(render(cfg, 'b-1'), 'Do it. Public inspiration: https://e.org (licence MIT). Use the idea only.\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fold-helpers turns committed byte copies of shared helpers into .bench-lib.json entries', () => {
  const root = tmp();
  try {
    const lib = path.join(root, 'lib');
    write(path.join(lib, 'grade.cjs'), 'g\n');
    const hid = path.join(root, 'hidden');
    write(path.join(hid, 'hidden', 'grade.cjs'), 'g\n');
    write(path.join(hid, 'kit', 'grade.cjs'), 'changed\n');
    write(path.join(hid, 'kit', 'grade.js'), 'g\n');
    assert.deepEqual(foldHelpers(hid, lib), { 'hidden/grade.cjs': 'grade.cjs', 'kit/grade.js': 'grade.cjs' });
    assert.ok(!fs.existsSync(path.join(hid, 'hidden', 'grade.cjs')));
    assert.ok(fs.existsSync(path.join(hid, 'kit', 'grade.cjs')), 'a changed file is the task\'s own');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(hid, MANIFEST), 'utf8')), { 'hidden/grade.cjs': 'grade.cjs', 'kit/grade.js': 'grade.cjs' });
    assert.deepEqual(foldHelpers(hid, lib), {}, 'a second fold changes nothing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a stopped call counts at the abort limit, a refused call throws, and the run script follows runEnv', () => {
  const root = tmp();
  const was = { a: process.env.TY_AUTH, r: process.env.TY_RUN };
  try {
    const auth = path.join(root, 'auth');
    process.env.TY_AUTH = auth;
    const dir = path.join(root, 'ty');
    write(path.join(dir, 'briefs', 'x.json'), JSON.stringify({ author: 'glm-5' }));
    const s = stageOf(loadConfig({ dir, stage: { runEnv: 'TY_RUN', abortCredits: 15 } }));
    assert.equal(s.runScript(), 'run.sh');
    process.env.TY_RUN = 'checked.sh';
    assert.equal(s.runScript(), 'checked.sh');
    write(path.join(auth, 'work', 'cut.out'), `${JSON.stringify({ type: 'event' })}\n`);
    assert.deepEqual([s.creditsOf(path.join(auth, 'work', 'cut.out')).credits, s.creditsOf(path.join(auth, 'work', 'cut.out')).estimated], [15, true]);
    write(path.join(auth, 'checked.sh'), 'touch "$4.refused"\n');
    write(path.join(auth, 'work', 'x.prompt.txt'), '');
    assert.throws(() => s.call('m', path.join(auth, 'work', 'x'), 'p', 'x'), /spend check refused the x call/);
    assert.equal(COMMANDS['log-author'](s, 'x', 'none').refused, true);
  } finally {
    for (const [k, v] of [['TY_AUTH', was.a], ['TY_RUN', was.r]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pilot.dryRun takes the higher of the lazy and the shallow score', () => {
  const res = { scores: { reference: 100, stub: 5, lazy: 20, alt: 90, shallow: 38 }, pass: true };
  assert.equal(pilotWith(null, res, 'd').dryRun.lazy, 38);
  assert.equal(pilotWith(null, { ...res, scores: { ...res.scores, shallow: undefined } }, 'd').dryRun.lazy, 20);
});

test('the stage assembles a task from the batch builder and lays out its parts, with no model call', () => {
  const root = tmp();
  const was = process.env.TX_AUTH;
  try {
    const auth = path.join(root, 'auth');
    process.env.TX_AUTH = auth;
    write(path.join(auth, 'work', 'tx-b', 'fixture', 'f.txt'), 'f\n');
    write(path.join(auth, 'work', 'tx-b', 'hidden', 'h.test.js'), 'h\n');
    write(path.join(auth, 'work', 'tx-b', 'solution', 's.txt'), 's\n');
    write(path.join(auth, 'work', 'tx-b.review.json'), JSON.stringify({ model: 'glm-5', verdicts: [{ check: 'leak', verdict: 'fail', note: 'n' }] }));
    const dir = path.join(root, 'tx');
    fs.mkdirSync(dir);
    const cfg = loadConfig({ dir, stage: { buildTask: (s, id) => ({ id, review: s.workJson(`${id}.review.json`).verdicts.map((v) => s.reviewed(v, { leak: { verdict: 'fixed', note: 'done' } })) }) } });
    const s = stageOf(cfg);
    assert.equal(s.authEnv, 'TX_AUTH');
    COMMANDS.assemble(s, 'tx-b');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tx-b.json'), 'utf8')).review, [{ check: 'leak', verdict: 'fixed', note: 'done (reviewer: n)' }]);
    for (const p of ['fixtures/tx-b/f.txt', 'hidden/tx-b/h.test.js', 'solutions/tx-b/s.txt']) assert.ok(fs.existsSync(path.join(dir, p)), p);
    assert.deepEqual(reviewed({ check: 'floor', verdict: 'pass', note: 'x' }), { check: 'floor', verdict: 'pass', note: 'x' });
    assert.equal(withExpertRubric([{ id: 'r' }], { items: [] }).at(-1).id, 'expert-key');
    write(path.join(auth, 'work', 'tx-b.author.out'), `${JSON.stringify({ type: 'tool_call', path: `${auth}/work/x /home/u/konductor/skills/a/SKILL.md` })}\n`);
    assert.deepEqual(auditStream(path.join(auth, 'work', 'tx-b.author.out'), auth).unitReads, ['/home/u/konductor/skills/a/SKILL.md']);
  } finally {
    if (was === undefined) delete process.env.TX_AUTH; else process.env.TX_AUTH = was;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
