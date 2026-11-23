// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/report/parse-rate.js: how often each judge's reply was readable first time, after its one re-ask, or lost.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseRates, renderParseRates } = require('../../report/parse-rate.js');

const CLI = path.join(__dirname, '..', '..', 'report', 'parse-rate.js');

function study(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-rate-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const put = (rel, j) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), JSON.stringify(j)); };
  put('cell-a/judgments.json', {
    rubric: [
      { judge: 'glm-5', parseFailures: 0, calls: [{ ok: true }] },
      { judge: 'glm-5', parseFailures: 1, calls: [{ ok: false }, { ok: true, jsonRepaired: true }] },
      { judge: 'gpt-5', parseFailures: 2, judgeError: 'unusable after retry: no JSON' },
    ],
    pairwise: [{ judge: 'gpt-5', parseFailures: 0 }, { judge: 'gpt-5', judgeError: 'ExpiredToken' }],
  });
  put('cell-b/judge/judgments.json', { graded: [{ judge: 'glm-5', parseFailures: 0 }] });
  put('cell-b/other.json', { rubric: [{ judge: 'x' }] });
  return d;
}

test('parseRates: per judge, first-try reads, reads after the re-ask, lost replies, other errors and repaired JSON', (t) => {
  const r = parseRates([study(t)]);
  assert.equal(r.files, 2);
  assert.deepEqual(r.byJudge['glm-5'], { records: 3, firstTry: 2, afterReask: 1, lost: 0, otherErrors: 0, repaired: 1 });
  assert.deepEqual(r.byJudge['gpt-5'], { records: 3, firstTry: 1, afterReask: 0, lost: 1, otherErrors: 1, repaired: 0 });
  assert.deepEqual(r.total, { records: 6, firstTry: 3, afterReask: 1, lost: 1, otherErrors: 1, repaired: 1 });
});

test('renderParseRates and the command line: a table with the first-try rate, judged replies only', (t) => {
  const d = study(t);
  const text = renderParseRates(parseRates([d]));
  assert.match(text, /\| glm-5 \| 3 \| 2 \(66\.7%\) \| 1 \| 0 \| 0 \| 1 \|/);
  assert.match(text, /\| gpt-5 \| 3 \| 1 \(50\.0%\) \| 0 \| 1 \| 1 \| 0 \|/, 'the rate leaves out replies that never came (other errors)');
  assert.match(text, /\| all \| 6 \| 3 \(60\.0%\) \|/);
  const r = spawnSync(process.execPath, [CLI, d], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, text);
  assert.equal(JSON.parse(spawnSync(process.execPath, [CLI, '--json', d], { encoding: 'utf8' }).stdout).total.records, 6);
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 64);
});
