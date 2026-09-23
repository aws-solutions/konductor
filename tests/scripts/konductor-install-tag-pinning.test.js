// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for the KONDUCTOR_TAG release-endpoint resolution block
 * in scripts/konductor-install.sh.
 *
 * When KONDUCTOR_TAG is set, the script must resolve release metadata
 * from `GET .../releases/tags/<tag>` instead of `GET .../releases/latest`,
 * so a pinned install never drifts onto whatever happens to be latest at
 * run time. When unset, the existing latest-release behavior must be
 * unchanged.
 *
 * The block under test is extracted verbatim from the real script file on
 * disk (not pinned by value), so a regression in the shipped code -- not
 * just in a copy pasted into this test -- is what actually gets caught.
 *
 * Run: node --test tests/scripts/konductor-install-tag-pinning.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'konductor-install.sh');

/**
 * Extract the KONDUCTOR_TAG if/else block that sets RELEASE_METADATA_URL,
 * verbatim, from the real script.
 */
function extractReleaseMetadataUrlBlock() {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const match = src.match(/if \[\[ -n "\$\{KONDUCTOR_TAG:-\}" \]\][\s\S]*?\nfi\n/);
  assert.ok(
    match,
    'KONDUCTOR_TAG release-metadata-URL block not found in konductor-install.sh -- did it get renamed or restructured?',
  );
  return match[0];
}

/**
 * Run `blockSrc` with REPO set and KONDUCTOR_TAG either unset, set to a
 * real value, or set to the empty string, and return the resolved URL.
 * `tagState` is one of 'unset', a non-empty tag value, or '' (explicitly
 * empty) -- distinguished from 'unset' via a separate `explicitlyEmpty`
 * flag, since deleting an env var and setting it to '' are different
 * inputs to `${KONDUCTOR_TAG:-}` that must both fall back to latest.
 */
function resolveReleaseMetadataUrl(blockSrc, { tag, explicitlyEmpty } = {}) {
  const env = { ...process.env, REPO: 'test-org/test-repo' };
  if (explicitlyEmpty) {
    env.KONDUCTOR_TAG = '';
  } else if (tag) {
    env.KONDUCTOR_TAG = tag;
  } else {
    delete env.KONDUCTOR_TAG;
  }
  const out = execFileSync(
    'bash',
    ['-c', `set -euo pipefail\n${blockSrc}\necho "RELEASE_METADATA_URL=\${RELEASE_METADATA_URL}"`],
    { env },
  );
  // The block's own "=== [konductor-install] Resolving ... ===" echo lands
  // on stdout ahead of the URL this test cares about -- take only the
  // final line, which is always the echo added above.
  const lines = out.toString('utf8').trimEnd().split('\n');
  return lines[lines.length - 1];
}

test('KONDUCTOR_TAG set resolves the tag-scoped releases endpoint, not /releases/latest', () => {
  const block = extractReleaseMetadataUrlBlock();
  const result = resolveReleaseMetadataUrl(block, { tag: 'v0.1.2' });
  assert.equal(
    result,
    'RELEASE_METADATA_URL=https://api.github.com/repos/test-org/test-repo/releases/tags/v0.1.2',
  );
});

test('KONDUCTOR_TAG unset falls back to the existing /releases/latest endpoint unchanged', () => {
  const block = extractReleaseMetadataUrlBlock();
  const result = resolveReleaseMetadataUrl(block, {});
  assert.equal(
    result,
    'RELEASE_METADATA_URL=https://api.github.com/repos/test-org/test-repo/releases/latest',
  );
});

test('an explicitly empty-string KONDUCTOR_TAG is treated the same as unset', () => {
  const block = extractReleaseMetadataUrlBlock();
  const result = resolveReleaseMetadataUrl(block, { explicitlyEmpty: true });
  assert.equal(
    result,
    'RELEASE_METADATA_URL=https://api.github.com/repos/test-org/test-repo/releases/latest',
  );
});
