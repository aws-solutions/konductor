// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for the map_target_triple() and extract_tag_name()
 * functions, and the RELEASE_VERSION assignment that consumes
 * extract_tag_name(), in scripts/konductor-install.sh.
 *
 * map_target_triple() must byte-for-byte mirror
 * cli/konductor-rs/src/cli/install/target_triple.rs's map_triple() match
 * table, just keyed on `uname -s`/`uname -m`'s string shapes
 * (Linux/Darwin, x86_64/aarch64/arm64) instead of Rust's
 * std::env::consts::{OS,ARCH} (linux/macos, x86_64/aarch64). This script
 * and `konductor install` independently derive a target triple for the
 * same host -- one to pick which CLI binary to fetch, the other which
 * skill-lookup-mcp binary to fetch -- so if the two mappings ever
 * disagreed, a user could end up with a binary whose own remote-install
 * path resolves a DIFFERENT triple's skill-lookup-mcp asset. This test
 * exists to catch that drift, not to document a live bug.
 *
 * extract_tag_name() reads the exact field (`tag_name`) and endpoint shape
 * (`GET .../releases/latest`) install::github::fetch_latest_release_metadata
 * reads, so this script's notion of "latest release" never drifts from the
 * Rust CLI's own.
 *
 * The RELEASE_VERSION assignment pipes extract_tag_name()'s output under
 * `set -euo pipefail`, so its `|| true` shield matters: without it, a
 * failing pipeline (tag_name absent, or a SIGPIPE from `head` closing
 * early) aborts the script at that line instead of reaching the
 * `if [[ -z "${RELEASE_VERSION}" ]]` check that reports it plainly.
 *
 * All three -- map_target_triple(), extract_tag_name(), and the
 * RELEASE_VERSION block -- are extracted verbatim from the real script
 * file on disk (not pinned by value), so a regression in the shipped
 * code -- not just in a copy pasted into this test -- is what actually
 * gets caught.
 *
 * Run: node --test tests/scripts/konductor-install-target-triple.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'konductor-install.sh');

