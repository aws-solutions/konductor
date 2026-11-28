// SPDX-License-Identifier: Apache-2.0
'use strict';

// The reply-check CLI shape (D-301): a repeated flag is a usage error, and the modules load at the top, with no
// require loop between reply-check.js and reply-review.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DIR = path.join(__dirname, '..', '..', 'ops', 'prompt-fixes');
const CLI = path.join(DIR, 'reply-check.js');

test('reply-check: a repeated flag is refused as a usage error (exit 64), not silently overwritten', () => {
  const r = spawnSync(process.execPath, [CLI, 'plan', '--tasks', 'smoke', '--reps', '1', '--reps', '2', '--run-limit', '6'], { encoding: 'utf8' });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /--reps is given twice/);
  assert.equal(r.stdout, '');
});

test('reply-check: every require is at the top level, and reply-review.js does not require reply-check.js', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const main = src.slice(src.indexOf('function main('));
  assert.ok(main.length < src.length, 'main is defined');
  assert.doesNotMatch(main, /require\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(DIR, 'reply-review.js'), 'utf8'), /require\('\.\/reply-check\.js'\)/);
});
