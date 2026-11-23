// SPDX-License-Identifier: Apache-2.0
'use strict';

// Report and cap code reads runtime facts from the harness descriptors (`report`, `capabilities`, `costUnit`, `label`,
// `armPrefix`), never by comparing to a runtime id. This counts quoted runtime ids in bench/report and bench/cap outside
// tests. The baseline lists the files not converted yet; it only shrinks (FW-11, FW-12; DEBT D-205, D-206).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..', '..');
const BASELINE = require('./runtime-names-baseline.json');
const NAME = /'(kiro-cli|opencode|claude-code|strands)'/g;

/** `{ 'report/x.js': n }` for every non-test .js file under bench/report and bench/cap with n > 0 quoted runtime ids. */
function counts() {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && !/test/.test(e.name)) {
        const n = (fs.readFileSync(p, 'utf8').match(NAME) ?? []).length;
        if (n) out[path.relative(BENCH, p)] = n;
      }
    }
  };
  for (const d of ['report', 'cap']) walk(path.join(BENCH, d));
  return out;
}

test('no report or cap file names a runtime id beyond its baseline, and the baseline matches the code', () => {
  const now = counts();
  const over = Object.entries(now).filter(([f, n]) => n > (BASELINE.files[f] ?? 0)).map(([f, n]) => `${f}: ${n} (baseline ${BASELINE.files[f] ?? 0})`);
  assert.deepEqual(over, [], 'read the runtime fact from its descriptor instead');
  const stale = Object.entries(BASELINE.files).filter(([f, n]) => (now[f] ?? 0) < n).map(([f, n]) => `${f}: ${now[f] ?? 0} now, baseline ${n}`);
  assert.deepEqual(stale, [], 'the baseline only shrinks: lower these entries in runtime-names-baseline.json');
});
