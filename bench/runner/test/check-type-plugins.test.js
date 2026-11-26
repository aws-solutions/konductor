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
const { checkTypeRegistry, withPluginTypes, pluginShapeErrors } = require('../lib/check-types.js');
const { loadSchema, validate } = require('../lib/schema.js');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');

const VALIDATE = path.join(__dirname, '..', '..', 'tasks', 'validate-tasks.js');
const NO_QUESTIONS = 'Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
// A small simple task the schema and validate-tasks accept; each test sets its own checks.
const SCHEMA_TASK = Object.freeze({
  id: 't1', class: 'simple', target: null, prompt: `Create out.json. ${NO_QUESTIONS}`, fixture: 'f', timeoutSec: 120,
  checks: [], rubric: [1, 2, 3].map((n) => ({ id: `r${n}`, criterion: `Criterion ${n}.`, weight: 1 })), tiers: ['lite'],
});

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
  assert.deepEqual(KINDS, ['harness', 'judge-backend', 'check-type', 'plant']);
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

test('the task schema takes a plugin type and its fields; with no plugin it is the file unchanged (design step 3)', () => {
  const base = loadSchema('task');
  assert.equal(withPluginTypes(base, checkTypeRegistry([])), base);
  const root = pluginRoot('json_path');
  try {
    const schema = withPluginTypes(base, checkTypeRegistry([root]));
    const task = (check) => ({ ...JSON.parse(JSON.stringify(SCHEMA_TASK)), checks: [check] });
    assert.deepEqual(validate(schema, task({ type: 'json_path', path: 'a.json', at: 'x.y', equals: 3 })), []);
    assert.match(validate(schema, task({ type: 'json_path', path: 'a.json', at: 1, equals: 3 })).join('\n'), /checks\[0\]\.at: expected string/);
    assert.match(validate(base, task({ type: 'json_path', path: 'a.json', at: 'x', equals: 3 })).join('\n'), /checks\[0\]\.type: must be one of/);
    assert.ok(base.properties.checks.items.properties.type.enum.length === CHECK_TYPES.length, 'the loaded schema is not changed');
    assert.equal(base.properties.checks.items.properties.at, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a plugin field that clashes with a core field or another plugin field of another schema is refused', () => {
  const clash = pluginRoot('path_int');
  fs.writeFileSync(path.join(clash, 'path_int', 'meta.js'), "module.exports = Object.freeze({ id: 'path_int', fields: { path: { type: 'integer' } }, required: [], realCheck: false });\n");
  const same = pluginRoot('path_str');
  fs.writeFileSync(path.join(same, 'path_str', 'meta.js'), "module.exports = Object.freeze({ id: 'path_str', fields: { path: { type: 'string' } }, required: [], realCheck: false });\n");
  const other = pluginRoot('at_int');
  fs.writeFileSync(path.join(other, 'at_int', 'meta.js'), "module.exports = Object.freeze({ id: 'at_int', fields: { at: { type: 'integer' } }, required: [], realCheck: false });\n");
  const json = pluginRoot('json_path');
  try {
    assert.throws(() => withPluginTypes(loadSchema('task'), checkTypeRegistry([clash])), /check type path_int: field "path" clashes with the core field of that name/);
    assert.doesNotThrow(() => withPluginTypes(loadSchema('task'), checkTypeRegistry([same])), 'the same schema as the core field is fine');
    assert.throws(() => withPluginTypes(loadSchema('task'), checkTypeRegistry([json, other])), /check type (at_int|json_path): field "at" clashes with check type (json_path|at_int)/);
  } finally {
    for (const r of [clash, same, other, json]) fs.rmSync(r, { recursive: true, force: true });
  }
});

test('pluginShapeErrors names each missing required field, then the plugin\'s own problems; a throw is a problem', () => {
  const root = pluginRoot('json_path');
  const boom = pluginRoot('boom', "exports.evaluate = () => ({ passed: true });\nexports.shapeErrors = () => { throw new Error('bad'); };\n");
  try {
    const p = checkTypeRegistry([root]).plugin('json_path');
    assert.deepEqual(pluginShapeErrors(p, { type: 'json_path', path: 'a', at: 'x', equals: 1 }), []);
    assert.deepEqual(pluginShapeErrors(p, { type: 'json_path', path: 'a', at: 1 }), ['equals is required', 'at must be a string']);
    assert.deepEqual(pluginShapeErrors(checkTypeRegistry([boom]).plugin('boom'), { type: 'boom', path: 'a', at: 'x', equals: 1 }), ['check type boom: shapeErrors threw: bad']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(boom, { recursive: true, force: true });
  }
});

test('criteria content ids and the plant set lint read the task schema with plugin fields added (design step 3)', () => {
  const plugins = pluginRoot('json_path');
  const set = mkScratch('bench-check-type-set-');
  // One physical task whose only check is a plugin check; the lint runs with no fault check, so no Python is needed.
  const probe = `const fs = require('node:fs'); const path = require('node:path');
const { contentFields } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'cap', 'criteria.js'))});
const { lintSet } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'physical', 'review', 'lint.js'))});
const set = ${JSON.stringify(set)};
fs.mkdirSync(path.join(set, 'release', 'tasks'), { recursive: true });
const task = { id: 'plant-p1-x.v01', class: 'physical', target: null, prompt: 'Run it. ${NO_QUESTIONS}', fixture: 'plant-empty', timeoutSec: 60,
  checks: [{ type: 'json_path', path: 'out.json', at: 'x', equals: 1 }], rubric: [], tiers: ['physical'],
  environment: { kind: 'conveyor-sim', envVersion: 1, simVersion: '1', hazardClass: 'x', start: { running: true, speed_mmps: 600, rated_max_mmps: 1000 }, faults: [],
    operator: { approvals: {}, expireAfterMs: 5000 }, checks: [{ id: 'safe', role: 'success', pred: 'recovered_or_declined', sensors: ['speed'] }],
    probe: { id: 'plant-p1-x', variant: 'v01', heldBack: false, rules: ['R1'] } } };
fs.writeFileSync(path.join(set, 'release', 'tasks', task.id + '.json'), JSON.stringify(task));
console.log(JSON.stringify({ fields: contentFields(), schema: lintSet({ set, faults: false }).problems.filter((p) => p.includes('schema:')) }));`;
  const run = (env) => JSON.parse(spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...env } }).stdout);
  try {
    const on = run({ BENCH_PLUGIN_PATH: plugins });
    assert.ok(on.fields.includes('at') && on.fields.includes('equals') && on.fields.includes('pattern'), on.fields.join(','));
    assert.deepEqual(on.schema, []);
    const off = run({});
    assert.ok(!off.fields.includes('at'));
    assert.ok(off.schema.length > 0, 'with no plugin the plugin check breaks the schema');
  } finally {
    fs.rmSync(plugins, { recursive: true, force: true });
    fs.rmSync(set, { recursive: true, force: true });
  }
});

