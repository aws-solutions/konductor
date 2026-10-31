// SPDX-License-Identifier: Apache-2.0
'use strict';

// report and contrast at both detail levels and in both formats, on synthetic runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun, addTask, writeJudgments } = require('./helpers.js');
const { wellFormed } = require('./svg-check.js');
const { toMarkdown, toHtml, mdToHtml } = require('../../report/doc.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const reps = (arm, n, f = () => ({}), task = 't1') => Array.from({ length: n }, (_, i) => ({ arm, task, rep: i + 1, ...f(i + 1) }));

function setup({ specs, judged = false, tasks = { t2: 'review' }, cfg }) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  for (const [id, cls] of Object.entries(tasks)) addTask(bench, id, cls);
  const runDir = makeRun(path.join(root, 'run'), bench, specs, cfg);
  if (judged) {
    const arms = [...new Set(specs.map((s) => s.arm))];
    const keys = specs.map((s) => ({ arm: s.arm, task: s.task || 't1', rep: s.rep || 1 }));
    const rubric = ['j1', 'j2', 'j3'].flatMap((judge, ji) => keys.map((k) => ({ judge, ...k, score: 0.8 - ji * 0.05, criteria: { c1: 'pass', c2: ji === 0 ? 'pass' : 'partial' } })));
    const pairwise = ['j1', 'j2', 'j3'].flatMap((judge) => keys.filter((k) => k.arm !== 'vanilla').map((k) => ({ judge, ...k, verdict: 'win' })));
    writeJudgments(runDir, { judges: ['j1', 'j2', 'j3'], rubric, pairwise: arms.length > 1 ? pairwise : [] });
  }
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const tmpd = path.join(root, 'tmp'); fs.mkdirSync(tmpd);
  const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmpd } });
  return { root, bench, runDir, cli, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const three = () => [...reps('vanilla', 3, () => ({ credits: 1 })), ...reps('v1.2.0', 3, () => ({ credits: 3 })), ...reps('v1.2.0', 3, () => ({ credits: 3 }), 't2'), ...reps('vanilla', 3, () => ({ credits: 1 }), 't2')];
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');

test('quick: scorecard, flags, headline table, scatter and dot plot; nothing from the full-only sections', () => {
  const s = setup({ specs: three(), judged: true });
  try {
    const out = path.join(s.root, 'o');
    const r = s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--detail', 'quick', '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const md = read(out, 'report.md');
    assert.match(md, /## Diligence scorecard/);
    assert.match(md, /Overall rating: (anecdotal|indicative|supported)/);
    assert.match(md, /## Top 3 flags/);
    assert.match(md, /## Scores/);
    assert.match(md, /!\[[^\]]+\]\(charts\/cost-vs-quality\.svg\)/);
    assert.match(md, /!\[[^\]]+\]\(charts\/dots-quality\.svg\)/);
    assert.ok(!/## Appendix|## Detailed tables|## Spend/.test(md));
    assert.deepEqual(fs.readdirSync(path.join(out, 'charts')).sort(), ['cost-vs-quality.svg', 'dots-quality.svg']);
    assert.ok(md.split('\n').filter((l) => /^- (FAIL|WARN):/.test(l)).length <= 3);
    assert.ok(md.split('\n').length < 60, 'one screen');
  } finally { s.done(); }
});

test('full: every section, every chart well-formed, and the existing text tables unchanged inside', () => {
  const s = setup({ specs: three(), judged: true });
  try {
    const out = path.join(s.root, 'o');
    const r = s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const md = read(out, 'report.md');
    for (const h of ['## Diligence scorecard', '## Scores with components', '## Cost and effort by arm', '## Per task', '## Judges', '## Spend', '## Appendix: provenance and how to reproduce', '## Detailed tables']) assert.ok(md.includes(h), h);
    const files = fs.readdirSync(path.join(out, 'charts'));
    for (const must of ['cost-vs-quality', 'dots-quality', 'dots-cost', 'bars-credits', 'bars-wall', 'bars-model-calls', 'bars-work-tool-calls', 'bars-subagent-calls', 'forest-quality', 'forest-cost', 'judge-agreement', 'pairwise', 'spend', 'durations']) assert.ok(files.includes(`${must}.svg`), must);
    for (const f of files) assert.equal(wellFormed(read(path.join(out, 'charts'), f)), null, f);
    const { buildReport } = require('../../report/aggregate.js');
    const { loadRun } = require('../../report/load.js');
    const { loadTasks } = require('../lib/tasks.js');
    const { renderMarkdown } = require('../../report/render.js');
    const legacy = renderMarkdown(buildReport({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), baseline: 'vanilla' }).report).replace(/^# Benchmark report\n+/, '').replace(/^(#{1,6})(\s)/gm, '#$1$2');
    assert.ok(md.includes(legacy.trim()), 'the legacy tables are embedded verbatim');
  } finally { s.done(); }
});

test('formats: md writes no html, html writes no md or charts folder, both writes all', () => {
  const s = setup({ specs: three() });
  try {
    for (const [fmt, md, html, charts] of [['md', true, false, true], ['html', false, true, false], ['both', true, true, true]]) {
      const out = path.join(s.root, `o-${fmt}`);
      const r = s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--detail', 'quick', '--format', fmt, '--out', out]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(fs.existsSync(path.join(out, 'report.md')), md, fmt);
      assert.equal(fs.existsSync(path.join(out, 'report.html')), html, fmt);
      assert.equal(fs.existsSync(path.join(out, 'charts')), charts, fmt);
      assert.ok(fs.existsSync(path.join(out, 'report.json')), 'json is always written');
    }
  } finally { s.done(); }
});

test('html is one file: inline css and svg, no scripts, no external references', () => {
  const s = setup({ specs: three(), judged: true });
  try {
    const out = path.join(s.root, 'o');
    assert.equal(s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', out]).status, 0);
    const html = read(out, 'report.html');
    assert.match(html, /<style>/);
    assert.match(html, /<svg /);
    assert.ok(!/https?:\/\//.test(html), 'no URL at all');
    assert.ok(!/\s(src|href)=/i.test(html));
    assert.ok(!/<script|<link|<iframe|<img|@import|url\(/i.test(html));
    assert.match(html, /<span class="st (pass|warn|fail|na)">/);
    assert.match(html, /@media print/);
  } finally { s.done(); }
});

test('a run without judgments still renders and says which charts are left out', () => {
  const s = setup({ specs: three() });
  try {
    const out = path.join(s.root, 'o');
    const r = s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const md = read(out, 'report.md');
    assert.match(md, /Not judged/);
    assert.match(md, /## Not shown/);
    assert.match(md, /Judge charts/);
    assert.ok(!fs.existsSync(path.join(out, 'charts', 'judge-agreement.svg')));
  } finally { s.done(); }
});

test('report.json keeps its keys and adds scores, diligence and detail', () => {
  const s = setup({ specs: three(), judged: true });
  try {
    const out = path.join(s.root, 'o');
    assert.equal(s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', out]).status, 0);
    const j = JSON.parse(read(out, 'report.json'));
    for (const k of ['schemaVersion', 'harness', 'costUnit', 'run', 'baseline', 'judges', 'scopes', 'arms', 'judging', 'checksRecheck']) assert.ok(k in j, k);
    assert.equal(j.detail, 'full');
    assert.ok(j.scores.arms.vanilla.overall.quality.n === 6);
    assert.ok(['anecdotal', 'indicative', 'supported'].includes(j.diligence.rating));
    assert.ok(j.diligence.criteria.every((c) => ['PASS', 'WARN', 'FAIL', 'N/A'].includes(c.status)));
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(j)));
  } finally { s.done(); }
});

test('the default write goes beside the results and keeps the old file names', () => {
  const s = setup({ specs: three() });
  try {
    assert.equal(s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench]).status, 0);
    for (const f of ['report.md', 'report.json', 'report.html']) assert.ok(fs.existsSync(path.join(s.runDir, f)), f);
    assert.equal(s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', path.join(s.root, 'x', 'mine.md'), '--detail', 'quick']).status, 0);
    assert.ok(fs.existsSync(path.join(s.root, 'x', 'mine.md')) && fs.existsSync(path.join(s.root, 'x', 'mine.json')));
  } finally { s.done(); }
});

test('output is deterministic: two runs give identical bytes', () => {
  const s = setup({ specs: three(), judged: true });
  try {
    const a = path.join(s.root, 'a'); const b = path.join(s.root, 'b');
    for (const o of [a, b]) assert.equal(s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', o]).status, 0);
    for (const f of ['report.md', 'report.html', 'report.json', 'charts/cost-vs-quality.svg', 'charts/forest-quality.svg']) assert.equal(read(a, f), read(b, f), f);
  } finally { s.done(); }
});

test('bad --detail or --format is an error and writes nothing', () => {
  const s = setup({ specs: three() });
  try {
    for (const args of [['--detail', 'huge'], ['--format', 'pdf']]) {
      const out = path.join(s.root, 'bad');
      const r = s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', out, ...args]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /takes/);
      assert.ok(!fs.existsSync(out));
    }
  } finally { s.done(); }
});

test('several run directories merge into one run; they need --out and are not written to', () => {
  const s = setup({ specs: reps('vanilla', 2).concat(reps('v1.2.0', 2)) });
  const s2 = setup({ specs: reps('vanilla', 2).concat(reps('v1.2.0', 2)) });
  try {
    const both = `${s.runDir},${s2.runDir}`;
    const bad = s.cli(['report', '--run', both, '--bench-dir', s.bench]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /--out/);
    const out = path.join(s.root, 'merged');
    const r = s.cli(['report', '--run', both, '--bench-dir', s.bench, '--out', out, '--detail', 'quick']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(read(out, 'report.json'));
    assert.equal(j.scores.arms.vanilla.overall.reliability.n, 4, 'colliding replicates are kept, not overwritten');
    assert.deepEqual(fs.readdirSync(s.runDir).sort(), ['run-config.json', 'v1.2.0', 'vanilla']);
    assert.equal(j.diligence.criteria.find((c) => c.id === 'aa').status, 'PASS', 'a repeat from another directory is a same-ref repeat');
  } finally { s.done(); s2.done(); }
});

test('contrast writes md, html, json and charts to --out and leaves the run directory alone', () => {
  const s = setup({ specs: [...reps('v1.2.0', 3, () => ({ credits: 3 })), ...reps('pr', 3, () => ({ credits: 4 })), ...reps('v1.2.0', 3, () => ({ credits: 3 }), 't2'), ...reps('pr', 3, () => ({ credits: 4 }), 't2')] });
  try {
    const out = path.join(s.root, 'c');
    const r = s.cli(['contrast', '--run', s.runDir, '--bench-dir', s.bench, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(s.runDir).sort(), ['pr', 'run-config.json', 'v1.2.0']);
    const md = read(out, 'contrast.md');
    assert.match(md, /^# Contrast: pr vs v1\.2\.0/);
    assert.match(md, /## Diligence scorecard \(subset\)/);
    assert.match(md, /pr vs v1\.2\.0/);
    assert.ok(fs.existsSync(path.join(out, 'contrast.html')) && fs.existsSync(path.join(out, 'contrast.json')));
    const files = fs.readdirSync(path.join(out, 'charts'));
    assert.ok(files.includes('forest-quality.svg') && files.includes('forest-cost.svg'));
    const q = path.join(s.root, 'q');
    assert.equal(s.cli(['contrast', '--run', s.runDir, '--bench-dir', s.bench, '--out', q, '--detail', 'quick', '--format', 'md']).status, 0);
    assert.ok(read(q, 'contrast.md').length < md.length);
    assert.ok(!fs.existsSync(path.join(q, 'contrast.html')));
    assert.ok(!/Contrast tables \(the existing report/.test(read(q, 'contrast.md')));
  } finally { s.done(); }
});

test('the markdown to html converter escapes text and keeps tables, lists and breaks', () => {
  const html = mdToHtml('# T <x>\n\n| a | b |\n|---|---|\n| 1<br>2 | `c&d` |\n\n- one **two**\n\nplain & text');
  assert.match(html, /<h1>T &lt;x&gt;<\/h1>/);
  assert.match(html, /<td>1<br>2<\/td>/);
  assert.match(html, /<code>c&amp;d<\/code>/);
  assert.match(html, /<li>one <strong>two<\/strong><\/li>/);
  assert.match(html, /plain &amp; text/);
  assert.ok(!html.includes('<x>'));
});

test('markdown and html renderers drop nothing: every table row and heading shows in both', () => {
  const blocks = [{ t: 'h', level: 2, text: 'Head & more' }, { t: 'table', head: ['a', 'b'], rows: [['1', 'PASS'], ['2', 'FAIL']] }, { t: 'list', items: ['x', 'y'] }];
  const md = toMarkdown(blocks);
  const html = toHtml(blocks);
  for (const needle of ['Head', '1', '2', 'x', 'y']) { assert.ok(md.includes(needle)); assert.ok(html.includes(needle)); }
  assert.match(html, /Head &amp; more/);
  assert.match(html, /class="st fail"/);
});

test('capability studies need known-answer controls; tasks mark them with "control"', () => {
  const s = setup({ specs: [...reps('base', 3), ...reps('head', 3), ...reps('base', 3, () => ({}), 'tc'), ...reps('head', 3, () => ({}), 'tn')], tasks: {} });
  try {
    const mk = (id, control) => {
      const t = JSON.parse(fs.readFileSync(path.join(s.bench, 'tasks/t1.json'), 'utf8'));
      fs.writeFileSync(path.join(s.bench, `tasks/${id}.json`), JSON.stringify({ ...t, id, target: 'skill:x', ...(control ? { control } : {}) }));
    };
    mk('tc', 'positive'); mk('tn', 'negative');
    const t1 = JSON.parse(fs.readFileSync(path.join(s.bench, 'tasks/t1.json'), 'utf8'));
    fs.writeFileSync(path.join(s.bench, 'tasks/t1.json'), JSON.stringify({ ...t1, target: 'skill:x' }));
    const out = path.join(s.root, 'o');
    const r = s.cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--out', out, '--baseline', 'base', '--detail', 'quick']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(read(out, 'report.json'));
    assert.equal(j.diligence.criteria.find((c) => c.id === 'controls').status, 'PASS');
  } finally { s.done(); }
});
