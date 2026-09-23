// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for the Contents API fetch block in
 * scripts/konductor-bootstrap.sh (the block that resolves `expected_sha`
 * ahead of the checksums_match() comparison tested separately in
 * tests/scripts/konductor-bootstrap-checksum.test.js).
 *
 * Under `set -euo pipefail`, a bare top-level `VAR="$(curl ... | jq ...)"`
 * assignment aborts the whole script with no message if the API call
 * fails (curl -f exits non-zero on a 403; unauthenticated GitHub API rate
 * limiting is only 60 req/hr and common). This block must instead surface
 * a friendly, actionable error and exit 1 -- the same pattern
 * konductor-install.sh's own release-metadata fetch already uses.
 *
 * The block under test is extracted verbatim from the real script file on
 * disk (not pinned by value), so a regression in the shipped code -- not
 * just in a copy pasted into this test -- is what actually gets caught.
 * It calls the shared curl_get() helper (also extracted verbatim), which
 * is what actually invokes `curl` -- so the stubbed `curl` below is what
 * curl_get() calls, not the block under test directly.
 *
 * Run: node --test tests/scripts/konductor-bootstrap-contents-fetch.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'konductor-bootstrap.sh');

function readScript() {
  return fs.readFileSync(SCRIPT_PATH, 'utf8');
}

/**
 * Extract the CONTENTS_API_URL fetch-and-parse block, verbatim, from the
 * real script -- from the URL assignment through the `expected_sha=`
 * line, stopping short of the `actual_sha=$(git hash-object ...)` line so
 * this test doesn't need a real file on disk to hash.
 */
function extractContentsFetchBlock() {
  const match = readScript().match(/CONTENTS_API_URL="[\s\S]*?\nexpected_sha=.*\n/);
  assert.ok(
    match,
    'CONTENTS_API_URL fetch block not found in konductor-bootstrap.sh -- did it get renamed or restructured?',
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
 * Run `blockSrc` under `set -euo pipefail` with REPO/SCRIPT_PATH/BRANCH
 * set, the real curl_get() helper in scope, GITHUB_TOKEN_ACTIVE left
 * unset (this test is not about the token gate, covered separately in
 * tests/scripts/konductor-bootstrap-github-token.test.js), and
 * `curl`/`jq` stubbed as shell functions, so no real network access
 * happens. `curlFails: true` makes the stubbed curl fail exactly as it
 * would against a rate-limited or unreachable GitHub API.
 */
function runContentsFetch(blockSrc, { curlFails }) {
  const curlGet = extractCurlGet();
  const curlStub = curlFails ? 'curl() { return 1; }' : 'curl() { printf \'{"sha":"deadbeef"}\'; }';
  const jqStub = 'jq() { echo deadbeef; }';
  try {
    const out = execFileSync('bash', [
      '-c',
      `set -euo pipefail\nREPO=test-org/test-repo\nSCRIPT_PATH=scripts/konductor-install.sh\nBRANCH=main\nGITHUB_TOKEN_ACTIVE=""\n${curlGet}\n${curlStub}\n${jqStub}\n${blockSrc}\necho "expected_sha=\${expected_sha}"`,
    ]);
    return { status: 0, stdout: out.toString('utf8'), stderr: '' };
  } catch (err) {
    return {
      status: err.status,
      stdout: (err.stdout || Buffer.alloc(0)).toString('utf8'),
      stderr: (err.stderr || Buffer.alloc(0)).toString('utf8'),
    };
  }
}

test('a failed Contents API fetch surfaces a friendly error instead of an abrupt, message-less abort', () => {
  const block = extractContentsFetchBlock();
  const result = runContentsFetch(block, { curlFails: true });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /error: failed to fetch checksum metadata from .* -- check network access or GitHub API rate limits\./,
  );
  // The `exit 1` inside the fetch failure's own block ends the run before
  // the echo at the end -- distinct from an unshielded abort under set -e,
  // which would also exit 1 but with this stderr message never printed.
  assert.equal(result.stdout, '');
});

test('a successful Contents API fetch still resolves expected_sha normally', () => {
  const block = extractContentsFetchBlock();
  const result = runContentsFetch(block, { curlFails: false });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'expected_sha=deadbeef\n');
});
