// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test for a cross-language contract mismatch (CR-299843618
 * adversarial review, Finding 4): scripts/brand-config/lib/constants.js's
 * `_validateNonEmpty()` and this package's internal counterpart's
 * scripts/brand-config/lib/agent_match.py's `validate_constants()` /
 * `_validate_optional_field()` disagreed on whether
 * `"retired_agent_prefixes": []` is valid.
 *
 * `retired_agent_prefixes` is OPTIONAL and has no consumer that treats an
 * empty list differently from an omitted field -- agent_match.py's
 * `is_agent_name()` never reads it at all, and this package's internal
 * counterpart's own verify_rebrand.py `declared_agent_prefixes()` already
 * treats an empty list as contributing zero extra prefixes, identical to a
 * missing field. Before this fix, `constants.js` validated
 * `retired_agent_prefixes` by the SAME non-empty-array rule as the REQUIRED
 * `orchestrator_variants` field, so `"retired_agent_prefixes": []` threw at
 * this module's own `require()` time -- and because
 * scripts/generate-agent-files.js requires this module at the TOP LEVEL,
 * that crashed agent-file generation entirely for a value with no consumer
 * that treats empty specially.
 *
 * The PRE-FIX fixture below is the exact original `_validateNonEmpty()` body
 * (before ARRAY_FIELDS_ALLOWING_EMPTY existed), pinned BY VALUE -- never
 * fetched via `git show HEAD:...` or any other moving ref -- to prove the
 * test below is not vacuous: it genuinely rejects the empty array.
 *
 * The POST-FIX assertions exercise the actual, currently-shipped
 * constants.js file unmodified (via a real `require()` of a temp copy
 * pointed at a synthetic constants.json), so a future regression in the
 * shipped code is what actually gets caught.
 *
 * Run: node --test tests/scripts/constants-retired-agent-prefixes-empty-array.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONSTANTS_JS = path.join(
  REPO_ROOT,
  'scripts',
  'brand-config',
  'lib',
  'constants.js',
);

const FULL_CONSTANTS = {
  package_name: 'ASDLCCoreAICapabilities',
  orchestrator_agent: 'konductor',
  orchestrator_variants: [
    'konductor-mux-orchestrator',
    'konductor-cmux-orchestrator',
  ],
  agent_prefix: 'k-',
  skill_prefix: 'asdlc-',
  install_prefix: 'local-ASDLCCoreAICapabilities',
  bench_model_env: 'ASDLC_BENCH_MODEL_ID',
  max_inline_chars_env: 'ASDLC_MAX_INLINE_CHARS',
  claude_agents_dir_env: 'ASDLC_CLAUDE_AGENTS_DIR',
  plugin_namespace: 'standalone',
};

// Pinned by value: the exact pre-fix `_validateNonEmpty()` body -- ARRAY_FIELDS
// validated uniformly, with no per-field empty-array exemption.
const PRE_FIX_VALIDATE_NON_EMPTY_SRC = `
function _validateNonEmpty(constants) {
  const REQUIRED_FIELDS = ${JSON.stringify([
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
  ])};
  const ARRAY_FIELDS = new Set(['orchestrator_variants', 'retired_agent_prefixes']);
  for (const field of REQUIRED_FIELDS) {
    if (!(field in constants)) {
      throw new Error(\`constants.json is missing required field '\${field}'\`);
    }
  }
  for (const [field, value] of Object.entries(constants)) {
    if (ARRAY_FIELDS.has(field)) {
      if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string' || v === '')) {
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
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'constants-retired-empty-'),
  );
  fs.copyFileSync(CONSTANTS_JS, path.join(tmpDir, 'constants.js'));
  fs.writeFileSync(
    path.join(tmpDir, 'constants.json'),
    JSON.stringify(constantsJson),
  );
  const modulePath = path.join(tmpDir, 'constants.js');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('_validateNonEmpty accepts an explicit empty retired_agent_prefixes array (post-fix)', () => {
  const ok = { ...FULL_CONSTANTS, retired_agent_prefixes: [] };
  const mod = _loadConstantsJsWith(ok);
  assert.deepEqual(mod.CONSTANTS.retired_agent_prefixes, []);
});

test('_validateNonEmpty still accepts an omitted retired_agent_prefixes (post-fix)', () => {
  const mod = _loadConstantsJsWith(FULL_CONSTANTS);
  assert.equal(mod.CONSTANTS.retired_agent_prefixes, undefined);
});

test('_validateNonEmpty still accepts a non-empty retired_agent_prefixes (post-fix)', () => {
  const ok = { ...FULL_CONSTANTS, retired_agent_prefixes: ['asdlc'] };
  const mod = _loadConstantsJsWith(ok);
  assert.deepEqual(mod.CONSTANTS.retired_agent_prefixes, ['asdlc']);
});

test('_validateNonEmpty still rejects a non-string element inside an otherwise-valid retired_agent_prefixes (post-fix)', () => {
  const bad = { ...FULL_CONSTANTS, retired_agent_prefixes: ['asdlc', 42] };
  assert.throws(
    () => _loadConstantsJsWith(bad),
    /retired_agent_prefixes' must be an array of non-empty strings/,
  );
});

test('_validateNonEmpty still rejects a string retired_agent_prefixes (wrong shape, post-fix)', () => {
  const bad = { ...FULL_CONSTANTS, retired_agent_prefixes: 'asdlc' };
  assert.throws(
    () => _loadConstantsJsWith(bad),
    /retired_agent_prefixes' must be an array of non-empty strings/,
  );
});

test('_validateNonEmpty still rejects an empty orchestrator_variants (REQUIRED field, unaffected by this fix)', () => {
  const bad = { ...FULL_CONSTANTS, orchestrator_variants: [] };
  assert.throws(
    () => _loadConstantsJsWith(bad),
    /orchestrator_variants' must be a non-empty array of non-empty strings/,
  );
});

test('confirmed fails pre-fix: pinned pre-fix _validateNonEmpty rejects an empty retired_agent_prefixes', () => {
  const ok = { ...FULL_CONSTANTS, retired_agent_prefixes: [] };

  // eslint-disable-next-line no-new-func
  const buildValidator = new Function(
    `${PRE_FIX_VALIDATE_NON_EMPTY_SRC}\nreturn _validateNonEmpty;`,
  );
  const preFixValidateNonEmpty = buildValidator();

  // The pre-fix implementation MUST throw here -- proving the bug: a
  // legitimate, natural declaration ("we checked, nothing is retired yet")
  // crashed constants.js's own module load, and therefore crashed
  // generate-agent-files.js (which requires it at the top level).
  assert.throws(
    () => preFixValidateNonEmpty(ok),
    /retired_agent_prefixes' must be a non-empty array of non-empty strings/,
  );
});
