// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a T2 review task. It grades the agent's review against `key.json` with the bench findings-key
// grader (`findings-key.cjs`, a byte-identical copy of bench/runner/lib/findings-key.js) and turns the grader's
// score into a pass fraction the runner already counts:
//   - SLICES tests, where slice j passes when score >= (j - 0.5) / SLICES, so the passed share is the score
//     rounded to the nearest 1 / SLICES;
//   - one test per decoy (correct code that looks wrong): it passes when the review has a findings block and
//     names no location on the decoy's lines, so flagging everything costs points.
// This file is the same in every T2 hidden dir (bench/scenarios/t2/test/hidden-copies.test.js checks it).
// shortcut: the copy goes away when the runner gets a `findings` check type (bench/DEBT.md D-43).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { gradeFindings, readFindingsBlock } = require('./findings-key.cjs');

const SLICES = 20;
const LINE_SLACK = 3;
const DECOY_SLACK = 1;

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'key.json'), 'utf8'));

// The locations that count as naming an item: path:line and basename:line for every line of the item's span
// widened by `slack` (LINE_SLACK, or the item's own `slack` where two items sit close together), or the section
// number of a design document item.
function locations(item, slack) {
  if (item.section) return [String(item.section)];
  const out = [];
  const end = item.endLine ?? item.line;
  for (let l = Math.max(1, item.line - slack); l <= end + slack; l++) out.push(`${item.file}:${l}`, `${path.posix.basename(item.file)}:${l}`);
  return out;
}

// fixRequired: a finding must also say what to fix (a fix keyword), so naming a place with a generic remark scores nothing.
const key = spec.items.map((it) => ({ id: it.id, location: locations(it, it.slack ?? LINE_SLACK), severity: it.severity, fix: it.fix, fixMin: it.fixMin, fixRequired: true }));
let text = '';
try { text = fs.readFileSync(path.resolve(spec.output), 'utf8'); } catch { /* no output: every test fails */ }
const reported = readFindingsBlock(text);
const grade = gradeFindings(reported, key);

const summary = JSON.stringify({ score: grade.score, recall: grade.recall, precision: grade.precision, reported: grade.reported, matched: grade.matched, missed: grade.missed, error: grade.error });

for (let j = 1; j <= SLICES; j++) {
  test(`findings score reaches ${Math.round(((j - 0.5) / SLICES) * 100)}%`, (t) => {
    if (j === 1) t.diagnostic(summary);
    assert.ok(grade.score >= (j - 0.5) / SLICES - 1e-9, `score ${grade.score.toFixed(3)}`);
  });
}

for (const d of spec.decoys ?? []) {
  test(`decoy ${d.id} is not flagged`, () => {
    assert.ok(Array.isArray(reported), 'no findings block');
    const decoy = { id: d.id, location: locations(d, DECOY_SLACK), severity: 'low' };
    assert.equal(gradeFindings(reported, [decoy]).recall, 0, `a finding names ${d.file}:${d.line}`);
  });
}
