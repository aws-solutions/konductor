// SPDX-License-Identifier: Apache-2.0
// The plugin registry (core/registry.js): built-ins first, then bench/plugins/*/plugin.json; a bad manifest is refused
// with its reason, a name clash is an error, and each loaded plugin is recorded with its folder hash. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { createRegistry, folderHash, PLUGIN_API } = require('../../core/registry.js');
const { REGISTRY, DESCRIPTORS } = require('../lib/harness/descriptors.js');
const builtin = (id) => ({ kind: 'harness', meta: Object.freeze({ id }) });

/** A plugin folder `name` under `root` with manifest fields `m` (over good defaults) and a meta of id `metaId`. */
function plugin(root, name, m = {}, metaId = name) {
  const dir = path.join(root, name);
  write(path.join(dir, 'meta.js'), `module.exports = Object.freeze({ id: ${JSON.stringify(metaId)} });\n`);
  write(path.join(dir, 'harness.js'), 'module.exports = {};\n');
  write(path.join(dir, 'plugin.json'), JSON.stringify({ benchApi: PLUGIN_API, kind: 'harness', name, version: '0.1.0', meta: 'meta.js', entry: 'harness.js', ...m }));
  return dir;
}

test('built-ins come first, then plugins by folder name; each plugin is recorded with its folder hash', () => {
  const root = tmp();
  try {
    plugin(root, 'zeta');
    plugin(root, 'alpha');
    const r = createRegistry({ builtins: [builtin('kiro-cli')], pluginRoots: [root] });
    assert.deepEqual(r.parts('harness').map((p) => [p.name, p.source]), [['kiro-cli', 'builtin'], ['alpha', 'plugin'], ['zeta', 'plugin']]);
    assert.deepEqual(r.record().map((p) => p.name), ['alpha', 'zeta']);
    assert.match(r.record()[0].sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(r.refused(), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the folder hash changes with any file in the plugin, and not with a cache folder', () => {
  const root = tmp();
  try {
    const dir = plugin(root, 'alpha');
    const before = folderHash(dir);
    write(path.join(dir, '__pycache__', 'x.pyc'), 'cache');
    assert.equal(folderHash(dir), before);
    write(path.join(dir, 'harness.js'), 'module.exports = { changed: true };\n');
    assert.notEqual(folderHash(dir), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('another benchApi, an unknown kind, a missing file or a mismatched name is refused with its reason, never loaded', () => {
  const root = tmp();
  try {
    plugin(root, 'newer', { benchApi: 2 });
    plugin(root, 'oddkind', { kind: 'scorer' });
    plugin(root, 'nofile', { entry: 'missing.js' });
    plugin(root, 'renamed', { name: 'other' });
    plugin(root, 'wrongmeta', {}, 'someone-else');
    plugin(root, 'escape', { meta: '../../outside.js' });
    write(path.join(root, 'broken', 'plugin.json'), '{ not json');
    const r = createRegistry({ pluginRoots: [root] });
    assert.deepEqual(r.parts('harness'), []);
    const why = Object.fromEntries(r.refused().map((x) => [path.basename(x.dir), x.why]));
    assert.match(why.newer, /benchApi 2 is not 1/);
    assert.match(why.oddkind, /kind "scorer" is not one of harness/);
    assert.match(why.nofile, /"entry" file missing\.js does not exist/);
    assert.match(why.renamed, /must equal its folder name/);
    assert.match(why.wrongmeta, /meta id "someone-else" must equal the plugin name "wrongmeta"/);
    assert.match(why.escape, /must stay inside the plugin folder/);
    assert.match(why.broken, /plugin\.json:/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a plugin with the name of a built-in is an error', () => {
  const root = tmp();
  try {
    plugin(root, 'kiro-cli');
    assert.throws(() => createRegistry({ builtins: [builtin('kiro-cli')], pluginRoots: [root] }), /two harness parts are named "kiro-cli"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the bench registry keeps the runtime order and records no plugin while bench/plugins is empty', () => {
  assert.deepEqual(DESCRIPTORS.map((d) => d.id), ['kiro-cli', 'opencode', 'claude-code', 'strands']);
  assert.deepEqual(REGISTRY.refused(), []);
  assert.ok(Array.isArray(REGISTRY.record()));
});
