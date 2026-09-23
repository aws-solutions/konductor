// SPDX-License-Identifier: Apache-2.0
/**
 * Regression tests for the KONDUCTOR_USE_GITHUB_TOKEN opt-in gate in
 * scripts/konductor-bootstrap.sh.
 *
 * Mirrors konductor-install.sh's own KONDUCTOR_USE_GITHUB_TOKEN gate: the
 * authenticated path activates only when both the opt-in flag and
 * GITHUB_TOKEN are set, never on GITHUB_TOKEN's mere presence. When
 * active, both of bootstrap.sh's curl calls (the raw file fetch and the
 * Contents API checksum lookup) route through the shared curl_get()
 * helper, which authenticates via curl's `--config -` (stdin), never a
 * `-H` command-line argument, so the token never lands in the process
 * table.
 *
 * The gate and curl_get() are extracted verbatim from the real script
 * file on disk (not pinned by value), so a regression in the shipped
 * code -- not just in a copy pasted into this test -- is what actually
 * gets caught.
 *
 * Run: node --test tests/scripts/konductor-bootstrap-github-token.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'konductor-bootstrap.sh');

function readScript() {
  return fs.readFileSync(SCRIPT_PATH, 'utf8');
}

/** Extract the GITHUB_TOKEN_ACTIVE opt-in gate, verbatim, from the real script. */
function extractGithubTokenGate() {
  const match = readScript().match(/GITHUB_TOKEN_ACTIVE=""\nif \[\[[\s\S]*?\nfi\n/);
  assert.ok(
    match,
    'GITHUB_TOKEN_ACTIVE gate not found in konductor-bootstrap.sh -- did it get renamed or restructured?',
  );
  return match[0];
}

/** Extract the curl_get() helper, verbatim, from the real script. */
function extractCurlGet() {
  const match = readScript().match(/curl_get\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(
    match,
    'curl_get() not found in konductor-bootstrap.sh -- did it get renamed or restructured?',
  );
  return match[0];
}

/**
 * Run the real GITHUB_TOKEN_ACTIVE gate and curl_get() against a stubbed
 * `curl` that records its own argv and, only when invoked with
 * `--config -`, the header piped through its stdin -- so the test
 * observes exactly what a real curl invocation would see, with no
 * network access. Returns the stub's capture file contents.
 */
function runCurlGet({ useGithubToken, githubToken }) {
  const gate = extractGithubTokenGate();
  const curlGet = extractCurlGet();
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konductor-bootstrap-test-'));
  const captureFile = path.join(captureDir, 'capture');

  const script = [
    'set -euo pipefail',
    `CAPTURE_FILE="${captureFile}"`,
    gate,
    curlGet,
    'curl() {',
    '  printf "ARGS:%s\\n" "$*" >> "${CAPTURE_FILE}"',
    '  if printf \'%s \' "$@" | grep -q -- \'--config\'; then',
    '    printf "STDIN:%s\\n" "$(cat)" >> "${CAPTURE_FILE}"',
    '  fi',
    '  echo stub-curl-output',
    '}',
    'curl_get "https://example.com/some/path" -o /dev/null',
  ].join('\n');

  const env = { ...process.env };
  if (useGithubToken) {
    env.KONDUCTOR_USE_GITHUB_TOKEN = '1';
  } else {
    delete env.KONDUCTOR_USE_GITHUB_TOKEN;
  }
  if (githubToken) {
    env.GITHUB_TOKEN = githubToken;
  } else {
    delete env.GITHUB_TOKEN;
  }

  execFileSync('bash', ['-c', script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  return fs.readFileSync(captureFile, 'utf8').trim();
}

test('opt-in set and GITHUB_TOKEN set: curl_get authenticates via --config - with the bearer header on stdin', () => {
  const capture = runCurlGet({ useGithubToken: true, githubToken: 'ghp_example_token' });
  const lines = capture.split('\n');
  assert.equal(lines[0], 'ARGS:-fsSL --config - -o /dev/null https://example.com/some/path');
  assert.equal(lines[1], 'STDIN:header = "Authorization: Bearer ghp_example_token"');
});

test('opt-in unset: curl_get stays plain and unauthenticated (unchanged behavior)', () => {
  const capture = runCurlGet({ useGithubToken: false, githubToken: undefined });
  const lines = capture.split('\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'ARGS:-fsSL -o /dev/null https://example.com/some/path');
});

test('GITHUB_TOKEN present but opt-in not set: still unauthenticated (never activates on mere presence)', () => {
  const capture = runCurlGet({ useGithubToken: false, githubToken: 'ghp_example_token' });
  const lines = capture.split('\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'ARGS:-fsSL -o /dev/null https://example.com/some/path');
});

test('opt-in set but GITHUB_TOKEN unset: still unauthenticated (empty token is the same as no opt-in)', () => {
  const capture = runCurlGet({ useGithubToken: true, githubToken: undefined });
  const lines = capture.split('\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'ARGS:-fsSL -o /dev/null https://example.com/some/path');
});

test('both curl call sites route through curl_get(), never a bare curl -fsSL', () => {
  const src = readScript();
  // Drop comment lines first -- the USAGE header's own literal
  // `curl -fsSL https://...` one-liner example would otherwise read as a
  // bypassing call site -- then strip curl_get()'s own body, which
  // legitimately calls curl directly, so what remains is only the real
  // code that could bypass the shared helper (and, with it, the token
  // gate).
  const codeOnly = src
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const withoutCurlGet = codeOnly.replace(/curl_get\(\)\s*\{[\s\S]*?\n\}\n/, '');
  assert.doesNotMatch(
    withoutCurlGet,
    /curl -fsSL/,
    'a curl call outside curl_get() would bypass the GITHUB_TOKEN_ACTIVE gate',
  );
  assert.match(withoutCurlGet, /curl_get "https:\/\/raw\.githubusercontent\.com/);
  assert.match(withoutCurlGet, /curl_get "\$\{CONTENTS_API_URL\}"/);
});

test('the opt-in is threaded through to the downstream konductor-install.sh invocation', () => {
  const src = readScript();
  assert.match(
    src,
    /KONDUCTOR_USE_GITHUB_TOKEN="\$\{KONDUCTOR_USE_GITHUB_TOKEN:-\}" bash "\$\{INSTALL_SCRIPT\}" "\$@"/,
    'KONDUCTOR_USE_GITHUB_TOKEN is not explicitly passed through to the konductor-install.sh invocation',
  );
});
