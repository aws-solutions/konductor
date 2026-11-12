// SPDX-License-Identifier: Apache-2.0
'use strict';

// A judge failure on a rerun never replaces a record that already holds a result.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging } = require('../../judge/run.js');
const { mergeRecords } = require('../../judge/merge.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const rec = (o) => ({ judge: 'j', armId: 'a', taskId: 't', replicate: 1, judgeError: null, ...o });

test('mergeRecords keeps a valid record over a failed one and replaces a failed one with a valid one', () => {
  const good = rec({ score: 80 });
  for (const err of ['budget reached (1 credit)', 'HTTP 401 credentials rejected', 'unusable after retry: not JSON']) {
    assert.deepEqual(mergeRecords([good], [rec({ score: null, judgeError: err })]), [good]);
  }
  const bad = rec({ score: null, judgeError: 'HTTP 500' });
  const better = rec({ score: 70 });
  assert.deepEqual(mergeRecords([bad], [better]), [better]);
  const worse = rec({ score: null, judgeError: 'HTTP 401' });
  assert.deepEqual(mergeRecords([bad], [worse]), [worse]);
});

test('a rerun whose judge call fails leaves the earlier judgments.json records intact', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla' }]);
    const common = {
      runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
      limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
    };
    const ok = async ({ prompt }) => {
      const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
      return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }), credits: 0.1, latencyMs: 1 };
    };
    await runJudging({ ...common, caller: ok });
    const file = path.join(runDir, 'judgments.json');
    const first = JSON.parse(fs.readFileSync(file, 'utf8')).rubric;
    assert.equal(first.length, 1);
    assert.equal(first[0].judgeError, null);

    const down = async () => ({ text: '', error: 'HTTP 401 credentials rejected', credits: 0, latencyMs: 1 });
    fs.rmSync(path.join(runDir, 'judge'), { recursive: true, force: true });
    await runJudging({ ...common, caller: down });
    const after = JSON.parse(fs.readFileSync(file, 'utf8')).rubric;
    assert.deepEqual(after, first);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
