// SPDX-License-Identifier: Apache-2.0
// B-015 / D-272: BENCH_PLUGIN_PATH names extra plugin folders outside this repo, read by the harness and the judge
// backend registries. A plugin found there loads like one under bench/plugins; a bad one is refused with its reason;
// a bad path entry stops the bench with a message. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pluginPathRoots } = require('../../core/registry.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const SDK = path.join(__dirname, '..', '..', 'sdk');

/** A temp folder outside the repo holding the plugin folders `plugins` ({name: {file: text}}). */
function outsideRoot(t, plugins) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, files] of Object.entries(plugins)) {
    fs.mkdirSync(path.join(root, name));
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name, f), text);
  }
  return root;
}

const manifest = (name, api = 1) => JSON.stringify({ benchApi: api, kind: 'judge-backend', name, version: '0.1.0', meta: 'meta.js', entry: 'backend.js' });
const backend = (name) => ({
  'plugin.json': manifest(name),
  'meta.js': `module.exports = Object.freeze({ id: '${name}', costUnit: 'usd', label: 'an outside backend' });`,
  // An outside plugin cannot reach the SDK by a relative path, so it names the bench checkout's SDK folder.
  'backend.js': `const { sandbox } = require(${JSON.stringify(SDK)}); exports.makeCaller = () => async () => ({ text: typeof sandbox.sha256File, credits: 0, usd: 0, latencyMs: 1 });`,
});

test('pluginPathRoots reads a path list of absolute folders, and refuses a relative or missing one', (t) => {
  const a = outsideRoot(t, {});
  const b = outsideRoot(t, {});
  assert.deepEqual(pluginPathRoots({}), []);
  assert.deepEqual(pluginPathRoots({ BENCH_PLUGIN_PATH: '' }), []);
  assert.deepEqual(pluginPathRoots({ BENCH_PLUGIN_PATH: `${a}${path.delimiter}${path.delimiter}${b}` }), [a, b]);
  assert.throws(() => pluginPathRoots({ BENCH_PLUGIN_PATH: 'my-plugins' }), /BENCH_PLUGIN_PATH entry "my-plugins" is not an absolute path/);
  assert.throws(() => pluginPathRoots({ BENCH_PLUGIN_PATH: path.join(a, 'gone') }), /BENCH_PLUGIN_PATH entry ".*gone" is not a folder/);
});

test('bench plugins lists a judge backend from BENCH_PLUGIN_PATH and refuses a bad one with its reason', (t) => {
  const root = outsideRoot(t, { 'outside-be': backend('outside-be'), 'bad-be': { ...backend('bad-be'), 'plugin.json': manifest('bad-be', 2) } });
  const r = spawnSync(process.execPath, [BENCH_JS, 'plugins', '--json'], { encoding: 'utf8', env: { ...process.env, BENCH_PLUGIN_PATH: root } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const be = out.parts.find((p) => p.name === 'outside-be');
  assert.ok(be, r.stdout);
  assert.equal(be.kind, 'judge-backend');
  assert.equal(be.source, 'plugin');
  assert.ok(out.refused.some((x) => x.dir === path.join(root, 'bad-be') && /benchApi 2 is not 1/.test(x.why)), r.stdout);
  assert.ok(!out.parts.some((p) => p.name === 'bad-be'));
});

test('the outside backend loads and reaches the SDK by its absolute path', async (t) => {
  const root = outsideRoot(t, { 'outside-be': backend('outside-be') });
  const { backendRegistry } = require('../../judge/backends.js');
  const reg = backendRegistry([root]);
  assert.ok(reg.ids().includes('outside-be'));
  const caller = require(reg.part('outside-be').entry).makeCaller({});
  assert.equal((await caller({ model: 'm', prompt: 'p' })).text, 'function');
});

test('a bad BENCH_PLUGIN_PATH stops the bench with the reason', () => {
  const r = spawnSync(process.execPath, [BENCH_JS, 'plugins'], { encoding: 'utf8', env: { ...process.env, BENCH_PLUGIN_PATH: 'relative/dir' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /BENCH_PLUGIN_PATH entry "relative\/dir" is not an absolute path/);
});
