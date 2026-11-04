// SPDX-License-Identifier: Apache-2.0
/**
 * Hidden-directory tests for the check layer (finding I-A)
 *
 * The loader skips `.git` and `node_modules` at any depth, but the check layer accepted those paths,
 * so a check could never see what was there:
 *
 *   disk: src/a.js pristine, then src/node_modules/evil.js and src/.git/hook added
 *   fixture_unchanged{path:'src'}                -> {passed:true, detail:'identical'}
 *   file_absent{path:'src/node_modules/evil.js'} -> {passed:true, detail:'absent'}   // file IS on disk
 *
 * Both are now closed. A check whose path runs through a skipped name is a validation error. The
 * loader records each skipped entry as an empty-valued marker, so the addition shows up as an extra
 * entry under `src`, and `file_absent` on `src` sees something there.
 *
 * Run: node --test bench/test/checks-hidden-paths.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSnapshot } = require('../lib/snapshot-loader');
const { evalCheck, validateCheck, CHECK_KINDS } = require('../lib/checks');
const { isSkippedName } = require('../lib/safe-path');

function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-hidden-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** The review's disk layout: `src/a.js` pristine, then hidden entries added under `src`. */
function reviewWorkspaces(t) {
  const root = makeTree(t, { 'src/a.js': 'module.exports = 1;\n' });
  const pristine = loadSnapshot(root);
  fs.mkdirSync(path.join(root, 'src', 'node_modules'));
  fs.writeFileSync(path.join(root, 'src', 'node_modules', 'evil.js'), 'steal();\n');
  fs.writeFileSync(path.join(root, 'src', '.git'), 'gitdir: /Users/someone/work/repo\n');
  return { root, pristine, workspace: loadSnapshot(root) };
}

test('I-A: fixture_unchanged on src no longer says "identical" after hidden entries are added', (t) => {
  const { pristine, workspace } = reviewWorkspaces(t);
  const verdict = evalCheck(workspace, { type: 'fixture_unchanged', path: 'src' }, { pristine });
  assert.equal(verdict.passed, false, JSON.stringify(verdict));
  assert.match(verdict.detail, /^extra 2 /);
  // The loader never read their content: only the fact that they exist reached the snapshot.
  assert.deepEqual(Object.keys(workspace).sort(), ['src/.git', 'src/a.js', 'src/node_modules']);
  assert.equal(JSON.stringify(workspace).includes('steal'), false);
  assert.equal(JSON.stringify(workspace).includes('/Users/someone'), false);
});

test('I-A: file_absent on a directory that holds only hidden entries no longer says "absent"', (t) => {
  // `build` holds nothing but a node_modules tree. Before, the loader dropped it, the snapshot had no
  // key under `build`, and file_absent reported "absent" for a directory that is full on disk.
  const root = makeTree(t, { 'build/node_modules/pkg/index.js': 'x\n', 'build/.git': 'gitdir: x\n', 'README.md': 'r\n' });
  const workspace = loadSnapshot(root);
  const verdict = evalCheck(workspace, { type: 'file_absent', path: 'build' }, {});
  assert.equal(verdict.passed, false, JSON.stringify(verdict));
  assert.match(verdict.detail, /^present /);
  // An unrelated directory is still absent: the markers did not turn every path into a hit.
  assert.equal(evalCheck(workspace, { type: 'file_absent', path: 'dist' }, {}).passed, true);
});

test('I-A: file_absent on a file under node_modules is a validation error and never a pass', (t) => {
  const { workspace } = reviewWorkspaces(t);
  const check = { type: 'file_absent', path: 'src/node_modules/evil.js' };
  const problems = validateCheck(check);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^path: it is under or named node_modules, which the snapshot loader skips at any depth/);
  const verdict = evalCheck(workspace, check, {});
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /^malformed check: path: /);
  // The same check on a snapshot that never saw the file is a failure too: it cannot pass vacuously.
  assert.equal(evalCheck({}, check, {}).passed, false);
});

test('I-A: no check kind accepts a path through .git or node_modules, at any depth, in any case', () => {
  const hidden = ['node_modules', '.git', 'src/node_modules/x.js', 'a/b/.git/c', 'Node_Modules/x', 'src/.GIT/hook', 'src/.git./x', 'src/node_modules /x'];
  const extra = { contains: { pattern: 'plan items' }, not_contains: { pattern: 'plan items' } };
  for (const type of CHECK_KINDS) {
    for (const p of hidden) {
      const check = { type, path: p, ...(extra[type] || {}) };
      const problems = validateCheck(check);
      assert.ok(problems.some((problem) => /^path: .*which the snapshot loader skips at any depth/.test(problem)), `${type} ${p}: ${JSON.stringify(problems)}`);
      assert.equal(evalCheck({ [p]: 'x' }, check, { pristine: { [p]: 'x' } }).passed, false, `${type} ${p}`);
    }
  }
});

test('I-A: names that merely resemble the skipped ones are ordinary paths', () => {
  for (const p of ['.github/ci.yml', '.gitignore', 'src/node_module/x.js', 'docs/node_modules_guide.md', 'my_node_modules/x.js']) {
    assert.deepEqual(validateCheck({ type: 'file_exists', path: p }), [], p);
  }
});

test('I-A: fixture_unchanged on a pristine directory that holds a hidden entry fails closed and says why', (t) => {
  // A marker carries no content. If the pristine side holds `src/node_modules`, an edit inside it
  // would compare equal, so the check refuses to answer instead of answering "identical".
  const root = makeTree(t, { 'src/a.js': 'one\n', 'src/node_modules/dep/index.js': 'dep\n' });
  const pristine = loadSnapshot(root);
  fs.writeFileSync(path.join(root, 'src', 'node_modules', 'dep', 'index.js'), 'tampered\n');
  const workspace = loadSnapshot(root);
  assert.deepEqual(workspace, pristine, 'the loader cannot see the edit, which is why the check must refuse');
  const verdict = evalCheck(workspace, { type: 'fixture_unchanged', path: 'src' }, { pristine });
  assert.equal(verdict.passed, false, JSON.stringify(verdict));
  assert.match(verdict.detail, /^holds an entry the loader does not read \("src\/node_modules"\)/);
  // A subtree without a hidden entry is still checkable, so the task author has a way forward.
  const sibling = { type: 'fixture_unchanged', path: 'src/a.js' };
  assert.equal(evalCheck(workspace, sibling, { pristine }).passed, true);
});

test('I-A: allowAdditions admits a hidden entry added under a directory, like any other addition', (t) => {
  const { pristine, workspace } = reviewWorkspaces(t);
  assert.equal(evalCheck(workspace, { type: 'fixture_unchanged', path: 'src', allowAdditions: true }, { pristine }).passed, true);
});

test('I-A: the loader and the check layer agree on which names are skipped', (t) => {
  const names = ['.git', '.GIT', 'node_modules', 'Node_Modules', '.git.', 'node_modules ', '.github', '.gitignore', 'node_module', 'src'];
  for (const name of names) {
    let root;
    try {
      root = makeTree(t, { [`d/${name}/inner.txt`]: 'x' });
    } catch {
      continue; // The filesystem refuses this name (trailing space or dot on some platforms).
    }
    const keys = Object.keys(loadSnapshot(root));
    const skipped = keys.length === 1 && keys[0] === `d/${name}` && loadSnapshot(root)[`d/${name}`] === '';
    assert.equal(skipped, isSkippedName(name), `${JSON.stringify(name)}: loader keys ${JSON.stringify(keys)}`);
  }
});
