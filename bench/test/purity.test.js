// SPDX-License-Identifier: Apache-2.0
/**
 * Purity guard for the task validation layer
 *
 * The modules listed in PURE_MODULES promise to do no I/O: no file reads, no child processes and
 * no network access. This test enforces the promise on their source text. A pure module may
 * require only sibling modules in bench/lib, and may not use the globals that reach the network
 * or evaluate code. Comments are stripped first, so prose that mentions those things is fine.
 *
 * Run: node --test bench/test/purity.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LIB_DIR = path.join(__dirname, '..', 'lib');

// snapshot-loader.js is deliberately absent: it is the one module that reads the filesystem.
// C: pattern-syntax.js joined the list; it was a pure module that the guard never read.
// I-D: text-fold.js joined the list; the fold task-schema.js and negatives.js share is pure.
// hidden-fields.js lists the fields a subject must not see; it holds no code beyond that list.
const PURE_MODULES = ['safe-path.js', 'task-schema.js', 'checks.js', 'pattern-syntax.js', 'task-lint.js', 'hidden-fields.js', 'negatives.js', 'text-fold.js', 'arms.js', 'sanitize.js'];

// Node built-ins a pure module may require besides its siblings, listed per module. Hashing is
// computation with no I/O, so node:crypto is granted to the modules that fingerprint content.
// I-1: node:vm is granted to checks.js alone, for the timeout it puts on every pattern execution.
// It is the one grant that touches code evaluation, so a separate test below pins how it is used.
const ALLOWED_BUILTINS = { 'arms.js': ['node:crypto'], 'sanitize.js': ['node:crypto'], 'checks.js': ['node:vm'] };
const FORBIDDEN_USES = [
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'dynamic import', pattern: /\bimport\s*\(/ },
  { name: 'process access', pattern: /\bprocess\s*\./ },
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function requiredSpecifiers(code) {
  return [...code.matchAll(/\brequire\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g)].map((match) => match[2]);
}

for (const name of PURE_MODULES) {
  const code = stripComments(fs.readFileSync(path.join(LIB_DIR, name), 'utf8'));

  test(`${name} requires only sibling modules`, () => {
    for (const specifier of requiredSpecifiers(code)) {
      if ((ALLOWED_BUILTINS[name] || []).includes(specifier)) continue;
      assert.match(specifier, /^\.\/[a-z-]+$/, `${name} requires "${specifier}"`);
      assert.ok(fs.existsSync(path.join(LIB_DIR, `${specifier.slice(2)}.js`)), `${specifier} is not a module in bench/lib`);
    }
  });

  test(`${name} uses no network, code evaluation or process access`, () => {
    for (const { name: use, pattern } of FORBIDDEN_USES) {
      assert.doesNotMatch(code, pattern, `${name} uses ${use}`);
    }
  });
}

test('the guard notices a forbidden require and a forbidden global', () => {
  assert.deepEqual(requiredSpecifiers("const a = require('node:fs'); const b = require('./x');"), ['node:fs', './x']);
  assert.match(stripComments('// fetch(url)\nconst a = 1;'), /^\s*const a = 1;$/);
  assert.match('await fetch(url)', FORBIDDEN_USES[0].pattern);
  assert.match('process.exit(1)', FORBIDDEN_USES[6].pattern);
});

test('I-1: checks.js uses node:vm only to run fixed script text under a timeout', () => {
  const code = stripComments(fs.readFileSync(path.join(LIB_DIR, 'checks.js'), 'utf8'));
  // Only the Script constructor and createContext are used: no runInNewContext, runInThisContext
  // or compileFunction, which take source as an argument at the call site.
  const members = [...new Set([...code.matchAll(/\bvm\.(\w+)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(members, ['Script', 'createContext']);
  // Every Script is built from a single-quoted literal with no interpolation, never from a variable.
  const constructions = [...code.matchAll(/new vm\.Script\(/g)];
  const literals = [...code.matchAll(/new vm\.Script\('[^'\\$]*'\)/g)];
  assert.ok(constructions.length >= 1, 'checks.js builds no script');
  assert.equal(literals.length, constructions.length, 'a vm.Script is built from something other than a fixed literal');
  // Every run is bounded by a timeout.
  const runs = [...code.matchAll(/\.runInContext\(([^)]*)\)/g)];
  assert.ok(runs.length >= 1, 'checks.js runs no script');
  for (const [, args] of runs) assert.match(args, /\btimeout\s*:/, `an unbounded run: runInContext(${args})`);
});

test('a Node built-in is granted only to a listed pure module, and only node:crypto or, for checks.js, node:vm', () => {
  for (const [name, specifiers] of Object.entries(ALLOWED_BUILTINS)) {
    assert.ok(PURE_MODULES.includes(name), `${name} is not a pure module`);
    assert.deepEqual(specifiers, name === 'checks.js' ? ['node:vm'] : ['node:crypto'], `${name} is granted the wrong built-ins`);
  }
  for (const name of PURE_MODULES.filter((n) => !(n in ALLOWED_BUILTINS))) {
    const code = stripComments(fs.readFileSync(path.join(LIB_DIR, name), 'utf8'));
    assert.deepEqual(requiredSpecifiers(code).filter((s) => !s.startsWith('./')), [], name);
  }
});
