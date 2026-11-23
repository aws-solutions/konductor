// SPDX-License-Identifier: Apache-2.0
// `bench plugins` (runner/lib/plugins-cmd.js): one table of every registry part, built-in or plugin, and the refused
// plugin folders with their reason. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRegistry, folderHash } = require('../../core/registry.js');
const { pluginsTable } = require('../lib/plugins-cmd.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const STRANDS = path.join(__dirname, '..', '..', 'plugins', 'strands');

test('pluginsTable lists each part with its source, and a plugin with its version, api and short hash', () => {
  const reg = createRegistry({ builtins: [{ kind: 'harness', meta: Object.freeze({ id: 'kiro-cli' }) }], pluginRoots: [path.dirname(STRANDS)] });
  const text = pluginsTable([reg]);
  assert.match(text, /\| harness \| kiro-cli \| built-in \| - \| - \| - \|/);
  assert.match(text, new RegExp(`\\| harness \\| strands \\| plugin \\| 1\\.0\\.0 \\| 1 \\| ${folderHash(STRANDS).slice(0, 12)} \\|`));
  assert.doesNotMatch(text, /Refused/);
});

test('bench plugins prints the harnesses and the judge backends', () => {
  const r = spawnSync(process.execPath, [BENCH_JS, 'plugins'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const name of ['kiro-cli', 'opencode', 'claude-code', 'strands']) assert.match(r.stdout, new RegExp(`\\| harness \\| ${name} \\|`));
  assert.match(r.stdout, /\| judge-backend \| kiro \| built-in \|/);
});

test('bench plugins --json lists the same parts as data', () => {
  const r = spawnSync(process.execPath, [BENCH_JS, 'plugins', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const st = JSON.parse(r.stdout).parts.find((p) => p.name === 'strands');
  assert.deepEqual(st, { kind: 'harness', name: 'strands', source: 'plugin', version: '1.0.0', benchApi: 1, sha256: folderHash(STRANDS) });
});
