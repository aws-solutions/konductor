// SPDX-License-Identifier: Apache-2.0
'use strict';

// Check types as registry parts of kind `check-type` (check-type plugin design, step 2): a plugin folder adds a type
// with no core edit; evalCheck scores it after the core's path rules; core names are taken.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { KINDS } = require('../../core/registry.js');
const { CHECK_TYPES, evalCheck } = require('../lib/check-matcher.js');
const { checkTypeRegistry } = require('../lib/check-types.js');
const { mkScratch } = require('./scratch.js');

const JSON_PATH_ENTRY = `'use strict';
const fs = require('node:fs');
exports.evaluate = (file, check) => {
  let v;
  try { v = check.at.split('.').reduce((o, k) => o?.[k], JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return { passed: false, detail: 'not JSON' }; }
  return { passed: v === check.equals, detail: \`\${check.at} is \${JSON.stringify(v)}\` };
};
exports.shapeErrors = (check) => (typeof check.at === 'string' ? [] : ['at must be a string']);
`;

/** A plugin root holding one check-type plugin `name` with the entry source `entry`. */
function pluginRoot(name, entry = JSON_PATH_ENTRY) {
  const root = mkScratch('bench-check-type-root-');
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ benchApi: 1, kind: 'check-type', name, version: '0.1.0', meta: 'meta.js', entry: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'meta.js'), `module.exports = Object.freeze({ id: ${JSON.stringify(name)}, fields: { at: { type: 'string' }, equals: {} }, required: ['at', 'equals'], realCheck: false });\n`);
  fs.writeFileSync(path.join(dir, 'index.js'), entry);
  return root;
}

test('check-type is a registry kind, and with no plugin the list is the eight built-ins', () => {
  assert.deepEqual(KINDS, ['harness', 'judge-backend', 'check-type']);
  const reg = checkTypeRegistry([]);
  assert.deepEqual(reg.ids(), CHECK_TYPES);
  assert.deepEqual(reg.record(), []);
  for (const id of CHECK_TYPES) assert.equal(reg.plugin(id), undefined);
  assert.deepEqual(checkTypeRegistry().ids(), CHECK_TYPES, 'bench/plugins holds no check-type plugin');
});

test('a check-type plugin in a scratch root adds a type evalCheck scores, with no core edit', () => {
  const root = pluginRoot('json_path');
  const dir = mkScratch('bench-check-type-ws-');
  try {
    const reg = checkTypeRegistry([root]);
    assert.deepEqual(reg.ids(), [...CHECK_TYPES, 'json_path']);
    assert.equal(reg.record()[0].name, 'json_path');
    assert.equal(reg.plugin('json_path').meta.realCheck, false);
    assert.deepEqual(reg.plugin('json_path').shapeErrors({ at: 1 }), ['at must be a string']);
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ x: { y: 3 } }));
    fs.symlinkSync(path.join(dir, 'a.json'), path.join(dir, 'link.json'));
    const opts = { checkTypes: reg };
    const check = (over) => ({ type: 'json_path', path: 'a.json', at: 'x.y', equals: 3, ...over });
    assert.deepEqual(evalCheck(dir, check({}), opts), { passed: true, detail: 'x.y is 3' });
    assert.deepEqual(evalCheck(dir, check({ equals: 4 }), opts), { passed: false, detail: 'x.y is 3' });
    assert.deepEqual(evalCheck(dir, check({ path: 'link.json' }), opts), { passed: false, detail: 'path is a symlink: link.json' });
    assert.throws(() => evalCheck(dir, check({ path: '../a.json' }), opts), /path escapes workspace/);
    assert.deepEqual(evalCheck(dir, check({}), { checkTypes: checkTypeRegistry([]) }), { passed: false, detail: 'unknown check type json_path' });
    assert.deepEqual(evalCheck(dir, check({})), { passed: false, detail: 'unknown check type json_path' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a plugin cannot take a built-in name, core ones included', () => {
  for (const name of ['cmd', 'tests', 'fixture_unchanged', 'contains']) {
    const root = pluginRoot(name);
    try {
      assert.throws(() => checkTypeRegistry([root]), new RegExp(`two check-type parts are named "${name}"`));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a plugin entry without evaluate or shapeErrors is refused', () => {
  const root = pluginRoot('half', "exports.evaluate = () => ({ passed: true, detail: '' });\n");
  try {
    assert.throws(() => checkTypeRegistry([root]), /check type half: its entry module exports no shapeErrors function/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a plugin evaluate that throws or returns a non-boolean fails the check', () => {
  const root = pluginRoot('odd', "exports.evaluate = (file, check) => { if (check.boom) throw new Error('bad'); return { passed: 'yes' }; };\nexports.shapeErrors = () => [];\n");
  const dir = mkScratch('bench-check-type-ws-');
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const opts = { checkTypes: checkTypeRegistry([root]) };
    assert.deepEqual(evalCheck(dir, { type: 'odd', path: 'a.txt', boom: true }, opts), { passed: false, detail: 'check type odd threw: bad' });
    assert.deepEqual(evalCheck(dir, { type: 'odd', path: 'a.txt' }, opts), { passed: false, detail: '' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
