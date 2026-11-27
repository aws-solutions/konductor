// SPDX-License-Identifier: Apache-2.0
// B-013 / D-271: a plugin reaches the bench only through bench/sdk. A non-test file of a plugin (bench/plugins/<name>/
// and the kit template) may require `node:*`, the SDK (`../../sdk`) and files inside its own folder, nothing else, so
// a refactor of runner/lib cannot break a plugin without breaking the SDK, which this test loads. Each SDK part is a
// frozen list of named helpers (D-285), and a plugin that reads a helper no part lists fails here. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sdkReads, unlistedReads } = require('./sdk-reads.js');

const BENCH = path.join(__dirname, '..', '..');
const SDK_DIR = path.join(BENCH, 'sdk');
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The non-test `.js` files of the plugin folder `dir`, as absolute paths. */
function pluginSources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'test' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...pluginSources(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Every `.js` file of the plugin folder `dir` that is not under node_modules, tests included, as absolute paths. */
function allSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.name === 'node_modules') return [];
    return e.isDirectory() ? allSources(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

/**
 * ["file: require('x')"] for each require in plugin folder `dir` that is not `node:*`, the SDK at `sdkDir`, or a
 * file inside `dir`.
 */
function badRequires(dir, sdkDir) {
  const bad = [];
  for (const f of pluginSources(dir)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(REQUIRE_RE)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      if (!spec.startsWith('.')) { bad.push(`${path.relative(dir, f)}: require('${spec}')`); continue; }
      const target = path.resolve(path.dirname(f), spec);
      if (target === sdkDir || target === path.join(sdkDir, 'index.js')) continue;
      if (target.startsWith(dir + path.sep)) continue;
      bad.push(`${path.relative(dir, f)}: require('${spec}')`);
    }
  }
  return bad;
}

const PLUGIN_DIRS = [
  ...fs.readdirSync(path.join(BENCH, 'plugins')).map((n) => path.join(BENCH, 'plugins', n)),
  path.join(BENCH, 'kit', 'plugin-template'),
].filter((d) => fs.existsSync(path.join(d, 'plugin.json')));

test('the scan refuses a plugin that requires runner/lib or a sibling plugin, and accepts node:, the SDK and its own files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-sdk-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'plugins', 'x');
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ok.js'), "require('node:fs'); require('../../sdk'); require('../../sdk/index.js'); require('./parse.js');");
  fs.writeFileSync(path.join(dir, 'bad.js'), "require('../../runner/lib/stream.js'); require('../y/parse.js'); require('lodash');");
  fs.writeFileSync(path.join(dir, 'test', 'c.js'), "require('../../../runner/test/fake.js');");
  assert.deepEqual(badRequires(dir, path.join(root, 'sdk')), [
    "bad.js: require('../../runner/lib/stream.js')", "bad.js: require('../y/parse.js')", "bad.js: require('lodash')",
  ]);
});

test('no plugin, and not the kit template, requires anything but node:, the SDK and its own folder (D-271)', () => {
  assert.ok(PLUGIN_DIRS.length >= 5, `found ${PLUGIN_DIRS.length} plugin folders`);
  const bad = PLUGIN_DIRS.flatMap((d) => badRequires(d, SDK_DIR).map((b) => `${path.relative(BENCH, d)}/${b}`));
  assert.deepEqual(bad, [], 'require it through bench/sdk instead, adding it there if it is not yet exported');
});

test('sdkReads finds the ways a plugin reads the SDK, and unlistedReads names what a part lacks (D-285)', () => {
  const src = [
    "// const { ignored } = require('../../sdk').stream;",
    "const { parseStream, runErrorOf: err } = require('../../sdk').stream;",
    "const sandbox = require('../../sdk').sandbox;",
    "const rc = () => require('../../sdk').runconfig;",
    "const { models } = require('../../sdk').plant.bedrockModels;",
    "const t = require('../../sdk').trace.kiroTimeline(1);",
    "const sdk = require('../../sdk');",
    "const { spawnWithTimeout } = sdk.runOne; sdk.isolate.resolveIsolation(); sandbox.prepareArm(); rc().envPolicy();",
    "const { procs: p, owned } = sdk; p.trackScratch(1); owned.writeAtomic();",
  ].join('\n');
  assert.deepEqual(sdkReads(src), [
    'isolate.resolveIsolation', 'owned.writeAtomic', 'plant.bedrockModels.models', 'procs.trackScratch', 'runOne.spawnWithTimeout', 'runconfig.envPolicy',
    'sandbox.prepareArm', 'stream.parseStream', 'stream.runErrorOf', 'trace.kiroTimeline',
  ]);
  const sdk = { stream: { parseStream() {} }, plant: { agentFile: { plantPrompt() {} } } };
  assert.deepEqual(unlistedReads(['stream.parseStream', 'stream.gone', 'nope.x', 'plant.agentFile.plantPrompt', 'plant.agentFile.gone'], sdk),
    ['stream.gone', 'nope.x', 'plant.agentFile.gone']);
});

