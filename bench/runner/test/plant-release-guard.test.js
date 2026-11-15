// SPDX-License-Identifier: Apache-2.0
'use strict';

// The release guard on throwaway git repositories. The "release" here is a clearly fake stub made in the test; no
// release content is committed anywhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { main, pathFinding, lineHashes, MIN_LINE_CHARS } = require('../../physical/ci/release-guard.js');
const { mkScratch } = require('./scratch.js');

const STUB_RELEASE = {
  'truth-table.json': '{"rows": [\n  {"stub": "row one of a fake truth table for the guard test", "expect": "deny"},\n  {"stub": "row two of a fake truth table for the guard test", "expect": "allow"}\n]}\n',
  'policy/plant.cedar': '// fake policy text written only by the release guard test, never a policy\n',
};
// A synthetic fixture that shares the short, generic lines of the stub but none of its long ones.
const SYNTHETIC_FIXTURE = '{"rows": [\n  {"stub": "a synthetic test fixture row that is not release content", "expect": "deny"}\n]}\n';

/** A new git repository; `commits` is a list of `{add: {path: text}, remove: [path]}`, committed in order. */
function repoWith(commits) {
  const dir = mkScratch('guard-repo-');
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q');
  for (const [i, c] of commits.entries()) {
    for (const [rel, text] of Object.entries(c.add ?? {})) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    for (const rel of c.remove ?? []) fs.rmSync(path.join(dir, rel));
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', `c${i}`);
  }
  return dir;
}

/** The hash file the custodian would keep outside the repo, made from the stub release. */
function stubHashes() {
  const release = mkScratch('guard-release-');
  for (const [rel, text] of Object.entries(STUB_RELEASE)) {
    fs.mkdirSync(path.dirname(path.join(release, rel)), { recursive: true });
    fs.writeFileSync(path.join(release, rel), text);
  }
  const out = capture();
  assert.equal(main(['hash-release', release], out), 0);
  const file = path.join(mkScratch('guard-hashes-'), 'hashes.txt');
  fs.writeFileSync(file, out.text);
  return file;
}

function capture() {
  return { text: '', write(s) { this.text += s; } };
}

function check(repo) {
  const out = capture();
  const err = capture();
  const code = main(['check', '--repo', repo, '--hashes', stubHashes()], out, err);
  return { code, out: out.text, err: err.text };
}

test('a renamed release file is refused by its hashed lines, and the line itself is never printed', () => {
  const r = check(repoWith([{ add: { 'docs/notes.txt': STUB_RELEASE['truth-table.json'] } }]));
  assert.equal(r.code, 1);
  assert.match(r.out, /docs\/notes\.txt .*hashed release line/);
  assert.doesNotMatch(r.out, /fake truth table/);
});

test('a release file added and later deleted is still refused, because the whole history is read', () => {
  const r = check(repoWith([{ add: { 'a.txt': 'x\n' } }, { add: { 'x/truth-table.json': '{}\n' } }, { remove: ['x/truth-table.json'] }]));
  assert.equal(r.code, 1);
  assert.match(r.out, /x\/truth-table\.json: release file name/);
});

test('a release file type or a release directory is refused by path', () => {
  const r = check(repoWith([{ add: { 'p/x.cedar': 'stub\n', 'plant-r1/readme.txt': 'stub\n' } }]));
  assert.match(r.out, /p\/x\.cedar: release file type \.cedar/);
  assert.match(r.out, /plant-r1\/readme\.txt: inside a release directory/);
});

test('an encrypted bundle is refused by its header whatever its name', () => {
  const r = check(repoWith([{ add: { 'blob.bin': 'age-encryption.org/v1\n-> X25519 stub\n' } }]));
  assert.match(r.out, /blob\.bin .*encrypted bundle/);
});

test('a synthetic test fixture that shares only short generic lines passes', () => {
  const r = check(repoWith([{ add: { 'bench/fixtures/plant-like.json': SYNTHETIC_FIXTURE, 'src/policy.py': 'POLICY = "permit"\n' } }]));
  assert.deepEqual([r.code, r.out.trim()], [0, 'release guard: no release content in history']);
});

test('names close to release names pass', () => {
  for (const name of ['manifest.json', 'archive/2023-ledger.sig', 'truth-table.md', 'seeds.json.example']) assert.equal(pathFinding(name), null, name);
});

test('lines shorter than the hashing floor are never hashed', () => {
  assert.deepEqual(lineHashes(`${'x'.repeat(MIN_LINE_CHARS - 1)}\n  {"rows": [\n`), []);
  assert.equal(lineHashes('x'.repeat(MIN_LINE_CHARS)).length, 1);
});

test('inner whitespace does not hide a release line', () => {
  const line = 'a fake release line long enough to be hashed by the guard';
  assert.deepEqual(lineHashes(line.replace(/ /g, '   ')), lineHashes(line));
});

test('check without a hash file is a usage error', () => {
  const err = capture();
  assert.equal(main(['check'], capture(), err), 2);
  assert.match(err.text, /usage/);
});

test('a repository with missing objects is refused, not passed', () => {
  const repo = repoWith([{ add: { 'a.txt': 'x\n' } }]);
  const blob = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD:a.txt'], { encoding: 'utf8' }).stdout.trim();
  fs.rmSync(path.join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  const err = capture();
  assert.equal(main(['check', '--repo', repo, '--hashes', stubHashes()], capture(), err), 2);
  assert.match(err.text, /missing|failed/);
});

test('a shallow clone is refused, not passed', () => {
  const source = repoWith([{ add: { 'a.txt': 'x\n' } }, { add: { 'b.txt': 'y\n' } }]);
  const shallow = path.join(mkScratch('guard-shallow-'), 'clone');
  assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, shallow]).status, 0);
  const err = capture();
  assert.equal(main(['check', '--repo', shallow, '--hashes', stubHashes()], capture(), err), 2);
  assert.match(err.text, /shallow/);
});
