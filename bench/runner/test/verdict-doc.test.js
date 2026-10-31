// SPDX-License-Identifier: Apache-2.0
'use strict';

// The verdict page (md and html) and `report --verdict platform` through the CLI.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixtureRun, mk } = require('./verdict-fixtures.js');
const { LEDGER_FILE } = require('../lib/credit-ledger.js');
const V = require('../../report/verdict.js');
const { buildVerdictDocument } = require('../../report/verdictdoc.js');
const { toMarkdown, toHtml } = require('../../report/doc.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

const ARMS = () => ({
  vanilla: { hidden: [4], credits: 1, wall: 1000 },
  v1: { sha: 'a', hidden: [9], credits: 2, wall: 3000, ref: 'v1.2.0' },
  'v1-b': { sha: 'a', hidden: [9], credits: 2, wall: 3000 },
  weak: { sha: 'b', hidden: [4], credits: 3, wall: 2000 },
  'weak-b': { sha: 'b', hidden: [4], credits: 3, wall: 2000 },
});

function page(root) {
  const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS() });
  fs.writeFileSync(path.join(dir, LEDGER_FILE), `${JSON.stringify({ kind: 'run', credits: 40 })}\n${JSON.stringify({ kind: 'judge', credits: 5 })}\n`);
  const v = V.buildVerdict({ dirs: [dir], benchDir });
  return { dir, benchDir, v, doc: buildVerdictDocument(v) };
}

test('the page leads with a verdict per arm in plain words, named by exact ref', () => {
  const root = mk();
  try {
    const { doc } = page(root);
    const md = toMarkdown(doc.blocks);
    assert.match(md, /^# Platform verdict: keep or discard/m);
    assert.match(md, /\| v1@aaaaaaa \| KEEP \| Keep\. v1@aaaaaaa scored 35\.7 points higher than vanilla/);
    assert.match(md, /\| weak@bbbbbbb \| NOT ENOUGH EVIDENCE \| Not enough evidence\. .*inside the A\/A noise/);
    assert.match(md, /A\/A repeat of v1@aaaaaaa/);
    assert.match(md, /Baseline: vanilla/);
  } finally { cleanup(root); }
});

test('the numbers table has quality /100, reliability /100, a cost ratio and a latency ratio, and no efficiency score', () => {
  const root = mk();
  try {
    const md = toMarkdown(page(root).doc.blocks);
    const head = md.split('\n').find((l) => /\| arm \|.*Quality/.test(l));
    assert.ok(head, 'a numbers table');
    assert.match(head, /Quality \/100/);
    assert.match(head, /Reliability \/100/);
    assert.match(head, /Cost ratio/);
    assert.match(head, /Latency ratio/);
    assert.doesNotMatch(head, /Efficiency \/100|Efficiency score/i);
    assert.match(md, /2\.00x/);
    assert.match(md, /3\.00x/);
  } finally { cleanup(root); }
});

test('the evidence table shows sample sizes, the A/A noise, the diligence rating and the failed-run counts', () => {
  const root = mk();
  try {
    const md = toMarkdown(page(root).doc.blocks);
    assert.match(md, /## How much evidence/);
    assert.match(md, /\| v1@aaaaaaa \| 10 \/ 10 \| 2 \| 5 \| .*5\.0 points \| indicative \|/);
    assert.match(md, /## Failed runs/);
    assert.match(md, /No run is dropped/);
  } finally { cleanup(root); }
});

test('the run directory table shows the ledger total and the labels of the arms that ran', () => {
  const root = mk();
  try {
    const md = toMarkdown(page(root).doc.blocks);
    assert.match(md, /## Run directories/);
    assert.match(md, /45\.00 credits \(runs 40\.00, judge 5\.00\)/);
    assert.match(md, /v1@aaaaaaa, v1-b@aaaaaaa/);
  } finally { cleanup(root); }
});

test('the rules are printed on the page', () => {
  const root = mk();
  try {
    const md = toMarkdown(page(root).doc.blocks);
    assert.match(md, /fewer than 3 runs/);
    assert.match(md, /inside the A\/A noise/);
    assert.match(md, /anecdotal/);
    assert.match(md, /Efficiency is a ratio, never a 0 to 100 number/);
  } finally { cleanup(root); }
});

test('the html has the verdict colours, an inline chart and no script or external resource', () => {
  const root = mk();
  try {
    const { doc } = page(root);
    const html = toHtml(doc.blocks, { title: doc.title });
    assert.match(html, /<span class="st pass">KEEP<\/span>/);
    assert.match(html, /<span class="st warn">NOT ENOUGH EVIDENCE<\/span>/);
    assert.match(html, /<svg/);
    assert.doesNotMatch(html, /<script|src=|href=|https?:\/\//i);
    assert.ok(doc.charts.has('verdict-quality'));
  } finally { cleanup(root); }
});

test('a DISCARD gets the fail colour', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r2', { arms: { vanilla: { hidden: [9] }, bad: { sha: 'c', hidden: [3] }, 'bad-b': { sha: 'c', hidden: [3] } } });
    const doc = buildVerdictDocument(V.buildVerdict({ dirs: [dir], benchDir }));
    assert.match(toHtml(doc.blocks), /<span class="st fail">DISCARD<\/span>/);
  } finally { cleanup(root); }
});

// ---- CLI ----

function cli(root, args) {
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  return spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: root } });
}