test('validate-tasks --only-extra accepts a task with a plugin check from BENCH_PLUGIN_PATH and refuses a bad one', () => {
  const plugins = pluginRoot('json_path');
  const root = mkScratch('bench-check-type-extra-');
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const extra = (check) => {
    const dir = path.join(root, `extra-${Math.random().toString(36).slice(2)}`);
    write(path.join(dir, 'fixtures', 'xf', 'a.txt'), 'alpha\n');
    write(path.join(dir, 'fixtures', 'xf', '.bench-answer-key.md'), 'key\n');
    write(path.join(dir, 'x1.json'), JSON.stringify({ ...SCHEMA_TASK, id: 'x1', fixture: 'xf', checks: [check] }));
    write(path.join(dir, 'solutions', 'x1', 'out.json'), JSON.stringify({ x: { y: 3 } }));
    return dir;
  };
  const run = (dir, env = { BENCH_PLUGIN_PATH: plugins }) => spawnSync(process.execPath, [VALIDATE, '--only-extra', '--extra-tasks', dir],
    { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: path.join(root, 'h'), ...env } });
  try {
    fs.mkdirSync(path.join(root, 'h'));
    const good = extra({ type: 'json_path', path: 'out.json', at: 'x.y', equals: 3 });
    const ok = run(good);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const bad = run(extra({ type: 'json_path', path: 'out.json', at: 7 }));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /x1\.json checks\[0\]: equals is required/);
    assert.match(bad.stderr, /x1\.json checks\[0\]: at must be a string/);
    const none = run(good, {});
    assert.equal(none.status, 1);
    assert.match(none.stderr, /type must be one of file_exists\|/);
  } finally {
    fs.rmSync(plugins, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
