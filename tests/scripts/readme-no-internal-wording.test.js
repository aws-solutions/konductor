// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test guarding README.md (and CHANGELOG.md) against a small
 * class of wording that leaks the wrong audience/visibility assumption
 * into a document meant for the public, runnable from a plain external
 * clone of this package with no sibling packages and no CDK access.
 *
 * The authoritative denylist scan for this class of wording lives in a
 * separate, internal-only package's public-artifact-safety-scan.sh and
 * runs as part of the internal release pipeline (see the README's "How
 * installing Konductor works" section) -- it is not reachable from a
 * standalone clone of this package, and today's PR-time GitHub Actions
 * check does not run it either. This test is a supplementary, local-only
 * layer, not a replacement for that pipeline stage.
 *
 * The forbidden phrases below are stored ROT13-encoded rather than as
 * literal string/regex patterns, and this comment intentionally never
 * spells them out either. A prior version of this test embedded the
 * literal phrases directly, which made this test FILE ITSELF a carrier of
 * exactly the wording it existed to forbid -- a public artifact containing
 * that wording as plain text, which the same denylist class would flag if
 * it (or a future stricter scan) ever swept this package's own tree. ROT13
 * avoids that: the literal substring never appears in this file's source
 * bytes, only its rotated form does, decoded back at test-run time for the
 * actual comparison.
 *
 * Run: node --test tests/scripts/readme-no-internal-wording.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const README_PATH = path.join(__dirname, '..', '..', 'README.md');
const CHANGELOG_PATH = path.join(__dirname, '..', '..', 'CHANGELOG.md');
const SELF_PATH = __filename;

/** Classic Caesar rotate-by-13 -- self-inverse, touches only ASCII letters. */
function rot13(s) {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// The exact class of wording this test forbids, ROT13-encoded. Decoded at
// runtime; never appears as plaintext in this file.
const FORBIDDEN_ROT13 = ['Nznmba-vagreany', 'Vagreany hfref'];
const FORBIDDEN_PHRASES = FORBIDDEN_ROT13.map(rot13);

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// Precomputed once, independent of ROT13's self-inverse property, so the
// META round-trip test below can actually detect a typo in FORBIDDEN_ROT13
// instead of trivially agreeing with whatever it decodes to. To regenerate
// after an intentional change to FORBIDDEN_ROT13:
//   node -e "const c=require('crypto');['<phrase-1>','<phrase-2>'].forEach(p=>console.log(c.createHash('sha256').update(p,'utf8').digest('hex')))"
const EXPECTED_PHRASE_HASHES = [
  '6270de1fe2cf23ebdf0638a8298f61cb1d05d4189fc8e7505e458c87d550958e',
  '399f07ab807a0b2efaea4aebdf0f248fa5e569f2a99f59599c21f8ee50b1952e',
];

function assertNoneMatch(filePath, label) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lower = src.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(
      !lower.includes(phrase.toLowerCase()),
      `${label} must not contain the forbidden "${phrase}" class of wording`,
    );
  }
}

test('README.md contains none of the forbidden internal-wording phrases', () => {
  assertNoneMatch(README_PATH, 'README.md');
});

test('CHANGELOG.md contains none of the forbidden internal-wording phrases', () => {
  assertNoneMatch(CHANGELOG_PATH, 'CHANGELOG.md');
});

test('META: the ROT13 round-trip actually recovers the intended phrases', () => {
  // Guards against a typo in FORBIDDEN_ROT13 silently decoding to the wrong
  // (or an empty/garbage) string, which would make the two tests above
  // vacuously pass no matter what README.md/CHANGELOG.md contain. Checked
  // against a precomputed hash rather than re-encoding with rot13: rot13 is
  // self-inverse, so FORBIDDEN_PHRASES.map(rot13) always equals
  // FORBIDDEN_ROT13 regardless of what FORBIDDEN_ROT13 contains -- that
  // comparison can never fail and does not actually detect a typo.
  assert.deepEqual(
    FORBIDDEN_PHRASES.map(sha256),
    EXPECTED_PHRASE_HASHES,
    'a decoded forbidden phrase does not match its expected hash -- check FORBIDDEN_ROT13 for a typo',
  );
});

test('META: this test file itself never carries a forbidden phrase as plaintext', () => {
  // Defense in depth: even though FORBIDDEN_PHRASES only exists as decoded,
  // in-memory strings, confirm this file's own SOURCE TEXT (not the decoded
  // runtime values) is clean -- catches a future edit that reintroduces the
  // phrase in a comment or elsewhere in this file by mistake.
  const selfSrc = fs.readFileSync(SELF_PATH, 'utf8');
  const selfLower = selfSrc.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!selfLower.includes(phrase.toLowerCase()), `this file must not contain "${phrase}" as plaintext`);
  }
});
