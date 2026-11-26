// SPDX-License-Identifier: Apache-2.0
'use strict';

// The read judge view's copy (bench/judge/view/read-copy.js): built from the bundle's own scrubbed and redacted file
// texts, deliverables only, with instruction files, tool folders, long lines and arm-revealing names pasted instead of
// copied, and written as plain files under a root with no instruction file above it. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { buildBundle, READ_POINTER } = require('../../judge/bundle.js');
const { buildReadInput, writeCopy, instructionFilesAbove, MAX_LINE_CHARS } = require('../../judge/view/read-copy.js');
const { viewOf } = require('../../judge/view/index.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const SECRET = 'AKIAREADVIEWSECRET01';
const LIMITS = { maxFileChars: 60000, maxBundleChars: 150000 };

function fixture() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const files = {
    'a.txt': 'alpha fixed\n',
    'src/main.py': `def main():\n    key = "${SECRET}"\n    return 1  # the k-developer agent wrote this\n`,
    'AGENTS.md': '# Agents\nbe nice\n',
    'docs/CLAUDE.md': 'claude notes\n',
    'sub/deep/CONTEXT.md': 'context notes\n',
    '.kiro/specs/plan.md': 'the plan\n',
    'wide.txt': `${'x'.repeat(MAX_LINE_CHARS + 1)}\nshort\n`,
    'k-developer-notes.md': 'notes\n',
    'img.bin': Buffer.from([0, 1, 2, 3]),
  };
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', finalText: 'done', files: Object.fromEntries(Object.entries(files).filter(([, v]) => typeof v === 'string')) }]);
  const dir = path.join(runDir, 'vanilla', 't1', '1');
  fs.writeFileSync(path.join(dir, 'workspace', 'img.bin'), files['img.bin']);
  fs.symlinkSync('/etc/hostname', path.join(dir, 'workspace', 'link.txt'));
  fs.writeFileSync(path.join(dir, 'workspace', '.bench-answer-key.md'), 'the key\n');
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const args = { runDir: dir, result, fixtureDir: path.join(bench, 'fixtures', 'fx'), limits: LIMITS, redactions: compileRedactions(DEFAULT_REDACTIONS), literals: [SECRET] };
  return { root, dir, args, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the copy holds only plain deliverables; instruction files, tool folders, long lines and revealing names are pasted', () => {
  const f = fixture();
  try {
    const input = buildReadInput(f.args);
    assert.deepEqual(input.copy.files.map((x) => x.rel), ['a.txt', 'src/main.py']);
    assert.deepEqual(Object.fromEntries(input.pasted.map((p) => [p.rel, p.reason])), {
      '.kiro/specs/plan.md': 'tool folder', 'AGENTS.md': 'instruction file', 'docs/CLAUDE.md': 'instruction file',
      'k-developer-notes.md': 'name changed by redaction', 'sub/deep/CONTEXT.md': 'instruction file', 'wide.txt': `a line over ${MAX_LINE_CHARS} characters`,
    });
    const all = input.copy.files.map((x) => x.rel).join(' ');
    for (const bad of ['img.bin', 'link.txt', '.bench-answer-key.md', 'b.txt']) assert.ok(!all.includes(bad), bad);
  } finally { f.cleanup(); }
});

test('copy texts are the bundle\'s scrubbed and redacted texts; the prompt pastes the rest and points at the copy', () => {
  const f = fixture();
  try {
    const input = buildReadInput(f.args);
    const main = input.copy.files.find((x) => x.rel === 'src/main.py').text;
    assert.ok(!main.includes(SECRET), 'credential scrubbed');
    assert.ok(!/k-developer/.test(main), 'arm name redacted');
    assert.match(input.promptText, /### src\/main\.py \(created\)\n/);
    assert.ok(input.promptText.includes(READ_POINTER));
    assert.ok(!input.promptText.includes('return 1'), 'a copied file\'s body is not pasted');
    assert.match(input.promptText, /be nice/, 'an instruction file is pasted as text');
    assert.match(input.promptText, /the plan/);
    assert.ok(!input.promptText.includes(SECRET));
    const plain = buildBundle(f.args);
    assert.equal(input.bundle.expertText, plain.expertText, 'quote matching stays against the same expert text');
    assert.equal(input.bundle.text, plain.text);
  } finally { f.cleanup(); }
});

test('the preface lists every copied file with lines and bytes, and states the read-in-full rule', () => {
  const f = fixture();
  try {
    const { preface } = buildReadInput(f.args);
    assert.match(preface, /^FILES IN YOUR WORKING FOLDER \(2\)/);
    assert.match(preface, /- a\.txt \(1 line, 12 bytes\)/);
    assert.match(preface, /- src\/main\.py \(3 lines, \d+ bytes\)/);
    assert.match(preface, /Read every file listed here in full/);
    assert.match(preface, /not scored/);
  } finally { f.cleanup(); }
});

test('the cache parts name the view and the copy\'s content hash, which changes with any copied byte', () => {
  const f = fixture();
  try {
    const view = viewOf('read');
    const a = view.cacheParts(buildReadInput(f.args));
    assert.equal(a[0], 'view:read');
    assert.match(a[1], /^copy:[0-9a-f]{64}$/);
    fs.appendFileSync(path.join(f.dir, 'workspace', 'a.txt'), 'more\n');
    assert.notEqual(view.cacheParts(buildReadInput(f.args))[1], a[1]);
  } finally { f.cleanup(); }
});

test('writeCopy writes plain files only and refuses unsafe or instruction paths', () => {
  const root = fs.realpathSync(tmp());
  try {
    const dir = path.join(root, 'copy');
    writeCopy(dir, [{ rel: 'a.txt', text: 'a\n' }, { rel: 'src/deep/b.py', text: 'b\n' }]);
    for (const rel of ['a.txt', 'src/deep/b.py']) assert.ok(fs.lstatSync(path.join(dir, rel)).isFile());
    for (const rel of ['../x.txt', '/etc/x', 'a/../../x', 'AGENTS.md', 'd/claude.md', '.git/config', '.opencode/a.json', 'x/.kiro/a', 'a//b', '']) {
      assert.throws(() => writeCopy(path.join(root, `c-${Math.random()}`), [{ rel, text: 'x' }]), /refused/, rel);
    }
    assert.throws(() => writeCopy(dir, [{ rel: 'a.txt', text: 'again' }]), /EEXIST|exists/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('instructionFilesAbove finds an AGENTS.md, CLAUDE.md or CONTEXT.md in any folder above the copy', () => {
  const root = fs.realpathSync(tmp());
  try {
    const dir = path.join(root, 'a', 'b', 'copy');
    fs.mkdirSync(dir, { recursive: true });
    assert.deepEqual(instructionFilesAbove(dir), []);
    fs.writeFileSync(path.join(root, 'a', 'CONTEXT.md'), 'x');
    assert.deepEqual(instructionFilesAbove(dir), [path.join(root, 'a', 'CONTEXT.md')]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
