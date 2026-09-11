// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for a mirror-rule gap: this package's internal
 * counterpart has an equivalent Python config validator
 * (`agent_match.py`'s `validate_constants()`) where `orchestrator_variants`
 * supplied as a STRING (instead of an array) silently passed validation,
 * then degraded `is_agent_name()`'s `name in orchestrator_variants` from a
 * list-membership test into a Python substring test. This package's JS
 * reader, scripts/brand-config/lib/constants.js's `_validateNonEmpty()`, had
 * the IDENTICAL class of gap even though `orchestrator_agent`/
 * `orchestrator_variants` are declared REQUIRED here (unlike the Python
 * side, where they are optional): the generic per-field loop only checks
 * "is this value a non-empty array, OR a non-empty string" -- it never
 * checks which of the two SHAPES a given field is supposed to be. A
 * constants.json supplying `orchestrator_variants` as a non-empty string
 * therefore passed the generic loop (it satisfies the "non-empty string"
 * branch), then flowed into `isAgentSpecFilename()`'s
 * `CONSTANTS.orchestrator_variants.includes(stem)` -- which for a JS string
 * is `String.prototype.includes()`, a SUBSTRING test, not
 * `Array.prototype.includes()`'s membership test.
 *
 * The PRE-FIX fixture below is the exact original `_validateNonEmpty()` body
 * (before this fix added the two explicit shape checks), pinned BY VALUE --
 * never fetched via `git show HEAD:...` or any other moving ref -- to prove
 * the tests below are not vacuous: it genuinely fails to catch a string
 * `orchestrator_variants`.
 *
 * The POST-FIX assertions exercise the actual, currently-shipped
 * constants.js file unmodified (via a real `require()` of a temp copy
 * pointed at a synthetic constants.json), so a future regression in the
 * shipped code is what actually gets caught.
 *
 * Run: node --test tests/scripts/constants-orchestrator-variants-type-guard.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONSTANTS_JS = path.join(REPO_ROOT, 'scripts', 'brand-config', 'lib', 'constants.js');

const FULL_CONSTANTS = {
  package_name: 'ASDLCCoreAICapabilities',
  orchestrator_agent: 'asdlc-orchestrator',
  orchestrator_variants: ['asdlc-mux-orchestrator', 'asdlc-cmux-orchestrator'],
  agent_prefix: 'asdlc-',
  skill_prefix: 'asdlc-',
  install_prefix: 'local-ASDLCCoreAICapabilities',
  bench_model_env: 'ASDLC_BENCH_MODEL_ID',
  max_inline_chars_env: 'ASDLC_MAX_INLINE_CHARS',
  claude_agents_dir_env: 'ASDLC_CLAUDE_AGENTS_DIR',
  plugin_namespace: 'standalone',
};

const REQUIRED_FIELDS = [
  'package_name',
  'orchestrator_agent',
  'orchestrator_variants',
  'agent_prefix',
  'skill_prefix',
  'install_prefix',
  'bench_model_env',
  'max_inline_chars_env',
  'claude_agents_dir_env',
  'plugin_namespace',
];

// Pinned by value: the exact pre-fix `_validateNonEmpty()` body -- the
// generic per-field loop with NO orchestrator_agent/orchestrator_variants
// shape checks appended.
const PRE_FIX_VALIDATE_NON_EMPTY_SRC = `
function _validateNonEmpty(constants) {
  const REQUIRED_FIELDS = ${JSON.stringify(REQUIRED_FIELDS)};
  for (const field of REQUIRED_FIELDS) {
    if (!(field in constants)) {
      throw new Error(\`constants.json is missing required field '\${field}'\`);
    }
  }
  for (const [field, value] of Object.entries(constants)) {
    if (Array.isArray(value)) {
      if (value.length === 0 || value.some((v) => typeof v !== 'string' || v === '')) {
        throw new Error(\`constants.json field '\${field}' must be a non-empty array of non-empty strings\`);
      }
    } else if (typeof value !== 'string' || value === '') {
      throw new Error(\`constants.json field '\${field}' must be a non-empty string\`);
    }
  }
}
`;

/** Loads a fresh, isolated copy of constants.js (the REAL, unmodified
 * shipped source) pointed at a synthetic constants.json in a tmp dir, so
 * each test gets a clean require() cache entry and never touches the real
 * package constants.json. */
function _loadConstantsJsWith(constantsJson) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'constants-orch-variants-type-'));
  fs.copyFileSync(CONSTANTS_JS, path.join(tmpDir, 'constants.js'));
  fs.writeFileSync(path.join(tmpDir, 'constants.json'), JSON.stringify(constantsJson));
  const modulePath = path.join(tmpDir, 'constants.js');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('_validateNonEmpty rejects a string orchestrator_variants (post-fix)', () => {
  const bad = { ...FULL_CONSTANTS, orchestrator_variants: 'asdlc-mux-orchestrator' };

  // Message updated by the f-7e240a06 fix: orchestrator_variants is now
  // validated the same way as every other ARRAY_FIELDS entry (expected-shape
  // check), not by a standalone Array.isArray() assertion with its own
  // wording.
  assert.throws(() => _loadConstantsJsWith(bad), /orchestrator_variants' must be a non-empty array of non-empty strings/);
});

test('_validateNonEmpty rejects a non-string orchestrator_agent (post-fix)', () => {
  const bad = { ...FULL_CONSTANTS, orchestrator_agent: ['asdlc-orchestrator'] };

  // Message updated by the f-7e240a06 fix: orchestrator_agent (not in
  // ARRAY_FIELDS) now falls through to the same "must be a non-empty
  // string" branch every other scalar field uses.
  assert.throws(() => _loadConstantsJsWith(bad), /orchestrator_agent' must be a non-empty string/);
});

test('_validateNonEmpty rejects a scalar field supplied as a non-empty array (f-7e240a06)', () => {
  // AutoSDE finding f-7e240a06: a scalar field (anything not in
  // ARRAY_FIELDS) supplied as a non-empty array of non-empty strings used to
  // pass validation silently, because the pre-fix loop branched on the
  // value's RUNTIME shape (Array.isArray(value)) instead of the field's
  // EXPECTED shape.
  const bad = { ...FULL_CONSTANTS, agent_prefix: ['asdlc-'] };

  assert.throws(() => _loadConstantsJsWith(bad), /agent_prefix' must be a non-empty string/);
});

test('confirmed fails pre-fix: pinned pre-fix _validateNonEmpty accepts a scalar field supplied as an array (f-7e240a06)', () => {
  const bad = { ...FULL_CONSTANTS, agent_prefix: ['asdlc-'] };

  // eslint-disable-next-line no-new-func
  const buildValidator = new Function(`${PRE_FIX_VALIDATE_NON_EMPTY_SRC}\nreturn _validateNonEmpty;`);
  const preFixValidateNonEmpty = buildValidator();

  // The pre-fix implementation must NOT throw -- proving the bug: a scalar
  // field supplied as a non-empty array of non-empty strings silently passed
  // validation because the loop only checked the value's runtime shape.
  assert.doesNotThrow(() => preFixValidateNonEmpty(bad));
});

test('_validateNonEmpty still accepts a fully-populated constants.json (happy path)', () => {
  const mod = _loadConstantsJsWith(FULL_CONSTANTS);
  assert.equal(mod.isAgentSpecFilename('asdlc-developer.agent-spec.json'), true);
});

test('confirmed fails pre-fix: pinned pre-fix _validateNonEmpty accepts a string orchestrator_variants and causes a substring match', () => {
  const bad = { ...FULL_CONSTANTS, orchestrator_variants: 'asdlc-mux-orchestrator' };

  // eslint-disable-next-line no-new-func
  const buildValidator = new Function(`${PRE_FIX_VALIDATE_NON_EMPTY_SRC}\nreturn _validateNonEmpty;`);
  const preFixValidateNonEmpty = buildValidator();

  // The pre-fix implementation must NOT throw -- proving the bug: a string
  // orchestrator_variants silently passed validation.
  assert.doesNotThrow(() => preFixValidateNonEmpty(bad));

  // And downstream, the real defect this enabled: a bare orchestrator
  // variant name that is only a SUBSTRING of the configured value (here
  // "mux" inside "asdlc-mux-orchestrator") is incorrectly treated as a
  // match, because CONSTANTS.orchestrator_variants.includes(stem) resolves
  // to String.prototype.includes() rather than Array.prototype.includes().
  function preFixIsAgentSpecFilename(filename, CONSTANTS) {
    const AGENT_SPEC_SUFFIX = '.agent-spec.json';
    if (!filename.endsWith(AGENT_SPEC_SUFFIX)) return false;
    const stem = filename.slice(0, -AGENT_SPEC_SUFFIX.length);
    return (
      stem === CONSTANTS.orchestrator_agent ||
      CONSTANTS.orchestrator_variants.includes(stem) ||
      stem.startsWith(CONSTANTS.agent_prefix)
    );
  }

  assert.equal(
    preFixIsAgentSpecFilename('mux.agent-spec.json', bad),
    true,
    'pre-fix snippet did not reproduce the bug -- expected the substring "mux" inside ' +
      '"asdlc-mux-orchestrator" to make isAgentSpecFilename() return true',
  );
});
