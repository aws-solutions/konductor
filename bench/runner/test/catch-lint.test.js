// SPDX-License-Identifier: Apache-2.0
'use strict';

// Catch lint (FW-26): a catch block in bench code that swallows its error must say why in a comment, or record it.
// A bare `catch {}` fails, except the per-file counts in catch-lint-baseline.json, which only shrink.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bareCatches, scan } = require('../../scripts/bare-catch.js');
const { benchFiles } = require('../../scripts/fn-sizes.js');

test('bare-catch: an empty catch is found; one with a comment or a statement is not', () => {
  const src = [
    'try { a(); } catch {}',
    'try { a(); } catch (e) {',
    '}',
    'try { a(); } catch { /* the file may be gone: nothing to clean */ }',
    'try { a(); } catch (e) { flags.push(e.message); }',
    "const s = 'catch {}';",
  ].join('\n');
  assert.deepEqual(bareCatches(src), [1, 2]);
});

test('catch lint: no bare catch beyond the baseline, and the baseline only shrinks', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'catch-lint-baseline.json'), 'utf8')).files;
  const now = {};
  for (const r of scan(benchFiles())) now[r.file] = (now[r.file] || 0) + 1;
  const over = Object.entries(now).filter(([f, n]) => n > (baseline[f] || 0)).map(([f, n]) => `${f}: ${n} bare catch(es), baseline ${baseline[f] || 0}`);
  assert.deepEqual(over, [], 'give each catch a one-line reason or record the error');
  const stale = Object.entries(baseline).filter(([f, n]) => (now[f] || 0) < n).map(([f, n]) => `${f}: baseline ${n}, now ${now[f] || 0}`);
  assert.deepEqual(stale, [], 'lower these counts in catch-lint-baseline.json');
});
