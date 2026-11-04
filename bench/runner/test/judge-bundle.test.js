// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { buildBundle } = require('../../judge/bundle.js');
const { DEFAULT_REDACTIONS, compileRedactions, redact } = require('../../judge/redact.js');
const { DEFAULTS } = require('../../judge/config.js');

function setup(spec, benchOpts) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'), benchOpts);
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'v1.2.0', ...spec }]);
  const dir = path.join(runDir, 'v1.2.0/t1/1');
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const redactions = compileRedactions(DEFAULT_REDACTIONS);
  const build = (limits = DEFAULTS.limits) => buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits, redactions });
  return { root, build };
}

test('bundle has final text, changed files only, and check results', () => {
  const { root, build } = setup({ finalText: 'All fixed.', files: { 'a.txt': 'alpha fixed\n', 'new.md': '# notes\n' } });
  try {
    const { text } = build();
    assert.match(text, /All fixed\./);
    assert.match(text, /a\.txt/);
    assert.match(text, /alpha fixed/);
    assert.match(text, /new\.md/);
    assert.doesNotMatch(text, /bravo/, 'unchanged fixture file must not be shown');
    assert.match(text, /PASS file_exists a\.txt/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bundle never contains the transcript, tool names, or the answer key', () => {
  const { root, build } = setup({ finalText: 'ok', files: { 'a.txt': 'x\n' } });
  try {
    const { text } = build();
    assert.doesNotMatch(text, /tool_call|toolName|subagent|KEY: the seeded/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bundle notes deleted files and skips tool state directories', () => {
  const { root, build } = setup({ files: { 'b.txt': null, '.konductor/memory.json': '{}', '.kiro/agents/x.json': 'y' } });
  try {
    const { text, meta } = build();
    assert.match(text, /deleted.*b\.txt/s);
    assert.doesNotMatch(text, /memory\.json|x\.json/);
    assert.equal(meta.excluded, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('per-file and total limits truncate and say so', () => {
  const big = 'z'.repeat(500);
  const { root, build } = setup({ files: { 'a.txt': big, 'c.txt': big, 'd.txt': big } });
  try {
    const { text, meta } = build({ maxFileChars: 100, maxBundleChars: 200 });
    assert.match(text, /truncated at 100 chars/);
    assert.ok(meta.truncatedFiles.includes('a.txt'));
    assert.match(text, /omitted: bundle limit/);
    assert.ok(meta.omittedFiles.length >= 1);
    assert.ok(text.length < 2000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('arm-revealing tokens are redacted and counted by rule', () => {
  const dirty = 'The k-developer agent, via the konductor orchestrator, delegated this to a subagent (v1.2.0). Called find_skills.';
  const { root, build } = setup({ finalText: dirty, files: { 'a.txt': 'konductor was here\n' } });
  try {
    const { text, fired } = build();
    for (const bad of [/k-developer/i, /konductor/i, /subagent/i, /delegat/i, /orchestrator/i, /v1\.2\.0/, /find_skills/]) {
      assert.doesNotMatch(text, bad);
    }
    assert.ok(fired['agent-name'] >= 1 && fired['tool-name'] >= 2 && fired['delegation'] >= 2 && fired['version'] >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('redact keeps ordinary fixture versions and supports custom rules', () => {
  const rules = compileRedactions([...DEFAULT_REDACTIONS, { id: 'custom', pattern: 'secret-word', flags: 'gi', replacement: '[X]' }]);
  const { text, fired } = redact('bump 0.1.0 to 0.1.1, Secret-Word', rules);
  assert.equal(text, 'bump 0.1.0 to 0.1.1, [X]');
  assert.deepEqual(fired, { custom: 1 });
});

test('binary files are compared by content, not size', () => {
  const { root, build } = setup({ files: { 'a.bin': 'x' } });
  try {
    const base = path.join(root, 'bench/fixtures/fx/a.bin');
    fs.writeFileSync(base, Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(root, 'run/v1.2.0/t1/1/workspace/a.bin'), Buffer.from([0, 1, 2, 4]));
    fs.writeFileSync(path.join(root, 'run/v1.2.0/t1/1/workspace/b.bin'), Buffer.from([9, 0]));
    fs.writeFileSync(path.join(root, 'bench/fixtures/fx/b.bin'), Buffer.from([9, 0]));
    const { text } = build();
    assert.match(text, /a\.bin \(modified\)\n\(binary file, 4 bytes\)/);
    assert.doesNotMatch(text, /b\.bin/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const CC_FIXTURES = path.join(__dirname, 'fixtures', 'claude-code');

function claudeCodeBundle(fixture) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'cc-vanilla', harness: 'claude-code' }]);
  const dir = path.join(runDir, 'cc-vanilla/t1/1');
  fs.copyFileSync(path.join(CC_FIXTURES, `${fixture}.stream.jsonl`), path.join(dir, 'stream.jsonl'));
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const text = buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS) }).text;
  return { root, text };
}

test('a Claude Code run shows its final text to the judge', () => {
  for (const [fixture, expected] of [['delegation-dashed-pin', /This small, clean script defines a type-annotated/], ['vanilla-success', /## Final assistant text\nhi\n/]]) {
    const { root, text } = claudeCodeBundle(fixture);
    try {
      assert.match(text, expected, fixture);
      assert.doesNotMatch(text, /Final assistant text\n\(none\)/, fixture);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('a Claude Code run killed before its result line shows the last assistant text, not nothing', () => {
  const { root, text } = claudeCodeBundle('sigterm');
  try {
    assert.match(text, /## Final assistant text\n/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