test('no plugin source or plugin test reads a helper the SDK does not list (D-285)', () => {
  const sdk = require(SDK_DIR);
  const unlisted = PLUGIN_DIRS.flatMap((d) => allSources(d).flatMap((f) => unlistedReads(sdkReads(fs.readFileSync(f, 'utf8')), sdk).map((r) => `${path.relative(BENCH, f)}: ${r}`)));
  assert.deepEqual(unlisted, [], 'list the helper in its part in bench/sdk/index.js, or read another one');
});

test('every SDK part is a frozen list of named helpers, and each name is one its module exports (D-285)', () => {
  const sdk = require(SDK_DIR);
  const parts = (obj, at) => Object.entries(obj).flatMap(([k, v]) => (k === 'benchApi' ? [] : k === 'plant' && at === '' ? parts(v, 'plant.') : [[`${at}${k}`, v]]));
  const all = parts(sdk, '');
  assert.ok(all.length >= 25, `found ${all.length} parts`);
  for (const [name, part] of all) {
    assert.ok(Object.isFrozen(part), `sdk.${name} is frozen`);
    assert.ok(Object.keys(part).length > 0, `sdk.${name} lists helpers`);
    for (const k of Object.keys(part)) assert.notEqual(part[k], undefined, `sdk.${name}.${k} is not exported by its module`);
  }
});

test('every part the SDK exports loads, and benchApi is the API the registry speaks', () => {
  const sdk = require(SDK_DIR);
  const { PLUGIN_API } = require('../../core/registry.js');
  assert.equal(sdk.benchApi, PLUGIN_API);
  const walk = (obj, at) => {
    for (const k of Object.keys(obj)) {
      if (k === 'benchApi') continue;
      const v = obj[k];
      assert.ok(v && typeof v === 'object', `sdk${at}.${k} did not load`);
      if (at === '' && k === 'plant') walk(v, '.plant');
    }
  };
  walk(sdk, '');
  assert.ok(Object.isFrozen(sdk), 'the SDK object is frozen: a plugin cannot change what another plugin sees');
});

test('the SDK exports what the opencode judge needs to move into its plugin: run-one and procs (B-014 step 2)', () => {
  const sdk = require(SDK_DIR);
  assert.equal(typeof sdk.runOne.spawnWithTimeout, 'function');
  assert.equal(sdk.runOne.spawnWithTimeout, require('../lib/run-one.js').spawnWithTimeout);
  assert.equal(sdk.procs.trackScratch, require('../lib/procs.js').trackScratch);
  for (const k of ['stream', 'sandbox', 'awsCreds']) assert.ok(sdk[k], `sdk.${k}`);
  assert.equal(sdk.judgePrompt.JUDGE_SYSTEM_PROMPT, require('../../judge/system-prompt.js').JUDGE_SYSTEM_PROMPT, 'the judge system prompt, for a judge-backend plugin');
});

test('the opencode judge is a judge-backend part of plugins/opencode, with its prompt cap, cache salt and panel check (B-014 step 2)', () => {
  const { backendRegistry, BUILTIN_BACKENDS } = require('../../judge/backends.js');
  const { maxPromptBytes } = require('../../judge/config.js');
  assert.deepEqual(BUILTIN_BACKENDS.map((b) => b.id), ['kiro'], 'kiro is the one built-in backend');
  const part = backendRegistry().part('opencode');
  assert.equal(part.source, 'plugin');
  assert.equal(part.entry, path.join(BENCH, 'plugins', 'opencode', 'judge.js'));
  assert.equal(part.meta.costUnit, 'usd');
  assert.equal(maxPromptBytes('opencode'), 400000);
  assert.equal(maxPromptBytes('kiro'), 120000);
  const mod = require(part.entry);
  for (const k of ['makeCaller', 'cacheSalt', 'checkJudges']) assert.equal(typeof mod[k], 'function', k);
  assert.equal(fs.existsSync(path.join(BENCH, 'judge', 'opencode.js')), false, 'the core judge/opencode.js is gone');
});
