// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/rewrite-keyword-keys.js: the four semantic keyword keys are what the script writes, each item keeps
// every keyword of its base key (no correct answer that passed before fails now), and no alternative is a word so
// short that it matches inside other words (the grader reads a one-word keyword anywhere in the text).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, T5, T2 } = require('../../scenarios/rewrite-keyword-keys.js');

const S = path.join(__dirname, '..', '..', 'scenarios');
const SHORT_OK = new Set(['dlq', 'utc', 'log', 'p99', 'pii', 'tie', 'tz', 'x 100']);

test('the four semantic keys on disk are what rewrite-keyword-keys.js writes', () => {
  for (const [rel, key] of Object.entries(build())) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(S, rel), 'utf8')), key, rel);
  }
});

test('every rewritten item keeps the base key\'s keywords, its severity and its first location', () => {
  for (const cfg of Object.values(T5)) {
    const base = JSON.parse(fs.readFileSync(path.join(S, cfg.from), 'utf8')).findingsKey;
    const next = JSON.parse(fs.readFileSync(path.join(S, cfg.to), 'utf8')).findingsKey;
    assert.equal(next.length, base.length);
    for (const [i, b] of base.entries()) {
      const n = next[i];
      assert.equal(n.id, b.id);
      assert.equal(n.severity, b.severity, b.id);
      for (const w of b.fix) assert.ok(n.fix.includes(w), `${b.id}: keeps "${w}"`);
      assert.equal([].concat(n.location)[0], [].concat(b.location)[0], `${b.id}: first location`);
    }
  }
  for (const cfg of Object.values(T2)) {
    const base = JSON.parse(fs.readFileSync(path.join(S, cfg.from), 'utf8')).items;
    const next = JSON.parse(fs.readFileSync(path.join(S, cfg.to), 'utf8')).items;
    assert.equal(next.length, base.length);
    for (const [i, b] of base.entries()) {
      const n = next[i];
      assert.equal(n.id, b.id);
      assert.equal(n.section, b.section, b.id);
      assert.equal(n.severity, b.severity, b.id);
      for (const w of b.fix) assert.ok(n.fix.includes(w), `${b.id}: keeps "${w}"`);
    }
  }
});

test('no one-word alternative is shorter than four letters (it would match inside other words)', () => {
  for (const key of Object.values(build())) {
    for (const item of key.findingsKey ?? key.items) {
      for (const w of item.fix) {
        if (w.includes(' ') || w.includes('-') || SHORT_OK.has(w.toLowerCase())) continue;
        assert.ok(w.length >= 4, `${item.id}: "${w}" is too short to stand alone`);
      }
    }
  }
});
