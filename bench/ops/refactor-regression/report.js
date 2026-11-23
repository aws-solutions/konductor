#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The markdown of a refactor regression diff: the exit code of every study step on each side, then every file that
// differs after normalisation (diff.js), and the files on one side only. stderr logs are left out: they carry
// progress lines and timings, and every fact they report is also in a result, a report or an exit code.
//
// With --noise STUDY_DIR (a second run of the head), a difference that also shows between the two head runs is marked
// noise: it changes from run to run (a timing, a random order), so it says nothing about the refactors.
//
//   report.js --base STUDY_DIR --head STUDY_DIR [--noise STUDY_DIR] [--base-label L] [--head-label L] [--out FILE]

const fs = require('node:fs');
const path = require('node:path');
const { diffTrees } = require('./diff.js');

const MAX_ROWS = 40;
const argOf = (argv, k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const show = (v) => (v === undefined ? '(absent)' : JSON.stringify(v).slice(0, 160)).replace(/\|/g, '\\|');

/** The tree of one study the diff reads: runs, reports, and each command's stdout and exit code (no stderr). */
function stagedTree(study, into) {
  fs.mkdirSync(into, { recursive: true });
  for (const d of ['runs', 'reports']) if (fs.existsSync(path.join(study, d))) fs.cpSync(path.join(study, d), path.join(into, d), { recursive: true });
  const cmds = path.join(study, 'commands');
  fs.mkdirSync(path.join(into, 'commands'), { recursive: true });
  for (const f of fs.readdirSync(cmds).filter((x) => x.endsWith('.out.txt') || x.endsWith('.json'))) fs.copyFileSync(path.join(cmds, f), path.join(into, 'commands', f));
}

/** Markdown for the diff of two study dirs. */
function renderDiff({ base, head, noise = null, baseLabel = 'base', headLabel = 'head' }) {
  const steps = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'study.json'), 'utf8')).steps;
  const bs = new Map(steps(base).map((s) => [s.name, s.exitCode]));
  const hs = new Map(steps(head).map((s) => [s.name, s.exitCode]));
  const staged = fs.mkdtempSync(path.join(path.dirname(path.resolve(base)), 'diff-'));
  try {
    stagedTree(base, path.join(staged, 'b'));
    stagedTree(head, path.join(staged, 'h'));
    const treeOf = (study) => JSON.parse(fs.readFileSync(path.join(study, 'study.json'), 'utf8')).tree;
    const rootsOf = (study, tag) => [path.resolve(study), treeOf(study), path.join(staged, tag)];
    const d = diffTrees(path.join(staged, 'b'), path.join(staged, 'h'), { baseRoots: rootsOf(base, 'b'), headRoots: rootsOf(head, 'h') });
    // What differs between two runs of the same head: a json path, or a whole text file.
    const noisy = new Set();
    if (noise) {
      stagedTree(noise, path.join(staged, 'n'));
      for (const c of diffTrees(path.join(staged, 'h'), path.join(staged, 'n'), { baseRoots: rootsOf(head, 'h'), headRoots: rootsOf(noise, 'n') }).changed) {
        if (c.json) for (const x of c.json) noisy.add(`${c.file}|${x.path}`);
        else noisy.add(`${c.file}|text`);
      }
    }
    const isNoise = (file, p) => noisy.has(`${file}|${p}`);
    const L = [`Base ${baseLabel}, head ${headLabel}. ${d.same} file(s) the same after normalisation, ${d.changed.length} differ, ${d.onlyBase.length} only in base, ${d.onlyHead.length} only in head.`, '',
      '| step | exit base | exit head |', '| --- | --- | --- |'];
    for (const n of [...new Set([...bs.keys(), ...hs.keys()])]) L.push(`| ${n} | ${bs.get(n) ?? '-'} | ${hs.get(n) ?? '-'}${bs.get(n) === hs.get(n) ? '' : ' **differs**'} |`);
    if (d.onlyBase.length) L.push('', 'Only in base:', '', ...d.onlyBase.map((f) => `- \`${f}\``));
    if (d.onlyHead.length) L.push('', 'Only in head:', '', ...d.onlyHead.map((f) => `- \`${f}\``));
    for (const c of d.changed) {
      L.push('', `### \`${c.file}\``, '');
      if (c.error) L.push(c.error);
      else if (c.json) {
        const real = c.json.filter((x) => !isNoise(c.file, x.path));
        const n = c.json.length - real.length;
        if (n) L.push(`${n} path(s) also differ between two head runs (noise), not listed.`, '');
        if (real.length) L.push('| path | base | head |', '| --- | --- | --- |');
        for (const x of real.slice(0, MAX_ROWS)) L.push(`| \`${x.path}\` | ${show(x.base)} | ${show(x.head)} |`);
        if (real.length > MAX_ROWS) L.push(`| ... | ${real.length - MAX_ROWS} more | |`);
      } else if (isNoise(c.file, 'text')) {
        L.push('This file also differs between two head runs (noise); its lines:', '');
        for (const l of c.text.onlyBase.slice(0, 8)) L.push(`- base: \`${l.slice(0, 200).replace(/`/g, "'")}\``);
        for (const l of c.text.onlyHead.slice(0, 8)) L.push(`- head: \`${l.slice(0, 200).replace(/`/g, "'")}\``);
      } else {
        for (const l of c.text.onlyBase.slice(0, MAX_ROWS)) L.push(`- base: \`${l.slice(0, 200).replace(/`/g, "'")}\``);
        for (const l of c.text.onlyHead.slice(0, MAX_ROWS)) L.push(`- head: \`${l.slice(0, 200).replace(/`/g, "'")}\``);
      }
    }
    return { text: `${L.join('\n')}\n`, diff: d };
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const base = argOf(a, '--base');
  const head = argOf(a, '--head');
  if (!base || !head) { process.stderr.write('usage: report.js --base STUDY --head STUDY [--base-label L] [--head-label L] [--out FILE]\n'); process.exit(64); }
  const { text } = renderDiff({ base, head, noise: argOf(a, '--noise'), baseLabel: argOf(a, '--base-label') ?? 'base', headLabel: argOf(a, '--head-label') ?? 'head' });
  const out = argOf(a, '--out');
  if (out) fs.writeFileSync(out, text);
  process.stdout.write(text);
}

module.exports = { renderDiff, stagedTree };
