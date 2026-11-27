// SPDX-License-Identifier: Apache-2.0
'use strict';

// B-022, free step: bench/schema/plugin.schema.json describes plugin.json as core/registry.js checks it by hand.
// Every plugin.json in the repo passes it, its kind lists match the registry's, and the manifests the registry
// refuses for a field problem the schema refuses too. Free.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validate, loadSchema } = require('../lib/schema');
const { KINDS } = require('../../core/registry');

const BENCH = path.join(__dirname, '..', '..');
const SCHEMA = loadSchema('plugin');

/** Every plugin.json under the bench plugin, plant, kit and test-plant folders. */
function manifests() {
  const roots = ['plugins', 'plants', 'kit', path.join('physical', 'test', 'plants')];
  const out = [];
  for (const r of roots) {
    const dir = path.join(BENCH, r);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name, 'plugin.json');
      if (e.isDirectory() && fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

test('every plugin.json in the bench passes the plugin schema', () => {
  const files = manifests();
  assert.ok(files.length >= 9, `found only ${files.length} manifests`);
  for (const f of files) assert.deepEqual(validate(SCHEMA, JSON.parse(fs.readFileSync(f, 'utf8'))), [], f);
});

test('the schema kinds are the registry kinds, and a part may not be a plant', () => {
  assert.deepEqual(SCHEMA.properties.kind.enum, [...KINDS]);
  assert.deepEqual(SCHEMA.properties.parts.items.properties.kind.enum, KINDS.filter((k) => k !== 'plant'));
});

test('the schema refuses the field problems the registry refuses', () => {
  const good = { benchApi: 1, kind: 'harness', name: 'x', version: '1.0.0', meta: 'meta.js', entry: 'harness.js' };
  const bad = [
    { ...good, benchApi: 2 },
    { ...good, kind: 'judge' },
    { ...good, name: '' },
    (({ entry, ...m }) => m)(good),
    { ...good, parts: {} },
    { ...good, parts: [{ kind: 'plant', meta: 'm.json', entry: 'k.py' }] },
    { ...good, parts: [{ kind: 'judge-backend', meta: 'm.js' }] },
    { ...good, sharedControls: { prefix: 1, names: [] } },
    { ...good, entyr: 'typo.js' },
  ];
  assert.deepEqual(validate(SCHEMA, good), []);
  for (const m of bad) assert.notDeepEqual(validate(SCHEMA, m), [], JSON.stringify(m));
});
