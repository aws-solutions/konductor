// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for the missing-required-field guard in
 * scripts/brand-config/lib/constants.js's `_validateNonEmpty()`.
 *
 * A validator that iterates `Object.entries(constants)` only visits keys
 * already PRESENT in the parsed constants.json, so a dropped required field
 * (e.g. `orchestrator_variants`) is never visited at all and validation
 * passes silently. The failure then surfaces later as a raw runtime
 * `TypeError` in `isAgentSpecFilename()`
 * (`CONSTANTS.orchestrator_variants.includes(...)` on `undefined`), or, for
 * `agent_prefix`, a silent `stem.startsWith(undefined)` that coerces to the
 * literal string `"undefined"` and matches incorrectly -- contradicting
 * README.md's "rejects a missing field" claim. `_validateNonEmpty()` instead
 * iterates a fixed `REQUIRED_FIELDS` list so a missing key is caught.
 *
 * The PRE-FIX fixture below is the exact original `_validateNonEmpty()` body,
 * pinned BY VALUE (an inline literal) -- never fetched via `git show
 * HEAD:...` or any other moving ref -- to prove the test below is not
 * vacuous: it genuinely fails to catch the missing field.
 *
 * The POST-FIX assertions exercise the actual, currently-shipped
 * constants.js file unmodified (via a real `require()` of a temp copy
 * pointed at a synthetic constants.json), so a future regression in the
 * shipped code is what actually gets caught.
 *
 * Run: node --test tests/scripts/constants-missing-field-guard.test.js
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

// Pinned by value: the exact pre-fix `_validateNonEmpty()` body.
const PRE_FIX_VALIDATE_NON_EMPTY_SRC = `
function _validateNonEmpty(constants) {
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'constants-missing-field-'));
  fs.copyFileSync(CONSTANTS_JS, path.join(tmpDir, 'constants.js'));
  fs.writeFileSync(path.join(tmpDir, 'constants.json'), JSON.stringify(constantsJson));
  const modulePath = path.join(tmpDir, 'constants.js');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('constants.js exists', () => {
  assert.ok(fs.existsSync(CONSTANTS_JS), `missing constants library: ${CONSTANTS_JS}`);
});

test('_validateNonEmpty rejects a constants.json missing a required field (post-fix)', () => {
  const missingOrchestratorVariants = { ...FULL_CONSTANTS };
  delete missingOrchestratorVariants.orchestrator_variants;

  assert.throws(
    () => _loadConstantsJsWith(missingOrchestratorVariants),
    /missing required field 'orchestrator_variants'/,
  );
});

test('_validateNonEmpty rejects a constants.json missing agent_prefix (post-fix)', () => {
  const missingAgentPrefix = { ...FULL_CONSTANTS };
  delete missingAgentPrefix.agent_prefix;

  assert.throws(() => _loadConstantsJsWith(missingAgentPrefix), /missing required field 'agent_prefix'/);
});

test('_validateNonEmpty still accepts a fully-populated constants.json (happy path)', () => {
  const mod = _loadConstantsJsWith(FULL_CONSTANTS);
  assert.equal(mod.isAgentSpecFilename('asdlc-developer.agent-spec.json'), true);
});

test('confirmed fails pre-fix: pinned pre-fix _validateNonEmpty silently accepts a missing field', () => {
  const missingOrchestratorVariants = { ...FULL_CONSTANTS };
  delete missingOrchestratorVariants.orchestrator_variants;

  // eslint-disable-next-line no-new-func
  const buildValidator = new Function(`${PRE_FIX_VALIDATE_NON_EMPTY_SRC}\nreturn _validateNonEmpty;`);
  const preFixValidateNonEmpty = buildValidator();

  // The pre-fix implementation must NOT throw -- proving the bug: a missing
  // required field silently passed validation.
  assert.doesNotThrow(() => preFixValidateNonEmpty(missingOrchestratorVariants));

  // And downstream, the real defect this enabled: isAgentSpecFilename()
  // throws a raw TypeError on the missing field instead of failing loudly
  // at load time.
  assert.throws(() => {
    const stem = 'asdlc-mux-orchestrator';
    // eslint-disable-next-line no-unused-vars
    const CONSTANTS = missingOrchestratorVariants;
    return CONSTANTS.orchestrator_variants.includes(stem);
  }, TypeError);
});
