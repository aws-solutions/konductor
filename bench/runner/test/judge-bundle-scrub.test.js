// SPDX-License-Identifier: Apache-2.0
'use strict';

// The bundle is the last stop before text goes to a judge model, so it scrubs credential-shaped text itself.
// Every secret is a made-up value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { buildBundle } = require('../../judge/bundle.js');
const { DEFAULT_REDACTIONS, compileRedactions } = require('../../judge/redact.js');
const { DEFAULTS } = require('../../judge/config.js');
const { scrubStringCounted } = require('../lib/scrub.js');

const KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const LITERAL = 'planted-literal-secret-value-7431';

function setup(spec) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'v1.2.0', ...spec }]);
  const dir = path.join(runDir, 'v1.2.0/t1/1');
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const build = (extra = {}) => buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS), ...extra });
  return { root, build };
}

test('a key in the final text and in a changed file is replaced, and the replacements are counted', () => {
  const { root, build } = setup({ finalText: `I found ${KEY} in the environment.`, files: { 'a.txt': `config\naws_access_key_id = ${KEY}\nBearer ${'t'.repeat(30)}\n` } });
  try {
    const b = build();
    assert.ok(!b.text.includes(KEY) && !b.text.includes('t'.repeat(30)));
    assert.match(b.text, /I found <redacted> in the environment\./);
    assert.ok(b.files.every((f) => !f.text || !f.text.includes(KEY)));
    assert.deepEqual(b.meta.credsScrubbed, { text: 3, files: 2 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('exact secret values passed as literals are replaced too; without them or a matching environment variable only shapes are', () => {
  const { root, build } = setup({ finalText: `token is ${LITERAL}`, files: { 'a.txt': `x ${LITERAL}\n` } });
  try {
    assert.ok(build().text.includes(LITERAL));
    const b = build({ literals: [LITERAL] });
    assert.ok(!b.text.includes(LITERAL));
    assert.ok(!b.files.some((f) => f.text?.includes(LITERAL)));
    assert.deepEqual(b.meta.credsScrubbed, { text: 2, files: 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a bundle with nothing to scrub is unchanged and counts zero', () => {
  const { root, build } = setup({ finalText: 'All fixed.', files: { 'a.txt': 'alpha fixed\n' } });
  try {
    const b = build();
    assert.match(b.text, /All fixed\./);
    assert.match(b.text, /alpha fixed/);
    assert.deepEqual(b.meta.credsScrubbed, { text: 0, files: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scrubStringCounted matches scrubString and counts each literal occurrence and shape match', () => {
  const { scrubString } = require('../lib/scrub.js');
  const text = `a ${KEY} b ${KEY} c ${LITERAL} d ${LITERAL} Bearer ${'z'.repeat(20)}`;
  const r = scrubStringCounted(text, [LITERAL]);
  assert.equal(r.text, scrubString(text, [LITERAL]));
  assert.equal(r.count, 5);
});

test('a bare secret with no known prefix is masked when it is in the environment, without the caller passing it', () => {
  const bare = 'plainbaresecretvalue-93e1b7c2';
  const { root, build } = setup({ finalText: `the token is ${bare}`, files: { 'a.txt': `x ${bare}\n` } });
  const before = process.env.BENCH_TEST_BUNDLE_SECRET_TOKEN;
  process.env.BENCH_TEST_BUNDLE_SECRET_TOKEN = bare;
  try {
    const b = build();
    assert.ok(!b.text.includes(bare));
    assert.ok(!b.files.some((f) => f.text?.includes(bare)));
    assert.deepEqual(b.meta.credsScrubbed, { text: 2, files: 1 });
  } finally {
    if (before === undefined) delete process.env.BENCH_TEST_BUNDLE_SECRET_TOKEN; else process.env.BENCH_TEST_BUNDLE_SECRET_TOKEN = before;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