/** Extract a named shell function's body verbatim from the real script. */
function extractFunction(functionName) {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const match = src.match(new RegExp(`${functionName}\\(\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(
    match,
    `${functionName}() not found in konductor-install.sh -- did it get renamed or restructured?`,
  );
  return match[0];
}

/** Run `functionSrc` (a map_target_triple definition) in a fresh bash subshell against os/arch. */
function runMapTargetTriple(functionSrc, os, arch) {
  try {
    const out = execFileSync('bash', [
      '-c',
      `${functionSrc}\nmap_target_triple "$1" "$2"`,
      'test',
      os,
      arch,
    ]);
    return out.toString('utf8').replace(/\n$/, '');
  } catch (err) {
    // map_target_triple returns 1 (no stdout) for an unsupported pair --
    // surfaced to the caller as a non-zero exit, not a thrown JS error.
    return { unsupported: true, status: err.status };
  }
}

/** Run `functionSrc` (an extract_tag_name definition) against a JSON string on stdin. */
function runExtractTagName(functionSrc, jsonInput) {
  const out = execFileSync('bash', ['-c', `${functionSrc}\nextract_tag_name`], {
    input: jsonInput,
  });
  return out.toString('utf8').replace(/\n$/, '');
}

test('map_target_triple resolves exactly the three published triples', () => {
  const current = extractFunction('map_target_triple');
  const cases = [
    ['Linux', 'x86_64', 'x86_64-unknown-linux-musl'],
    ['Linux', 'aarch64', 'aarch64-unknown-linux-musl'],
    ['Darwin', 'arm64', 'aarch64-apple-darwin'],
  ];
  for (const [os, arch, expectedTriple] of cases) {
    assert.equal(
      runMapTargetTriple(current, os, arch),
      expectedTriple,
      `expected ${os}/${arch} to resolve to ${expectedTriple}`,
    );
  }
});

test('map_target_triple rejects Intel/x86_64 macOS -- no published asset for that platform', () => {
  const current = extractFunction('map_target_triple');
  const result = runMapTargetTriple(current, 'Darwin', 'x86_64');
  assert.deepEqual(result, { unsupported: true, status: 1 });
});

test('map_target_triple rejects Windows regardless of architecture', () => {
  const current = extractFunction('map_target_triple');
  for (const arch of ['x86_64', 'aarch64']) {
    const result = runMapTargetTriple(current, 'Windows_NT', arch);
    assert.deepEqual(result, { unsupported: true, status: 1 }, `Windows_NT/${arch} must be unsupported`);
  }
});

test('map_target_triple rejects unrecognized OS/ARCH combinations rather than guessing a triple', () => {
  const current = extractFunction('map_target_triple');
  for (const [os, arch] of [
    ['FreeBSD', 'x86_64'],
    ['Linux', 'armv7l'],
    ['Darwin', 'i386'],
  ]) {
    const result = runMapTargetTriple(current, os, arch);
    assert.deepEqual(result, { unsupported: true, status: 1 }, `${os}/${arch} must be unsupported`);
  }
});

test('extract_tag_name reads the tag_name field from a realistic release payload', () => {
  const current = extractFunction('extract_tag_name');
  const payload = JSON.stringify({
    tag_name: 'v0.1.2',
    name: 'Release 0.1.2',
    draft: false,
    assets: [
      {
        name: 'konductor-v0.1.2-aarch64-apple-darwin',
        browser_download_url: 'https://example.com/konductor-v0.1.2-aarch64-apple-darwin',
      },
    ],
  });
  assert.equal(runExtractTagName(current, payload), 'v0.1.2');
});

test('extract_tag_name returns empty output when tag_name is absent', () => {
  const current = extractFunction('extract_tag_name');
  assert.equal(runExtractTagName(current, '{}'), '');
});

test('extract_tag_name is not confused by other quoted "tag_name"-like text elsewhere in the payload', () => {
  const current = extractFunction('extract_tag_name');
  const payload = JSON.stringify({
    tag_name: 'v1.2.3',
    body: 'This release supersedes the previous "tag_name": "v1.2.2" reference in the changelog.',
  });
  assert.equal(runExtractTagName(current, payload), 'v1.2.3');
});

/**
 * Extract the RELEASE_VERSION assignment and its immediately following
 * empty-check block, verbatim, from the real script. Under `set -e`, an
 * unshielded `VAR="$(failing_pipeline)"` aborts the script at that line
 * -- these tests exercise the assignment together with the check that
 * follows it, not just extract_tag_name() in isolation, so a regression
 * that drops the `|| true` shield is what actually gets caught.
 */
function extractReleaseVersionBlock() {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const match = src.match(/RELEASE_VERSION="\$\(printf[\s\S]*?\nfi\n/);
  assert.ok(
    match,
    'RELEASE_VERSION assignment/empty-check block not found in konductor-install.sh -- did it get renamed or restructured?',
  );
  return match[0];
}

/**
 * Run `extractTagNameSrc` + `releaseVersionBlockSrc` under `set -euo
 * pipefail` against a RELEASE_METADATA value, mirroring the flags the
 * real script runs under. Echoes RELEASE_VERSION afterward so a run that
 * falls through the empty-check (tag_name present) has visible output.
 */
function runReleaseVersionResolution(extractTagNameSrc, releaseVersionBlockSrc, releaseMetadata) {
  try {
    const out = execFileSync(
      'bash',
      ['-c', `set -euo pipefail\n${extractTagNameSrc}\n${releaseVersionBlockSrc}\necho "RELEASE_VERSION=\${RELEASE_VERSION}"`],
      {
        env: {
          ...process.env,
          RELEASE_METADATA: releaseMetadata,
          RELEASE_METADATA_URL: 'https://api.github.com/repos/test/test/releases/latest',
        },
      },
    );
    return { status: 0, stdout: out.toString('utf8'), stderr: '' };
  } catch (err) {
    return {
      status: err.status,
      stdout: (err.stdout || Buffer.alloc(0)).toString('utf8'),
      stderr: (err.stderr || Buffer.alloc(0)).toString('utf8'),
    };
  }
}

test('malformed/empty RELEASE_METADATA surfaces the friendly tag_name error instead of an abrupt abort', () => {
  const extractTagNameSrc = extractFunction('extract_tag_name');
  const releaseVersionBlockSrc = extractReleaseVersionBlock();
  const result = runReleaseVersionResolution(extractTagNameSrc, releaseVersionBlockSrc, '{}');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not find a 'tag_name' field in the release metadata/);
  // No RELEASE_VERSION echo -- the `exit 1` inside the if-block ends the
  // run before that line, distinct from an unshielded abort under set -e,
  // which would also exit 1 but with this stderr message never printed.
  assert.equal(result.stdout, '');
});

test('a literal empty-string RELEASE_METADATA also surfaces the friendly error, not a bare abort', () => {
  const extractTagNameSrc = extractFunction('extract_tag_name');
  const releaseVersionBlockSrc = extractReleaseVersionBlock();
  const result = runReleaseVersionResolution(extractTagNameSrc, releaseVersionBlockSrc, '');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not find a 'tag_name' field in the release metadata/);
});

test('RELEASE_VERSION resolves normally and the empty-check is a no-op when tag_name is present', () => {
  const extractTagNameSrc = extractFunction('extract_tag_name');
  const releaseVersionBlockSrc = extractReleaseVersionBlock();
  const result = runReleaseVersionResolution(
    extractTagNameSrc,
    releaseVersionBlockSrc,
    JSON.stringify({ tag_name: 'v0.1.2' }),
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'RELEASE_VERSION=v0.1.2\n');
});
