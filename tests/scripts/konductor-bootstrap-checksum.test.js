// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for the checksums_match() function in
 * scripts/konductor-bootstrap.sh.
 *
 * checksums_match() gates whether the downloaded konductor-install.sh is
 * trusted to run. It must reject a real mismatch, and it must also reject
 * an empty or "null" expected value -- the shape GitHub's Contents API
 * returns for a missing/unexpected response -- rather than comparing
 * against nothing and passing vacuously.
 *
 * The current checksums_match() is extracted verbatim from the real
 * script file on disk (not pinned by value), so a regression in the
 * shipped code -- not just in a copy pasted into this test -- is what
 * actually gets caught.
 *
 * Run: node --test tests/scripts/konductor-bootstrap-checksum.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'konductor-bootstrap.sh');

/** Extract a named shell function's body verbatim from the real script. */
function extractFunction(functionName) {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const match = src.match(new RegExp(`${functionName}\\(\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(
    match,
    `${functionName}() not found in konductor-bootstrap.sh -- did it get renamed or restructured?`,
  );
  return match[0];
}

/** Run `functionSrc` (a checksums_match definition) in a fresh bash subshell; return its exit status. */
function checksumsMatchStatus(functionSrc, expected, actual) {
  try {
    execFileSync('bash', ['-c', `${functionSrc}\nchecksums_match "$1" "$2"`, 'test', expected, actual], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (err) {
    return err.status;
  }
}

test('checksums_match succeeds when expected and actual are identical, non-empty SHAs', () => {
  const current = extractFunction('checksums_match');
  const sha = '980a0d5f19a64b4b30a87d4206aade58726b60e3';
  assert.equal(checksumsMatchStatus(current, sha, sha), 0);
});

test('checksums_match fails on a real mismatch', () => {
  const current = extractFunction('checksums_match');
  assert.equal(
    checksumsMatchStatus(current, '980a0d5f19a64b4b30a87d4206aade58726b60e3', '72a7e762a57daf5926ab0ea2fd889581ceda1de3'),
    1,
  );
});

test('checksums_match fails when the expected SHA is empty (malformed API response)', () => {
  const current = extractFunction('checksums_match');
  assert.equal(checksumsMatchStatus(current, '', 'anything'), 1);
});

test('checksums_match fails when the expected SHA is the literal string "null"', () => {
  const current = extractFunction('checksums_match');
  // The API's jq -r .sha extraction emits the literal string "null" when
  // the .sha field is absent from the response.
  assert.equal(checksumsMatchStatus(current, 'null', 'null'), 1);
});
