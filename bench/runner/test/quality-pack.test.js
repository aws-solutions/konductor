// SPDX-License-Identifier: Apache-2.0
'use strict';

// The quality pack without any run on disk: the criteria file and its lint, which criteria apply to a run, the counted
// criteria for written content, quote checking and the dimension scores. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../judge/pack/index.js');

const PACK_FILE = path.join(P.PACK_DIR, 'quality-pack.json');
const pack = P.loadPack('quality');
const clone = () => JSON.parse(JSON.stringify(pack));
const byId = (id) => pack.criteria.find((c) => c.id === id);

const file = (rel, text, orig = null) => ({ rel, created: orig === null, binary: false, text, orig });
const lines = (n, prefix = 'const v') => Array.from({ length: n }, (_, i) => `${prefix}${i} = ${i};`).join('\n');
const status = (app) => Object.fromEntries(app.criteria.map((c) => [c.criterion.id, c]));
const task = (over) => ({ id: 'x', class: 'simple', prompt: 'Do it.', ...over });

// ---- the pack file ----

test('the shipped pack passes the lint, and every criterion has three anchors, a valid artifact list and a weight', () => {
  assert.deepEqual(P.validatePack(pack), []);
  assert.ok(pack.criteria.length >= 40);
  for (const c of pack.criteria) {
    for (const lv of P.LEVELS) assert.ok(c.levels[lv].length > 20, `${c.id} ${lv}`);
    assert.ok(c.appliesTo.every((t) => t in pack.artifactTypes), c.id);
    assert.ok(c.weight >= 1);
  }
});

test('the seven requested dimensions each have criteria, and written content is a dimension of its own', () => {
  const ids = new Set(pack.criteria.map((c) => c.dimension));
  for (const d of ['modularity', 'maintainability', 'inline-docs', 'test-quality', 'scenario-coverage', 'threat-model', 'design-doc', 'doc-content']) assert.ok(ids.has(d), d);
});

test('the lint rejects a vague anchor, a long anchor, a repeated anchor, a dash and an unknown artifact type', () => {
  const bad = (edit) => { const p = clone(); edit(p.criteria[0], p); return P.validatePack(p).join(' | '); };
  assert.match(bad((c) => { c.levels.pass = 'The code is clean and well structured.'; }), /vague word.*clean/);
  assert.match(bad((c) => { c.levels.fail = 'One. Two. Three.'; }), /1 or 2 sentences/);
  assert.match(bad((c) => { c.levels.partial = c.levels.pass; }), /same anchor text/);
  assert.match(bad((c) => { c.levels.fail = `A function runs long \u2014 far too long to follow.`; }), /em or en dash/);
  assert.match(bad((c) => { c.appliesTo = ['poetry']; }), /not an artifact type/);
  assert.match(bad((c) => { delete c.levels.partial; }), /partial/);
});

test('a counted criterion states its thresholds in its anchors and cannot also carry an evidence rule', () => {
  const auto = pack.criteria.filter((c) => c.auto);
  assert.ok(auto.length >= 3);
  for (const c of auto) {
    assert.match(c.levels.partial, new RegExp(`\\b${c.auto.partialAt}\\b`), c.id);
    assert.match(c.levels.fail, new RegExp(`\\b${c.auto.failAt}\\b`), c.id);
    assert.equal(c.evidence, undefined);
  }
  const p = clone();
  const c = p.criteria.find((x) => x.auto);
  c.auto.failAt = 9;
  assert.match(P.validatePack(p).join(' | '), /does not state the threshold 9/);
});

test('the pack file contains no em dash, en dash or curly quote', () => {
  assert.doesNotMatch(fs.readFileSync(PACK_FILE, 'utf8'), /[\u2013\u2014\u2018\u2019\u201C\u201D]/);
});

test('the revision changes when an anchor changes and is stable otherwise', () => {
  const p = clone();
  assert.equal(P.packRevision(p), pack.revision);
  p.criteria[3].levels.pass += ' Extra.';
  assert.notEqual(P.packRevision(p), pack.revision);
});

