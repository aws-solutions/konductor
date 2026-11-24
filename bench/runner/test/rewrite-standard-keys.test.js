// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/rewrite-standard-keys.js: the STANDARD audit keys on disk are what the script writes; every findings
// item keeps its base keywords, location and severity (no answer that passed before fails now); no one-word alternative
// is so short that it matches inside other words; the findings keys set no length term; a block patch changes only the
// items it names, and a raised cap never lowers the base cap.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, copies, T2, T5, BLOCK } = require('../../scenarios/rewrite-standard-keys.js');

const S = path.join(__dirname, '..', '..', 'scenarios');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(S, rel), 'utf8'));
const SHORT_OK = new Set(['dlq', 'utc', 'log', 'p99', 'pii', 'tie', 'tz', 'x 100', 'gsi', 'ntp', 'lua', 'cdc']);

test('the STANDARD audit keys on disk are what rewrite-standard-keys.js writes', () => {
  const keys = build();
  for (const [rel, key] of Object.entries(keys)) assert.deepEqual(read(rel), key, rel);
  for (const [rel, text] of Object.entries(copies(keys))) assert.equal(fs.readFileSync(path.join(S, rel), 'utf8'), text, `${rel}: a byte copy of the base kit`);
});

test('findings keys: base keywords, locations and severities kept; no length term', () => {
  for (const [id, cfg] of Object.entries(T2)) {
    const base = read(`t2/hidden/${id}/hidden/key.json`);
    const next = read(`t2/hidden/${id}-v${cfg.to}/hidden/key.json`);
    assert.equal(next.lengthAllowance, null, id);
    assert.deepEqual(next.decoys ?? [], base.decoys ?? [], `${id}: decoys`);
    assert.equal(next.items.length, base.items.length, id);
    for (const [i, b] of base.items.entries()) {
      const n = next.items[i];
      for (const k of ['id', 'section', 'file', 'line', 'endLine', 'severity']) assert.deepEqual(n[k], b[k], `${id} ${b.id} ${k}`);
      for (const w of b.fix) assert.ok(n.fix.includes(w), `${id} ${b.id}: keeps "${w}"`);
    }
  }
  for (const [id, cfg] of Object.entries(T5)) {
    const base = read(`t5/hidden/${id}/findings-kit/key.json`);
    const next = read(`t5/hidden/${id}-v${cfg.to}/findings-kit/key.json`);
    assert.equal(next.lengthAllowance, null, id);
    for (const [i, b] of base.findingsKey.entries()) {
      const n = next.findingsKey[i];
      for (const k of ['id', 'location', 'severity', 'fixMin']) assert.deepEqual(n[k], b[k], `${id} ${b.id} ${k}`);
      for (const w of b.fix) assert.ok(n.fix.includes(w), `${id} ${b.id}: keeps "${w}"`);
    }
  }
});

test('no one-word alternative is shorter than four letters (it would match inside other words)', () => {
  for (const cfg of [...Object.values(T2), ...Object.values(T5)]) {
    for (const words of Object.values(cfg.add)) {
      for (const w of words) {
        if (w.includes(' ') || w.includes('-') || SHORT_OK.has(w.toLowerCase())) continue;
        assert.ok(w.length >= 4, `"${w}" is too short to stand alone`);
      }
    }
  }
});

test('block patches touch only the named items; a cap is only raised', () => {
  for (const [id, cfg] of Object.entries(BLOCK)) {
    const batch = id.split('-')[0];
    const task = read(`${batch}/${id}.json`);
    const base = read(`${batch}/hidden/${task.hidden || id}/${cfg.kit}/key.json`);
    const next = read(`${batch}/hidden/${id}-v${cfg.to}/${cfg.kit}/key.json`);
    assert.equal(next.items.length, base.items.length, id);
    for (const [i, b] of base.items.entries()) {
      const n = next.items[i];
      if (!cfg.items[b.id]) { assert.deepEqual(n, b, `${id} ${b.id} unchanged`); continue; }
      if (cfg.items[b.id].max !== undefined) assert.ok(n.max > b.max, `${id} ${b.id}: cap raised`);
      assert.equal(n.type, b.type);
      assert.equal(n.weight, b.weight);
    }
  }
});

test('the runbook monitoring item now reads the whole step and takes a wait wording; the outbox rollback takes keep', () => {
  const { checkItem } = require('../../scenarios/lib/hidden/block-key.js');
  const rb = read('t8/hidden/t8-runbook-db-failover-v5/block-kit/key.json').items.find((i) => i.id === 'monitoring-window-is-present');
  assert.ok(checkItem({ steps: [{ action: 'Wait 60 seconds for DNS caches.', verify: 'Error rate stays at 0.' }] }, rb, '.').pass);
  assert.ok(checkItem({ steps: [{ action: 'Re-run the write check.', verify: 'No client errors 30 seconds after the check.' }] }, rb, '.').pass);
  assert.ok(!checkItem({ steps: [{ action: 'Promote orders-db-b.', verify: 'Promotion done.' }] }, rb, '.').pass);
  const ob = read('t10/hidden/t10-arch-outbox-v4/rollout-kit/key.json').items.find((i) => i.id === 'rollback-preserves');
  assert.ok(checkItem({ rollback: { steps: ['Set the flag to false and stop publishing', 'Keep the statusEvents collection; do not delete it'] } }, ob, '.').pass);
  assert.ok(!checkItem({ rollback: { steps: ['Set the flag to false and stop publishing', 'Drop the statusEvents collection'] } }, ob, '.').pass);
});
