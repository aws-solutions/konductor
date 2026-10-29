// SPDX-License-Identifier: Apache-2.0
'use strict';

// The judge bundle of an autonomy run lists the questions the agent asked and the answers it received.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { buildBundle } = require('../../judge/bundle.js');
const { DEFAULT_REDACTIONS, compileRedactions } = require('../../judge/redact.js');
const { DEFAULTS } = require('../../judge/config.js');

function setup(spec) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'v1.2.0', ...spec }]);
  const dir = path.join(runDir, 'v1.2.0/t1/1');
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const redactions = compileRedactions(DEFAULT_REDACTIONS);
  return { root, build: () => buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: DEFAULTS.limits, redactions }) };
}

const QUESTIONS = [
  { turn: 1, text: 'Should the timeout be in seconds or milliseconds?', matched: ['unit'], answered: true, reply: 'Seconds.' },
  { turn: 2, text: 'I asked the konductor orchestrator; delegate to k-developer?', matched: [], answered: true, reply: 'Use your best judgment and continue.' },
  { turn: 3, text: 'One more thing?', matched: [], answered: false, reply: '' },
];

test('an autonomy run gets a Conversation block with each question and the answer it received', () => {
  const { root, build } = setup({ finalText: 'Done.', turns: 3, interjections: 2, questions: QUESTIONS, files: { 'a.txt': 'changed\n' } });
  try {
    const { text } = build();
    const i = text.indexOf('## Conversation');
    assert.ok(i > text.indexOf('## Final assistant text'));
    assert.ok(i < text.indexOf('## Files created or changed'));
    assert.match(text, /Should the timeout be in seconds or milliseconds\?/);
    assert.match(text, /Reply: Seconds\./);
    assert.match(text, /Reply: Use your best judgment and continue\./);
    assert.match(text, /No reply was sent/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the Conversation block is redacted like the rest of the bundle and names no arm', () => {
  const { root, build } = setup({ finalText: 'Done.', turns: 3, interjections: 2, questions: QUESTIONS });
  try {
    const { text, fired } = build();
    assert.doesNotMatch(text, /konductor|k-developer|orchestrator|v1\.2\.0/i);
    assert.ok(fired['agent-name'] >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an autonomy run that asked nothing says so', () => {
  const { root, build } = setup({ finalText: 'Done.', turns: 1, interjections: 0, questions: [] });
  try {
    assert.match(build().text, /## Conversation\nThe agent asked no question\./);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a run without autonomy data has no Conversation block', () => {
  const { root, build } = setup({ finalText: 'Done.' });
  try {
    assert.doesNotMatch(build().text, /Conversation/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
