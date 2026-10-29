// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { countLabelledFindings } = require('../lib/findings.js');
const { runChecks } = require('../lib/checks.js');

const count = (text) => countLabelledFindings(text).count;

test('severity in section headings above numbered finding headings', () => {
  const md = '# Review\n\n## Critical\n\n### 1. SQL injection\nbody\n\n### 2. No auth\nbody\n\n## Important\n\n### 3. No validation\nbody\n\n## Minor\n\n### 4. Timing\nbody\n';
  assert.equal(count(md), 4);
});

test('severity as a label line inside each finding block', () => {
  const md = '## Findings\n\n### 1. SQL injection\n- Severity: Critical\n- File: a.js:1\n\n### 2. Stack leak\n**Severity:** Important\n\n### 3. Timing\nSeverity - Minor\n';
  assert.equal(count(md), 3);
});

test('severity in a table, with a summary count table ignored', () => {
  const md = '| Severity | Count |\n|---|---|\n| Critical | 2 |\n| Important | 5 |\n| Minor | 2 |\n\n| # | Severity | Finding |\n|---|---|---|\n| 1 | Critical | SQL injection |\n| 2 | Important | Leak |\n| 3 | Minor | Timing |\n';
  assert.equal(count(md), 3);
});

test('a table of findings and the same findings as headings count once', () => {
  const md = '| # | Severity | Finding |\n|---|---|---|\n| 1 | Critical | SQLi |\n| 2 | Minor | Timing |\n\n## Critical\n### 1. SQLi\ntext\n## Minor\n### 2. Timing\ntext\n';
  assert.equal(count(md), 2);
});

test('numbering that restarts per severity section does not merge findings', () => {
  const md = '## Critical\n### 1. A\n### 2. B\n## Important\n### 1. C\n### 2. D\n### 3. E\n';
  assert.equal(count(md), 5);
});

test('inline labels at the start of a bullet, with brackets or a dash', () => {
  const md = '- Critical: SQL injection\n- [Important] Stack leak\n1. Minor - timing\n2. (Important) no body limit\n';
  assert.equal(count(md), 4);
});

test('bullets under a bare severity heading are findings; nested bullets and later sections are not', () => {
  const md = '## Critical\n- SQL injection\n  - sub detail\n- No auth\n\n## Checked, no finding\n- path traversal\n- xss\n';
  assert.equal(count(md), 2);
});

test('bold-only severity line works as a section marker', () => {
  const md = '**Critical**\n- SQL injection\n- No auth\n\n**Minor**\n- Timing\n';
  assert.equal(count(md), 3);
});

test('bullets inside a finding block are not extra findings', () => {
  const md = '## Important\n### 1. delta never validated\n- "abc" becomes NaN\n- 1.5 is stored\n- -100 goes negative\n#### Fix\n- reject non-integers\n';
  assert.equal(count(md), 1);
});

test('rows under a severity section count when no cell is a label; header rows do not', () => {
  const md = '## Critical\n\n| Finding | Location |\n|---|---|\n| SQLi | itemRepo.js:22 |\n| No auth | items.js:25 |\n';
  assert.equal(count(md), 2);
});

test('fenced code is ignored', () => {
  const md = '## Critical\n### 1. SQLi\n```\n## Minor\n### 2. fake\n- Critical: also fake\n```\n';
  assert.equal(count(md), 1);
});

test('negative: severity words in prose or a bare summary produce no findings', () => {
  assert.equal(count('There are Critical, Important and Minor issues. Critical things are bad. Important to fix. Minor ones too. Minor. Critical.'), 0);
  assert.equal(count('| Severity | Count |\n|---|---|\n| Critical | 2 |\n| Important | 5 |\n| Minor | 2 |\n'), 0);
  assert.equal(count('## Critical\n\n## Important\n\n## Minor\n'), 0);
});

test('negative: a heading without severity anywhere is not a labelled finding', () => {
  assert.equal(count('# Review\n### 1. SQLi\n### 2. Auth\n### 3. Leak\n### 4. Timing\n'), 0);
});

test('negative: a count line is not a finding', () => {
  assert.equal(count('- Critical: 2\n- Important: 5\n- Minor: 2\n'), 0);
});

test('custom labels', () => {
  assert.equal(countLabelledFindings('- Blocker: a\n- Nit: b\n', ['blocker', 'nit']).count, 2);
});

test('labelled_findings check type through runChecks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-find-'));
  try {
    fs.writeFileSync(path.join(dir, 'r.md'), '## Critical\n### 1. A\n### 2. B\n## Minor\n### 3. C\n');
    const r = runChecks(dir, [
      { type: 'labelled_findings', path: 'r.md', min: 3 },
      { type: 'labelled_findings', path: 'r.md', min: 4 },
      { type: 'labelled_findings', path: 'missing.md', min: 1 },
    ]);
    assert.deepEqual(r.map((c) => c.passed), [true, false, false]);
    assert.match(r[0].detail, /3 labelled findings, need 3/);
    assert.equal(r[2].detail, 'file missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
