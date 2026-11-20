#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free dry run of one T2 task: scores the reference solution, an empty stub and a dump that flags every changed line
// (or every subsection of a design document)
// three times each with the runner's own check code, and reports whether the scores repeat.
// Usage: node dry-run.js <task-id>   (prints JSON; exit 1 when a gate fails)
// Gates: reference >= 95, stub <= 20, shallow fake <= 40, dump <= 55, alt (the reference in another valid style) >= 90, every check passes the reference, identical results over 3 repeats.
// Score = (0.5 x hidden-test share + 0.2 x substance-check share) / 0.7 x 100: the default weights with the
// rubric left out, as a run with no judge is scored.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runChecks } = require('../../runner/lib/checks.js');

const DIR = __dirname;
const id = process.argv[2];
const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
const fixtureDir = path.join(DIR, 'fixtures', task.fixture);
const hiddenDir = path.join(DIR, 'hidden', task.hidden);
const solutionDir = path.join(DIR, 'solutions', id);

function score(results) {
  const tests = results.find((r) => r.type === 'tests');
  const h = tests?.tests ? tests.tests.passed / Math.max(1, tests.tests.total) : 0;
  let w = 0, p = 0;
  task.checks.forEach((c, i) => {
    if (c.type === 'tests' || c.kind !== 'substance') return;
    w += c.weight ?? 1;
    if (results[i].passed) p += c.weight ?? 1;
  });
  return Math.round(((0.5 * h + 0.2 * (w ? p / w : 0)) / 0.7) * 1000) / 10;
}

// A review that names every added line of every changed file with a medium severity: the long-list baseline.
function dumpReview(root) {
  const diffs = fs.readdirSync(path.join(root, 'pr'), { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => path.join(root, 'pr', d.name, 'changes.diff')).filter((f) => fs.existsSync(f));
  const items = [];
  for (const f of diffs) {
    let file = null, line = 0;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/^\+\+\+ b\/(.*)$/);
      if (m) { file = m[1]; continue; }
      const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (h) { line = Number(h[1]); continue; }
      if (!file) continue;
      if (l.startsWith('+')) { items.push({ location: `${file}:${line}`, severity: 'medium', issue: 'check this line', fix: 'review' }); line++; }
      else if (!l.startsWith('-')) line++;
    }
  }
  return `# Review\n\n\`\`\`json\n${JSON.stringify(items, null, 1)}\n\`\`\`\n`;
}

// A review that names every subsection of the design document with a medium severity: the long-list baseline.
function dumpDesign(root) {
  const doc = fs.readFileSync(path.join(root, task.checks.find((c) => c.type === 'fixture_unchanged').path), 'utf8');
  const items = [...doc.matchAll(/^#+\s*(\d+(?:\.\d+)+)/gm)].map((m) => ({ location: m[1], severity: 'medium', issue: 'check this section', fix: 'review' }));
  return `# Review\n\n\`\`\`json\n${JSON.stringify(items, null, 1)}\n\`\`\`\n`;
}

// The reference findings written another valid way: a line range for code, "Section N" for design,
// wrapped as {"findings": [...]} after an unrelated json block. A correct review in another style must still score.
function altReview() {
  const ref = fs.readFileSync(path.join(solutionDir, 'REVIEW.md'), 'utf8');
  const m = [...ref.matchAll(/^```json[ \t]*\n([\s\S]*?)^```[ \t]*$/gim)].pop();
  const list = JSON.parse(m[1]);
  const alt = list.reverse().map((f) => {
    const loc = String(f.location);
    const code = loc.match(/([A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+):(\d+)/);
    return { ...f, location: code ? `${code[1]}:${code[2]}-${Number(code[2]) + 2}` : `Section ${loc}` };
  });
  return `# Review\n\nNotes first.\n\n\`\`\`json\n{"verdict": "changes requested"}\n\`\`\`\n\nFindings:\n\n\`\`\`json\n${JSON.stringify({ findings: alt }, null, 1)}\n\`\`\`\n`;
}

// A shallow fake review: one generic finding per changed file (at its first added line) or per top-level section of
// the design document (at its first subsection). It names real places and sounds plausible, but finds nothing.
function shallowReview(root) {
  const full = JSON.parse(task.class === 'design' ? dumpDesign(root).match(/```json\n([\s\S]*?)```/)[1] : dumpReview(root).match(/```json\n([\s\S]*?)```/)[1]);
  const seen = new Set();
  const items = full.filter((f) => {
    const k = task.class === 'design' ? String(f.location).split('.')[0] : String(f.location).split(':')[0];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((f) => ({ location: f.location, severity: 'medium', issue: 'This part needs more error handling and tests.', fix: 'add tests and handle errors' }));
  return `# Review\n\nOverall this looks reasonable; a few general points.\n\n\`\`\`json\n${JSON.stringify(items, null, 1)}\n\`\`\`\n`;
}

function runOnce(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `t2dry-${id}-`));
  try {
    fs.cpSync(fixtureDir, root, { recursive: true });
    if (kind === 'reference') fs.cpSync(solutionDir, root, { recursive: true });
    if (kind === 'shallow') fs.writeFileSync(path.join(root, 'REVIEW.md'), shallowReview(root));
    if (kind === 'alt') fs.writeFileSync(path.join(root, 'REVIEW.md'), altReview());
    if (kind === 'dump') fs.writeFileSync(path.join(root, 'REVIEW.md'), task.class === 'design' ? dumpDesign(root) : dumpReview(root));
    const results = runChecks(root, task.checks, { pristineDir: fixtureDir, hiddenDir, scratchDir: path.join(root, '..', `${path.basename(root)}-chk`) });
    fs.rmSync(path.join(root, '..', `${path.basename(root)}-chk`), { recursive: true, force: true });
    return { score: score(results), checks: results.map((r) => `${r.passed ? 'pass' : 'FAIL'} ${r.type}${r.tests ? ` ${r.tests.passed}/${r.tests.total}` : ''}`) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const kinds = ['reference', 'stub', ...(task.controlKind !== 'twin' ? ['alt', 'shallow', 'dump'] : [])];
const out = {};
for (const k of kinds) {
  const runs = [runOnce(k), runOnce(k), runOnce(k)];
  out[k] = { ...runs[0], repeatable: runs.every((r) => JSON.stringify(r) === JSON.stringify(runs[0])) };
}
const gates = {
  reference: out.reference.score >= 95,
  referenceAllChecks: out.reference.checks.every((c) => c.startsWith('pass')),
  stub: out.stub.score <= 20,
  repeatable: kinds.every((k) => out[k].repeatable),
  // A list that names every changed line or every subsection must not pass for a review.
  ...(out.dump ? { dump: out.dump.score <= 55 } : {}),
  ...(out.alt ? { alt: out.alt.score >= 90 } : {}),
  ...(out.shallow ? { shallow: out.shallow.score <= 40 } : {}),
};
console.log(JSON.stringify({ id, ...out, gates }, null, 1));
process.exit(Object.values(gates).every(Boolean) ? 0 : 1);
