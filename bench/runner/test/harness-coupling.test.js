// SPDX-License-Identifier: Apache-2.0
// FW-18 step 1 (DEBT D-212): a ratchet on how much the bench outside a harness knows about the built-in harnesses,
// so the move of Kiro CLI, opencode and Claude Code into bench/plugins only goes one way.
//   - Private imports: a file outside runner/lib/harness/ and bench/plugins/ that requires a built-in harness's own
//     module (kiro.js, opencode-parse.js, claude-code-parse.js ...). Each one must move behind the harness interface
//     before that harness can move. A new one fails; one the code dropped may stay listed until the baseline is cut.
//   - Runtime names: quoted 'kiro-cli', 'opencode', 'claude-code' or 'strands' in non-test code outside bench/plugins.
//     A file may hold no more than its baseline count, and no new file may hold one. FW-18 is done under 20 in all.
// Baseline: harness-coupling-baseline.json. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..', '..');
const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'harness-coupling-baseline.json'), 'utf8'));
const SKIP_DIRS = new Set(['node_modules', 'test', '.git', 'plugins', 'fixtures', 'tasks', 'scenarios', 'ops']);
// A built-in harness's own module, or any module of a harness that moved to bench/plugins/<name>/ (FW-18): a move
// must not turn a counted import into an uncounted one.
const PRIVATE_RE = /require\(\s*['"]([^'"]*(?:\/harness\/(?:kiro|opencode|claude-code|claude-listing|opencode-[a-z]+|claude-code-[a-z]+)|\/plugins\/[a-z-]+\/[a-z-]+)\.js)['"]\s*\)/g;
const NAME_RE = /'(?:kiro-cli|opencode|claude-code|strands)'/g;

/** Every non-test `.js` file under `root`, as posix paths relative to it. */
function sources(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...sources(root, r));
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(r);
  }
  return out;
}

/** { imports: ["from -> to"], names: {file: count} } for the tree under `root`. */
function couplingOf(root) {
  const imports = new Set();
  const names = {};
  for (const f of sources(root)) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    if (!f.startsWith('runner/lib/harness/')) {
      for (const m of text.matchAll(PRIVATE_RE)) imports.add(`${f} -> ${path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]))}`);
    }
    const n = (text.match(NAME_RE) || []).length;
    if (n) names[f] = n;
  }
  return { imports: [...imports].sort(), names };
}

test('the scan finds a private import and counts runtime names', (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'harness-coupling-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'runner/lib/harness'), { recursive: true });
  fs.mkdirSync(path.join(root, 'judge'));
  fs.mkdirSync(path.join(root, 'plugins/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'judge/a.js'), "require('../runner/lib/harness/claude-code-parse.js'); require('../plugins/x/parse.js'); if (r === 'opencode' || r === 'kiro-cli') {}");
  fs.writeFileSync(path.join(root, 'runner/lib/harness/kiro.js'), "require('./kiro-meta.js'); const id = 'kiro-cli';");
  fs.writeFileSync(path.join(root, 'plugins/x/h.js'), "require('../../runner/lib/harness/kiro.js'); 'strands'");
  assert.deepEqual(couplingOf(root), {
    imports: ['judge/a.js -> plugins/x/parse.js', 'judge/a.js -> runner/lib/harness/claude-code-parse.js'],
    names: { 'judge/a.js': 2, 'runner/lib/harness/kiro.js': 1 },
  });
});

test('no new private import of a built-in harness module', () => {
  const added = couplingOf(BENCH).imports.filter((i) => !BASELINE.imports.includes(i));
  assert.deepEqual(added, [], 'go through harnessFor(...) or the harness interface (runner/lib/harness/CONTRACT.md) instead');
});

test('runtime names: no file over its baseline count, no new file, and the baseline only shrinks', () => {
  const { names } = couplingOf(BENCH);
  const over = Object.entries(names).filter(([f, n]) => n > (BASELINE.names[f] ?? 0)).map(([f, n]) => `${f}: ${n} (baseline ${BASELINE.names[f] ?? 0})`);
  assert.deepEqual(over, [], 'read the name from the harness descriptor (meta) instead of writing it out');
  const total = Object.values(BASELINE.names).reduce((a, b) => a + b, 0);
  assert.ok(total <= BASELINE.createdWithNames, `baseline total ${total} is over its creation total ${BASELINE.createdWithNames}`);
  assert.ok(BASELINE.imports.length <= BASELINE.createdWithImports);
});

test('the sub-agent tool names come from the Claude Code streams, not a core import of its parse.js (B-014 step 3)', () => {
  const { streamsOf, streamsOfFormat } = require('../lib/harness/streams.js');
  const tools = streamsOfFormat('claude-stream-json').subagentTools;
  assert.deepEqual([...tools].sort(), ['Agent', 'Task']);
  assert.equal(streamsOf({ runtime: 'claude-code' }).subagentTools, tools);
  const { imports } = couplingOf(BENCH);
  for (const f of ['report/plant-trace/stream-calls.js', 'runner/lib/introspect/scopes.js', 'runner/lib/trace.js']) {
    assert.ok(!imports.includes(`${f} -> plugins/claude-code/parse.js`), `${f} still imports plugins/claude-code/parse.js`);
  }
});

module.exports = { couplingOf };