test('every task the pack declares exists in the shipped task set', () => {
  const tasksDir = path.join(__dirname, '..', '..', 'tasks');
  for (const id of Object.keys(pack.taskArtifacts)) assert.ok(fs.existsSync(path.join(tasksDir, `${id}.json`)), `${id} is declared but is not a task`);
});

test('loadPack refuses an unknown name and a name that is not a plain word', () => {
  assert.throws(() => P.loadPack('nope'), /no pack "nope"/);
  assert.throws(() => P.loadPack('../x'), /not a pack name/);
});

// ---- which criteria apply ----

test('a code-only task skips the threat model and design criteria with a reason, and never scores them fail', () => {
  const app = P.applicability(pack, task({ class: 'orchestration', prompt: 'Add a feature.' }), [file('src/a.js', lines(20))]);
  const s = status(app);
  assert.equal(s['mod-single-responsibility'].status, 'judged');
  for (const id of ['tm-scope', 'tm-stride', 'tm-mitigations', 'des-consistency', 'des-problem-first']) {
    assert.equal(s[id].status, 'na', id);
    assert.match(s[id].reason, /does not ask for/);
  }
});

test('a review task skips test quality and code criteria, and gets the review criteria', () => {
  const app = P.applicability(pack, task({ class: 'review', prompt: 'Review it.' }), [file('review.md', '# Review\nThe route has no check.\n')]);
  const s = status(app);
  for (const id of ['test-asserts-behavior', 'test-rule-would-fail', 'mod-isolation', 'maint-naming', 'des-consistency', 'tm-stride']) assert.equal(s[id].status, 'na', id);
  for (const id of ['tm-scope', 'tm-mitigations', 'tm-residual', 'tm-grounded', 'cq-human-voice']) assert.equal(s[id].status, id.startsWith('cq-plain') ? 'auto' : 'judged', id);
  assert.match(s['test-asserts-behavior'].reason, /does not ask for tests/);
});

test('the threat model criterion STRIDE applies only when the task asks for a threat model', () => {
  const asks = P.applicability(pack, task({ class: 'design', prompt: 'Write a design and a threat model for the service.' }), [file('docs/tm.md', '# Threat model\n')]);
  assert.equal(status(asks)['tm-stride'].status, 'judged');
  const plain = P.applicability(pack, task({ class: 'design', prompt: 'Write a design.' }), [file('docs/d.md', '# Design\n')]);
  assert.equal(status(plain)['tm-stride'].status, 'na');
});

test('a task that asks for tests and gets none scores the test criteria fail without a judge, not n/a', () => {
  const app = P.applicability(pack, task({ class: 'orchestration', prompt: 'Add validation and add tests for it.' }), [file('src/a.js', lines(20))]);
  const s = status(app);
  assert.equal(s['test-asserts-behavior'].status, 'absent');
  assert.match(s['test-asserts-behavior'].reason, /asks for tests and none was produced/);
  const items = P.absentCriteria(app.criteria);
  assert.ok(items.every((c) => c.verdict === 'fail' && c.evidence === P.ABSENT_EVIDENCE));
  assert.ok(items.some((c) => c.id === 'scn-traced'));
});

test('tests that the task did not ask for earn nothing', () => {
  const app = P.applicability(pack, task({ class: 'orchestration', prompt: 'Add a feature.' }), [file('src/a.js', lines(20)), file('test/a.test.js', lines(30, 'assert'))]);
  const s = status(app);
  assert.equal(s['test-asserts-behavior'].status, 'na');
  assert.match(s['test-asserts-behavior'].reason, /does not ask for tests/);
});

