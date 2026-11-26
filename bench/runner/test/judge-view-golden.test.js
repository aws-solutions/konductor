// SPDX-License-Identifier: Apache-2.0
'use strict';

// The default judge view (`bundle`) is today's view byte for byte: the bundle text, the expert text, the rubric prompt and
// the cache file name of one fixed run are pinned to the values taken before judge views existed (base 9b4688efb).
// A change here changes every cached answer of every study, so it must be on purpose. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { viewOf } = require('../../judge/view/index.js');
const { rubricPrompt } = require('../../judge/prompts.js');
const { withCache } = require('../../judge/model.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

const GOLDEN = {
  text: 'c251396e7f3851880a77c95db88d989b5484879fefb6f0d95d0e7a3fac8f0fdd',
  expertText: 'c251396e7f3851880a77c95db88d989b5484879fefb6f0d95d0e7a3fac8f0fdd',
  prompt: '88b598c8b71beaea596a393c7328402874ca1eea2e4e90f36dda8ad7ad8fb7b1',
  cacheFile: '5d6d7d2072ad214f28cddf93b93131801f83208b6d44a8c8a8da0d53886dc268.json',
};

function goldenRun() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{
    arm: 'vanilla', finalText: 'fixed a.txt and added notes', files: { 'a.txt': 'alpha fixed\n', 'docs/notes.md': '# Notes\nline two\n', 'b.txt': null },
  }]);
  return { root, bench, runDir: path.join(runDir, 'vanilla', 't1', '1') };
}

/** The four pinned values of the fixed run, built the way the default view builds them. */
async function values() {
  const g = goldenRun();
  try {
    const task = { id: 't1', prompt: 'Fix the thing.', rubric: [{ id: 'c1', weight: 1, criterion: 'a.txt is fixed' }] };
    const result = JSON.parse(fs.readFileSync(path.join(g.runDir, 'result.json'), 'utf8'));
    const view = viewOf('bundle');
    const input = view.prepare({ runDir: g.runDir, result, fixtureDir: path.join(g.bench, 'fixtures', 'fx'), limits: { maxFileChars: 60000, maxBundleChars: 150000 }, redactions: compileRedactions(DEFAULT_REDACTIONS) });
    const { bundle } = input;
    assert.equal(input.promptText, bundle.text);
    const prompt = rubricPrompt({ task, answerKey: 'KEY', bundleText: input.promptText, preface: input.preface });
    const cacheDir = path.join(g.root, 'cache');
    await withCache(async () => ({ text: '{}', credits: 0, latencyMs: 1 }), cacheDir, { salt: (m) => `opencode\n${m}`, parts: view.cacheParts(input) })({ model: 'glm-5', prompt });
    return { text: sha(bundle.text), expertText: sha(bundle.expertText), prompt: sha(prompt), cacheFile: fs.readdirSync(cacheDir)[0] };
  } finally { fs.rmSync(g.root, { recursive: true, force: true }); }
}

module.exports = { values, GOLDEN };

test('the bundle view is today\'s view byte for byte: bundle text, expert text, prompt and cache key are pinned', async () => {
  const v = await values();
  if (process.env.BENCH_PRINT_GOLDEN) console.log(JSON.stringify(v, null, 2));
  assert.deepEqual(v, GOLDEN);
});
