// SPDX-License-Identifier: Apache-2.0
'use strict';

// Owner rule (2026-11-19): batches extend ONE shared scenario tool set (bench/scenarios/lib) and add no per-batch copy
// of the dry-run scorer, stage, prompt renderer or hidden test helpers. bench/scenarios/legacy-copies.json froze the
// copies that existed then, each with its DEBT row; batch S moved every batch onto the lib, so that list is empty and
// may only stay so. A hidden dir names the shared helpers it needs in .bench-lib.json instead of committing them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', 'scenarios');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'legacy-copies.json'), 'utf8'));

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(path.join(dir, e.name), r)); } else out.push(r);
  }
  return out;
}

test('no new per-batch copy of a scenario tool or test helper outside bench/scenarios/lib', () => {
  const names = new Set(doc.names);
  const legacy = new Set(doc.legacy.map((l) => l.path));
  const found = walk(ROOT).filter((r) => names.has(path.basename(r)) && !r.startsWith('lib/'));
  const extra = found.filter((r) => !legacy.has(r));
  assert.deepEqual(extra, [], `new copies; extend the shared module instead: ${extra.join(', ')}`);
});

test('no file under a batch folder is a byte copy of a shared hidden helper; .bench-lib.json names it instead', () => {
  const libHidden = path.join(ROOT, 'lib', 'hidden');
  const helpers = new Map(fs.readdirSync(libHidden).map((n) => [fs.readFileSync(path.join(libHidden, n)).toString('base64'), n]));
  const copies = walk(ROOT).filter((r) => !r.startsWith('lib/')).filter((r) => helpers.has(fs.readFileSync(path.join(ROOT, r)).toString('base64')));
  assert.deepEqual(copies, [], `fold them with: node bench/scenarios/lib/stage.js --config <batch config> fold-helpers all`);
});

test('every legacy copy still exists and names a DEBT row that is in bench/DEBT.md', () => {
  const debt = fs.readFileSync(path.join(ROOT, '..', 'DEBT.md'), 'utf8');
  for (const l of doc.legacy) {
    assert.ok(fs.existsSync(path.join(ROOT, l.path)), `${l.path} is gone: remove it from legacy-copies.json (the list may only shrink)`);
    assert.match(debt, new RegExp(`^\\| ${l.debt} \\|`, 'm'), `${l.path}: ${l.debt} is not a DEBT row`);
  }
});