test('a small code change is n/a with the count, and comments apply only when the agent added some', () => {
  const small = status(P.applicability(pack, task({ class: 'orchestration' }), [file('src/a.js', 'a\nb\nc\nd\n', 'a\nb\n')]));
  assert.equal(small['maint-naming'].status, 'na');
  assert.match(small['maint-naming'].reason, /too small to judge \(2 added code line/);
  const quiet = status(P.applicability(pack, task({ class: 'orchestration' }), [file('src/a.js', lines(12))]));
  assert.equal(quiet['doc-why-not-what'].status, 'na');
  assert.match(quiet['doc-why-not-what'].reason, /no comments in the changed code/);
  const noisy = status(P.applicability(pack, task({ class: 'orchestration' }), [file('src/a.js', `// keep the id stable across retries\n${lines(12)}`)]));
  assert.equal(noisy['doc-why-not-what'].status, 'judged');
});

test('a README the task asks for but the agent did not touch is n/a, not a fail', () => {
  const app = P.applicability(pack, task({ class: 'orchestration', prompt: 'Add it and update the README.' }), [file('src/a.js', lines(12))]);
  assert.equal(status(app)['cq-reader-order'].status, 'na');
});

test('declared artifacts come from the pack for known tasks and from class and prompt otherwise', () => {
  assert.deepEqual(P.declaredArtifacts(pack, { id: 'simple-explain-file', class: 'simple', prompt: '' }), ['guide']);
  assert.deepEqual(P.declaredArtifacts(pack, task({ class: 'design' })), ['design']);
  assert.deepEqual(P.declaredArtifacts(pack, task({ class: 'hard', prompt: 'Refactor and add tests. Do not touch the README.' })), ['code', 'tests']);
  assert.deepEqual(P.declaredArtifacts(pack, task({ class: 'simple', prompt: 'Rename it.' })), []);
});

test('the lite explanation task gets the written-content criteria and nothing about code', () => {
  const t = { id: 'simple-explain-file', class: 'simple', prompt: 'Explain it.' };
  const s = status(P.applicability(pack, t, [file('explanation.md', '# What csv.js does\nIt splits lines.\n')]));
  assert.equal(s['cq-lead-with-point'].status, 'judged');
  assert.equal(s['cq-no-filler-terms'].status, 'auto');
  assert.equal(s['mod-isolation'].status, 'na');
  assert.equal(s['test-names'].status, 'na');
});

// ---- the diff ----

test('lineDiff reports only the lines the agent added or removed', () => {
  const ops = P.lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.deepEqual(ops.filter((o) => o.op !== ' ').map((o) => `${o.op}${o.text}`), ['-b', '+B', '+d']);
  assert.deepEqual(P.lineDiff(null, 'x\ny').map((o) => o.op), ['+', '+']);
});

test('the diff text lists hunks with context and the change counts, and is capped', () => {
  const stats = P.changeStats([file('src/a.js', 'one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\nnine', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine')]);
  const text = P.diffText(stats);
  assert.match(text, /--- src\/a\.js \(modified: \+1 -1\)/);
  assert.match(text, /\+THREE/);
  assert.match(text, /-three/);
  assert.doesNotMatch(text, /nine/);
  assert.match(P.diffText(P.changeStats([file('big.js', 'x'.repeat(500))]), { maxChars: 100 }), /diff truncated at 100/);
});

// ---- counted criteria for written content ----

const art = (text, orig = '') => P.applicability(pack, task({ class: 'design' }), [file('docs/d.md', text, orig)]);
const counted = (text, id, orig = '') => P.autoCriteria(pack, art(text, orig).criteria).find((c) => c.id === id);

test('typography counts em dashes, en dashes, spaced double hyphens and curly quotes in prose', () => {
  const r = counted('# Title\nIt works \u2014 mostly. Range 1\u20135. Also -- this. \u201Cquoted\u201D text.\n', 'cq-plain-typography');
  assert.equal(r.count, 5);
  assert.equal(r.verdict, 'fail');
  assert.match(r.evidence, /^5 found: /);
  assert.equal(counted('# T\nOne \u2014 dash.\n', 'cq-plain-typography').verdict, 'partial');
  assert.equal(counted('# T\nPlain text, with commas.\n', 'cq-plain-typography').verdict, 'pass');
});

test('code blocks, inline code, tables and URLs are not counted as prose', () => {
  const text = '# T\nUse `a \u2014 b` here.\n\n```\nx \u2014 y\n```\n\n| a \u2014 b | c |\n\nSee https://example.org/a\u2014b for more.\n';
  assert.equal(counted(text, 'cq-plain-typography').count, 0);
});

test('only added lines count, so existing text the agent did not write is not penalized', () => {
  const orig = '# T\nOld line \u2014 with a dash.\n';
  assert.equal(counted(`${orig}New plain line.\n`, 'cq-plain-typography', orig).count, 0);
  assert.equal(counted(`${orig}New \u2014 line.\n`, 'cq-plain-typography', orig).count, 1);
});

test('filler terms are matched as whole words and phrases, case-insensitively', () => {
  const r = counted('# T\nWe leverage a seamless flow. It is worth noting that Robust code helps. The landscaper left.\n', 'cq-no-filler-terms');
  assert.equal(r.count, 4);
  assert.equal(r.verdict, 'fail');
  assert.equal(counted('# T\nRun the tests, then read the output.\n', 'cq-no-filler-terms').verdict, 'pass');
});

test('sentences over 35 words are counted', () => {
  const long = `${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}.`;
  assert.equal(counted(`# T\n${long}\nShort one.\n`, 'cq-sentence-length').count, 1);
  assert.equal(counted(`# T\n${long} ${long} ${long} ${long}\n`, 'cq-sentence-length').verdict, 'fail');
});

// ---- the prompt, quote checking and scores ----

const bundleText = '## Files\n### src/a.js (created)\nfunction add(a, b) {\n  return a + b; // sum of two numbers\n}\n';
const judged = (id) => byId(id);

test('the prompt carries the task, the answer key, only the criteria it was given, their anchors, the diff and the quote rule', () => {
  const crit = ['mod-single-responsibility', 'doc-accuracy'].map(judged);
  const prompt = P.packPrompt({ task: { prompt: 'Add add().' }, answerKey: 'KEY: add sums', bundleText, changesText: '+function add', criteria: crit });
  assert.match(prompt, /Add add\(\)\./);
  assert.match(prompt, /KEY: add sums/);
  assert.match(prompt, /### mod-single-responsibility \(modularity, weight 2\)/);
  assert.match(prompt, /fail: A function the agent added or changed does 3 or more unrelated jobs/);
  assert.match(prompt, /Quote: .*Give 2 quotes\./);
  assert.match(prompt, /<<<CHANGES-[0-9a-f]{10}\n\+function add/);
  assert.match(prompt, /<<<OUTPUT-[0-9a-f]{10}\n## Files/);
  assert.match(prompt, /exactly one entry for each criterion id: mod-single-responsibility, doc-accuracy\./);
  assert.doesNotMatch(prompt, /tm-stride|test-names/);
  assert.match(prompt, /Separate two quotes with "@@"/);
});

test('a verdict whose quote is not in the output drops one level; the judge verdict is kept as verdictRaw', () => {
  const crit = [judged('mod-single-responsibility'), judged('maint-naming'), judged('maint-dead-code')];
  const out = P.scoreReply([
    { id: 'mod-single-responsibility', verdict: 'pass', evidence: 'function add(a, b)' },
    { id: 'maint-naming', verdict: 'pass', evidence: 'function totallyInvented(x)' },
    { id: 'maint-dead-code', verdict: 'fail', evidence: 'function totallyInvented(x)' },
  ], crit, bundleText);
  assert.deepEqual(out.map((c) => [c.verdict, c.verdictRaw, c.evidenceFound]), [['pass', 'pass', true], ['partial', 'pass', false], ['fail', 'fail', false]]);
  assert.equal(out[1].evidenceDowngraded, true);
  assert.equal(out[2].evidenceDowngraded, undefined);
});

test('"(nothing in the output)" and an empty quote cannot support a pass or a partial', () => {
  const crit = [judged('mod-single-responsibility'), judged('maint-naming')];
  const out = P.scoreReply([
    { id: 'mod-single-responsibility', verdict: 'pass', evidence: '(nothing in the output)' },
    { id: 'maint-naming', verdict: 'partial', evidence: '' },
  ], crit, bundleText);
  assert.deepEqual(out.map((c) => c.verdict), ['partial', 'fail']);
});

test('a two-quote criterion needs both quotes; the second may come from the answer key', () => {
  const crit = [judged('doc-accuracy')];
  const both = 'sum of two numbers @@ return a + b';
  assert.equal(P.scoreReply([{ id: 'doc-accuracy', verdict: 'pass', evidence: both }], crit, bundleText)[0].verdict, 'pass');
  assert.equal(P.scoreReply([{ id: 'doc-accuracy', verdict: 'pass', evidence: 'sum of two numbers' }], crit, bundleText)[0].verdict, 'partial');
  assert.equal(P.scoreReply([{ id: 'doc-accuracy', verdict: 'pass', evidence: 'sum of two numbers @@ made up line' }], crit, bundleText)[0].verdict, 'partial');
  const fromKey = P.scoreReply([{ id: 'doc-accuracy', verdict: 'pass', evidence: 'sum of two numbers @@ the parser drops a doubled quote' }], crit, bundleText, 'KEY: the parser drops a doubled quote');
  assert.equal(fromKey[0].verdict, 'pass');
  const firstFromKeyOnly = P.scoreReply([{ id: 'doc-accuracy', verdict: 'pass', evidence: 'the parser drops a doubled quote @@ return a + b' }], crit, bundleText, 'KEY: the parser drops a doubled quote');
  assert.equal(firstFromKeyOnly[0].verdict, 'partial');
});

test('a quote that contains the two-quote separator characters in code does not split a one-quote criterion wrongly', () => {
  const text = 'x = a || b;\n';
  const out = P.scoreReply([{ id: 'maint-naming', verdict: 'pass', evidence: 'x = a || b;' }], [judged('maint-naming')], text);
  assert.equal(out[0].verdict, 'pass');
});

test('dimension scores are weighted, count absent criteria as fail and leave n/a out', () => {
  const crit = [
    { id: 'mod-single-responsibility', dimension: 'modularity', status: 'judged', verdict: 'pass' },
    { id: 'mod-no-duplication', dimension: 'modularity', status: 'judged', verdict: 'fail' },
    { id: 'mod-isolation', dimension: 'modularity', status: 'absent', verdict: 'fail' },
    { id: 'mod-pattern-fit', dimension: 'modularity', status: 'judged', verdict: 'partial' },
  ];
  const d = P.dimensionScores(pack, crit);
  assert.equal(d.modularity.score, (2 * 1 + 2 * 0 + 2 * 0 + 1 * 0.5) / 7);
  assert.deepEqual([d.modularity.judged, d.modularity.absent], [3, 1]);
  assert.deepEqual(d.maintainability, { score: null, judged: 0, absent: 0 });
});

// ---- documentation ----

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('the README has the pack section and the question-table row, and its commands use flags the CLI accepts', () => {
  const doc = read('README.md');
  assert.match(doc, /^## Quality dimensions pack$/m);
  assert.match(doc, /\[QUALITY-PACK\.md\]\(QUALITY-PACK\.md\)/);
  assert.match(doc, /\| `judge --run \$RUNS --criteria-pack quality` \(add `--plan` first\)|`judge --run \$RUNS --criteria-pack quality` \(add `--plan` first\)/);
  const { checkArgs } = require('../lib/cli-flags.js');
  assert.equal(checkArgs('judge', { _: [], run: 'x', 'criteria-pack': 'quality', plan: true }), null);
  assert.equal(checkArgs('report', { _: [], run: 'x', 'criteria-pack': 'quality' }), null);
});

test('the pack document lists every criterion of the pack file once, with its dimension and weight', () => {
  const doc = read('QUALITY-PACK.md');
  for (const c of pack.criteria) {
    const rows = doc.split('\n').filter((l) => l.startsWith(`| ${c.id} |`));
    assert.equal(rows.length, 1, c.id);
    assert.ok(rows[0].includes(`| ${c.weight} |`), `${c.id} weight`);
    assert.ok(rows[0].includes(c.auto ? '| program |' : '| judge |'), `${c.id} scorer`);
  }
});

test('the pack document and the README section follow the pack\'s own typography rule', () => {
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('## Quality dimensions pack'), readme.indexOf('## Calibration'));
  for (const [name, text] of [['QUALITY-PACK.md', read('QUALITY-PACK.md')], ['README section', section]]) {
    assert.deepEqual(P.DETECTORS.typography(P.proseOf(P.changeStats([file('d.md', text)]), ['d.md']), pack), [], name);
    assert.deepEqual(P.DETECTORS['long-sentences'](P.proseOf(P.changeStats([file('d.md', text)]), ['d.md']), pack), [], name);
  }
});