test('report --verdict platform writes verdict.md, .html, .json and the chart, prints the verdicts, and writes no normal report', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS() });
    const out = path.join(root, 'out');
    const r = cli(root, ['report', '--verdict', 'platform', '--run', dir, '--bench-dir', benchDir, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['verdict.md', 'verdict.html', 'verdict.json', 'charts/verdict-quality.svg']) assert.ok(fs.existsSync(path.join(out, f)), f);
    assert.equal(fs.existsSync(path.join(out, 'report.md')), false);
    assert.match(r.stdout, /v1@aaaaaaa\s+KEEP/);
    assert.match(r.stdout, /weak@bbbbbbb\s+NOT ENOUGH EVIDENCE/);
    const j = JSON.parse(fs.readFileSync(path.join(out, 'verdict.json'), 'utf8'));
    assert.equal(j.arms.find((a) => a.label === 'v1@aaaaaaa').verdict, 'KEEP');
    assert.equal(j.baselineLabel, 'vanilla');
  } finally { cleanup(root); }
});

test('report --verdict platform with one run directory and no --out writes into that directory; --format md skips the html', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS() });
    const r = cli(root, ['report', '--verdict', 'platform', '--run', dir, '--bench-dir', benchDir, '--format', 'md']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'verdict.md')));
    assert.equal(fs.existsSync(path.join(dir, 'verdict.html')), false);
  } finally { cleanup(root); }
});

test('report --verdict platform takes several run directories and needs --out for them; an unknown verdict kind is refused', () => {
  const root = mk();
  try {
    const one = fixtureRun(root, 'lite', { arms: ARMS() });
    const two = fixtureRun(root, 'real', { bench: one.benchDir, arms: ARMS() });
    const dirs = `${one.dir},${two.dir}`;
    const noOut = cli(root, ['report', '--verdict', 'platform', '--run', dirs, '--bench-dir', one.benchDir]);
    assert.equal(noOut.status, 1);
    assert.match(noOut.stderr, /pass --out/);
    const ok = cli(root, ['report', '--verdict', 'platform', '--run', dirs, '--bench-dir', one.benchDir, '--out', path.join(root, 'o')]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'o', 'verdict.json'), 'utf8')).arms.find((a) => a.label === 'v1@aaaaaaa').runs, 20);
    const bad = cli(root, ['report', '--verdict', 'global', '--run', one.dir, '--bench-dir', one.benchDir]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--verdict takes platform/);
  } finally { cleanup(root); }
});

test('report --verdict platform --profile detailed adds the profile check per run directory', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS() });
    const out = path.join(root, 'o');
    const r = cli(root, ['report', '--verdict', 'platform', '--run', dir, '--bench-dir', benchDir, '--out', out, '--profile', 'detailed', '--format', 'md']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(out, 'verdict.md'), 'utf8'), /profile detailed: NOT MET/);
  } finally { cleanup(root); }
});
