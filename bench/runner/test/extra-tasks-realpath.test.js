// SPDX-License-Identifier: Apache-2.0
'use strict';

// --extra-tasks directories are resolved through symlinks before they are loaded or masked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { realDir, loadTasks, benchMask, mergeExtraDirs } = require('../lib/tasks.js');

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const real = path.join(root, 'real-extra');
  const link = path.join(root, 'link-extra');
  const task = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(real, 'x1.json'), JSON.stringify({ ...task, id: 'x1' }));
  fs.symlinkSync(real, link);
  return { root, bench, real: fs.realpathSync(real), link };
}

test('realDir follows a symlink and leaves a missing path resolved but unlinked', () => {
  const { root, real, link } = setup();
  assert.equal(realDir(link), real);
  const missing = path.join(root, 'nope');
  assert.equal(realDir(missing), path.resolve(missing));
});

test('loadTasks records the real path of a symlinked extra directory', () => {
  const { bench, real, link } = setup();
  const tasks = loadTasks(bench, { extraDirs: [link] });
  assert.equal(tasks.get('x1').extraDir, real);
});

test('the isolation mask and the merged extra dirs use the real path', () => {
  const { bench, real, link } = setup();
  assert.ok(benchMask(bench, [link]).includes(real));
  assert.ok(!benchMask(bench, [link]).includes(link));
  assert.deepEqual(mergeExtraDirs([], [link, real]), [real]);
});
