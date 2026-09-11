// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for the normalize_url() function in
 * scripts/konductor-clone-install.sh.
 *
 * normalize_url() strips trailing slashes and a trailing ".git" suffix
 * before comparing an existing checkout's `git remote get-url origin`
 * against the requested REPO_URL, so cosmetic URL differences (a trailing
 * slash, an explicit ".git" suffix, or both) don't trip a spurious
 * "has origin=... expected ..." fatal on re-run.
 *
 * Order matters here: the function strips trailing slash(es) FIRST, then
 * the trailing ".git" suffix. This is the fixed order from the historical
 * bootstrap-kiro-branch.sh bug (see git history: "close normalize_url order
 * bug and zero-linked gate bypass") — stripping ".git" before the slash
 * misses a slash-terminated form like "repo.git/" (it doesn't end in
 * ".git", it ends in "/"), leaving "repo.git" instead of "repo". This test
 * exists purely to lock in that already-correct behavior against
 * regression; it does not document a live bug in this script.
 *
 * The current normalize_url() is extracted verbatim from the real script
 * file on disk (not pinned by value), so a future regression in the
 * shipped code — not just in a copy pasted into this test — is what
 * actually gets caught.
 *
 * Run: node --test tests/scripts/konductor-clone-install-normalize-url.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'konductor-clone-install.sh');

/** Extract the current normalize_url() function body verbatim from the real script. */
function extractCurrentNormalizeUrl() {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const match = src.match(/normalize_url\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(
    match,
    'normalize_url() function not found in konductor-clone-install.sh -- did it get renamed or restructured?',
  );
  return match[0];
}

/** Run `functionSrc` (a normalize_url definition) in a fresh bash subshell against `input`. */
function runNormalizeUrl(functionSrc, input) {
  const out = execFileSync('bash', ['-c', `${functionSrc}\nnormalize_url "$1"`, 'test', input]);
  return out.toString('utf8').replace(/\n$/, '');
}

test('every trailing-slash / .git combination normalizes to the same value', () => {
  const current = extractCurrentNormalizeUrl();
  const forms = ['repo', 'repo/', 'repo.git', 'repo.git/', 'repo.git//', 'repo//'];
  for (const form of forms) {
    assert.equal(runNormalizeUrl(current, form), 'repo', `expected "${form}" to normalize to "repo"`);
  }
});

test('https URL normalizes consistently with/without trailing slash and .git', () => {
  const current = extractCurrentNormalizeUrl();
  // Matches this script's own REPO_URL shape (a public GitHub HTTPS clone
  // URL) rather than an internal git host -- this file ships to GitHub as
  // part of the public package.
  const base = 'https://github.com/aws-solutions/konductor';
  assert.equal(runNormalizeUrl(current, base), base);
  assert.equal(runNormalizeUrl(current, `${base}.git`), base);
  assert.equal(runNormalizeUrl(current, `${base}/`), base);
  assert.equal(runNormalizeUrl(current, `${base}.git/`), base);
  assert.equal(runNormalizeUrl(current, `${base}.git//`), base);
});

test('ssh:// URL normalizes consistently with/without trailing slash and .git', () => {
  const current = extractCurrentNormalizeUrl();
  // Host is a neutral, non-internal placeholder (RFC 2606 reserved
  // "example" domain) -- normalize_url() only strips trailing slash(es)
  // and a trailing ".git", so it behaves identically regardless of which
  // host is used.
  const base = 'ssh://git.example.com/pkg/repo';
  assert.equal(runNormalizeUrl(current, base), base);
  assert.equal(runNormalizeUrl(current, `${base}.git`), base);
  assert.equal(runNormalizeUrl(current, `${base}/`), base);
  assert.equal(runNormalizeUrl(current, `${base}.git/`), base);
});

test('scp-style git@host:path URL normalizes consistently', () => {
  const current = extractCurrentNormalizeUrl();
  const base = 'git@github.com:org/repo';
  assert.equal(runNormalizeUrl(current, base), base);
  assert.equal(runNormalizeUrl(current, `${base}.git`), base);
  // scp-style remotes are not slash-terminated in practice -- verify the
  // boundary case degrades sanely anyway.
  assert.equal(runNormalizeUrl(current, `${base}.git/`), base);
});

test('a URL with .git followed by a query string is left untouched (correctly NOT collapsed)', () => {
  const current = extractCurrentNormalizeUrl();
  // Git remote URLs don't carry query/fragment components in practice, but
  // verify the boundary explicitly: normalize_url only strips a LITERAL
  // trailing ".git" (after trailing slashes), so "repo.git?ref=x" does not
  // end in ".git" and is left as-is.
  const withQuery = 'https://example.com/repo.git?ref=xyz';
  assert.equal(runNormalizeUrl(current, withQuery), withQuery);
});

test('empty string does not crash and normalizes to empty string', () => {
  const current = extractCurrentNormalizeUrl();
  assert.equal(runNormalizeUrl(current, ''), '');
});

test('META: this test file itself never carries an internal hostname verbatim in its own source', () => {
  // This file ships to GitHub as part of the public package, so its
  // normalize_url() test input must use a neutral RFC 2606 "example" host
  // rather than a real internal git host. This scans the file's own SOURCE
  // TEXT so it fails if an internal hostname is ever reintroduced here --
  // note this comment intentionally never spells out the hostname either,
  // for the same reason.
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  assert.doesNotMatch(selfSrc, /git\.amazon\.com/);
});
