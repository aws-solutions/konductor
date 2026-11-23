// SPDX-License-Identifier: Apache-2.0
// FW-18 (DEBT D-212): built-in harnesses move to bench/plugins one at a time. A move must change nothing a user sees:
// the runtime order (RUNTIMES, list-arms) stays kiro-cli, opencode, claude-code, strands; each moved harness passes
// the plugin kit's four checks; and run-config.json records it with its folder hash. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRegistry, folderHash } = require('../../core/registry.js');
const { REGISTRY, PLUGINS_DIR } = require('../lib/harness/descriptors.js');
const { RUNTIMES } = require('../lib/harness/runtime.js');
const { HARNESSES } = require('../lib/harness/index.js');
const { checksOf } = require('../../kit/plugin/check.js');

// The harnesses that live in bench/plugins now. A move adds its name here.
const MOVED = ['kiro-cli', 'opencode', 'claude-code', 'strands'];

test('createRegistry puts the parts named in `order` first, in that order, and the rest after in their own order', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-order-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const meta = (id) => Object.freeze({ id });
  const r = createRegistry({ builtins: [{ kind: 'harness', meta: meta('k') }, { kind: 'harness', meta: meta('c') }, { kind: 'harness', meta: meta('z') }], pluginRoots: [root], order: ['k', 'o', 'c'] });
  assert.deepEqual(r.descriptors().map((d) => d.id), ['k', 'c', 'z']);
  const r2 = createRegistry({ builtins: [{ kind: 'harness', meta: meta('z') }, { kind: 'harness', meta: meta('c') }, { kind: 'harness', meta: meta('k') }], order: ['k', 'c'] });
  assert.deepEqual(r2.descriptors().map((d) => d.id), ['k', 'c', 'z']);
});

test('one harness, the default runtime, may have no arm prefix; a second one is refused', () => {
  const meta = (id, armPrefix) => Object.freeze({ id, armPrefix });
  assert.doesNotThrow(() => createRegistry({ builtins: [{ kind: 'harness', meta: meta('a', '') }, { kind: 'harness', meta: meta('b', 'b-') }] }));
  assert.throws(() => createRegistry({ builtins: [{ kind: 'harness', meta: meta('a', '') }, { kind: 'harness', meta: meta('b', '') }] }), /two harnesses have no arm prefix \(a, b\)/);
  assert.equal(REGISTRY.descriptors().filter((d) => d.armPrefix === '').map((d) => d.id).join(), 'kiro-cli');
});

test('the runtime order a user sees is unchanged by the moves', () => {
  assert.deepEqual(RUNTIMES, ['kiro-cli', 'opencode', 'claude-code', 'strands']);
  assert.deepEqual(Object.keys(HARNESSES), RUNTIMES);
});

for (const name of MOVED) {
  test(`${name} loads from bench/plugins, passes the kit's four checks and is recorded with its hash`, () => {
    const part = REGISTRY.parts('harness').find((p) => p.name === name);
    assert.equal(part?.source, 'plugin');
    assert.equal(part.plugin.dir, path.join(PLUGINS_DIR, name));
    assert.deepEqual(checksOf(part.plugin.dir), { contract: [], 'fake-run': [], 'plant-kind': [], golden: [] });
    const rec = REGISTRY.record().find((r) => r.name === name);
    assert.equal(rec.sha256, folderHash(part.plugin.dir));
    assert.equal(HARNESSES[name].meta, part.meta);
  });
}
