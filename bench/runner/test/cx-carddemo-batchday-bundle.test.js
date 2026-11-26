// SPDX-License-Identifier: Apache-2.0
'use strict';

// The judge must see the whole answer to cx-carddemo-batchday. This builds the judge bundle of the reference port (its
// code, its own tests and README, laid over the fixture) with the limits the task sets, and checks that no file is cut or
// left out, that the tool log keeps room, and that the largest prompt still fits the kiro backend's argv limit. Free: no
// model call, no port run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');
const { buildBundle } = require('../../judge/bundle.js');
const { effectiveLimits, maxPromptBytes, DEFAULTS } = require('../../judge/config.js');
const { rubricPrompt } = require('../../judge/prompts.js');

const COMPLEX = path.join(__dirname, '..', '..', 'complex');
const ID = 'cx-carddemo-batchday';
const task = JSON.parse(fs.readFileSync(path.join(COMPLEX, `${ID}.json`), 'utf8'));
const fixtureDir = path.join(COMPLEX, 'fixtures', ID);
const solutionDir = path.join(COMPLEX, 'solutions', ID);

/** A run directory whose workspace is the fixture with the reference port laid over it. */
function referenceRun() {
  const runDir = mkScratch('batchday-bundle-');
  const ws = path.join(runDir, 'workspace');
  fs.cpSync(fixtureDir, ws, { recursive: true });
  fs.cpSync(solutionDir, ws, { recursive: true, filter: (src) => !src.includes('__pycache__') });
  return runDir;
}

const FINAL_TEXT_ALLOWANCE = 8000; // the agent's final message and the list of deleted files

test('the task sets bundle limits that stay under the kiro prompt limit with the rubric prompt and a long final message', () => {
  assert.ok(task.bundleLimits, 'the task declares bundleLimits');
  const limits = effectiveLimits(task, DEFAULTS.limits);
  const key = fs.readFileSync(path.join(fixtureDir, '.bench-answer-key.md'), 'utf8');
  const overhead = Buffer.byteLength(rubricPrompt({ task: { ...task, fixtureDir }, answerKey: key, bundleText: '' }));
  const worst = overhead + limits.maxBundleChars + FINAL_TEXT_ALLOWANCE;
  assert.ok(worst <= maxPromptBytes('kiro'), `worst prompt ${worst} bytes is over ${maxPromptBytes('kiro')}`);
});

test('the reference answer reaches the judge whole: no truncated file, no omitted file', () => {
  const limits = effectiveLimits(task, DEFAULTS.limits);
  const bundle = buildBundle({ runDir: referenceRun(), result: {}, fixtureDir, limits, redactions: [] });
  assert.deepEqual(bundle.meta.truncatedFiles, []);
  assert.deepEqual(bundle.meta.omittedFiles, []);
  for (const f of ['carddemo_port/report.py', 'carddemo_port/statements.py', 'tests/test_day.py', 'README.md']) assert.ok(bundle.changed.includes(f), f);
  const fileChars = bundle.files.reduce((n, f) => n + (f.text?.length ?? 0), 0);
  // The tool-call log takes what the files leave, up to one file's worth: it must keep at least 15000 characters.
  assert.ok(limits.maxBundleChars - fileChars >= 15000, `files use ${fileChars} of ${limits.maxBundleChars}`);
  assert.ok(bundle.files.every((f) => (f.text?.length ?? 0) < limits.maxFileChars), 'no single file is near the per-file limit');
});

test('the default bundle cap is above the kiro prompt limit, which is why the task sets its own', () => {
  // Why the task sets its own limits: the default bundle cap (150000) is above what one kiro prompt can carry.
  assert.ok(DEFAULTS.limits.maxBundleChars > maxPromptBytes('kiro'));
});
