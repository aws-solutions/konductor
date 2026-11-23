// SPDX-License-Identifier: Apache-2.0
// Import layers (FW-10, DEBT D-204). Two rules on every non-test source file:
//   - a file in bench/core/ requires only Node built-ins and other bench/core/ files;
//   - a file in bench/runner/ requires nothing from bench/report/ or bench/cap/.
// Today's wrong-way imports sit in import-layers-baseline.json. A new one fails, and so does a baseline entry the code
// no longer has, so the baseline can only shrink. No model call, no run.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const BENCH = path.join(__dirname, '..', '..');
const BASELINE_FILE = path.join(__dirname, 'import-layers-baseline.json');
const SKIP_DIRS = new Set(['node_modules', 'test', '.git']);
const REQUIRE_RE = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;

/** Every `.js` file under `dir` (relative to `root`), skipping test folders and installed packages. */
function sourceFiles(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(root, rel));
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(rel);
  }
  return out;
}

/**
 * The wrong-way imports of one file, as "from -> to" strings (paths relative to `root`).
 * `text` is the file's source; a require of a package or a non-relative name counts as outside core.
 */
function violationsOf(from, text) {
  const layer = from.split('/')[0];
  const found = [];
  for (const m of text.matchAll(REQUIRE_RE)) {
    const spec = m[2];
    const relative = spec.startsWith('.');
    if (!relative) {
      const builtin = spec.startsWith('node:') || builtinModules.includes(spec);
      if (layer === 'core' && !builtin) found.push(`${from} -> ${spec}`);
      continue;
    }
    const to = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    const toLayer = to.split('/')[0];
    if (layer === 'core' && toLayer !== 'core') found.push(`${from} -> ${to}`);
    if (layer === 'runner' && (toLayer === 'report' || toLayer === 'cap')) found.push(`${from} -> ${to}`);
  }
  return found;
}

/** All wrong-way imports under `root`'s core/ and runner/ folders, sorted and unique. */
function violationsUnder(root) {
  const files = [...sourceFiles(root, 'core'), ...sourceFiles(root, 'runner')];
  const all = files.flatMap((f) => violationsOf(f, fs.readFileSync(path.join(root, f), 'utf8')));
  return [...new Set(all)].sort();
}

test('the rules: core may use built-ins and core only; runner may not reach report or cap', () => {
  assert.deepEqual(violationsOf('core/a.js', "require('node:fs'); require('path'); require('./b.js');"), []);
  assert.deepEqual(violationsOf('core/a.js', "require('../runner/lib/x.js')"), ['core/a.js -> runner/lib/x.js']);
  assert.deepEqual(violationsOf('core/a.js', "require('left-pad')"), ['core/a.js -> left-pad']);
  assert.deepEqual(violationsOf('runner/lib/a.js', "require('../../core/load-run.js'); require('../../judge/x.js')"), []);
  assert.deepEqual(violationsOf('runner/lib/a.js', "const { f } = require('../../report/load.js');"), ['runner/lib/a.js -> report/load.js']);
  assert.deepEqual(violationsOf('runner/bench.js', "  return require('../cap/cli.js').cmdCap(o);"), ['runner/bench.js -> cap/cli.js']);
});

test('a fixture tree: a new wrong-way import is found, test files are not read', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'import-layers-'));
  try {
    fs.mkdirSync(path.join(root, 'core'));
    fs.mkdirSync(path.join(root, 'runner', 'test'), { recursive: true });
    fs.writeFileSync(path.join(root, 'core', 'a.js'), "require('../report/x.js');");
    fs.writeFileSync(path.join(root, 'runner', 'b.js'), "require('../cap/y.js');");
    fs.writeFileSync(path.join(root, 'runner', 'test', 'c.js'), "require('../../cap/z.js');");
    assert.deepEqual(violationsUnder(root), ['core/a.js -> report/x.js', 'runner/b.js -> cap/y.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the bench has no wrong-way import beyond the baseline, and the baseline holds none the code dropped', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const now = violationsUnder(BENCH);
  const added = now.filter((v) => !baseline.imports.includes(v));
  const stale = baseline.imports.filter((v) => !now.includes(v));
  assert.deepEqual(added, [], 'new wrong-way imports: move the code down a layer instead of adding to the baseline');
  assert.deepEqual(stale, [], 'baseline entries the code no longer has: delete them from import-layers-baseline.json');
  assert.ok(baseline.imports.length <= baseline.createdWith, `the baseline only shrinks (created with ${baseline.createdWith})`);
});

module.exports = { violationsOf, violationsUnder };
