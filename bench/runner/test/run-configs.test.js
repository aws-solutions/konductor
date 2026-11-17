// SPDX-License-Identifier: Apache-2.0
'use strict';

// Each command into one --out keeps its run-config: run-config.json is the latest, run-configs/ holds every one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { writeRunConfig, readRunConfigs, HISTORY_DIR } = require('../lib/run-configs.js');

test('a second command keeps the first run-config, and a run-config.json from before the history is kept too', () => {
  const out = tmp();
  try {
    write(path.join(out, 'run-config.json'), JSON.stringify({ startedAt: '2030-01-01T00:00:00.000Z', seed: 1 }));
    writeRunConfig(out, { startedAt: '2030-01-02T00:00:00.000Z', seed: 2 });
    writeRunConfig(out, { startedAt: '2030-01-02T00:00:00.000Z', seed: 3 });
    assert.deepEqual(fs.readdirSync(path.join(out, HISTORY_DIR)).sort(), ['2030-01-01T00-00-00-000Z.json', '2030-01-02T00-00-00-000Z.json', '2030-01-02T00-00-00-000Z~002.json']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'run-config.json'), 'utf8')).seed, 3, 'run-config.json is the latest');
    assert.deepEqual(readRunConfigs(out).map((c) => c.seed), [1, 2, 3]);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('readRunConfigs falls back to run-config.json alone and to nothing', () => {
  const out = tmp();
  try {
    assert.deepEqual(readRunConfigs(out), []);
    write(path.join(out, 'run-config.json'), JSON.stringify({ seed: 7 }));
    assert.deepEqual(readRunConfigs(out).map((c) => c.seed), [7]);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
