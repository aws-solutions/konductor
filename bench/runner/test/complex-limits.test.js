// SPDX-License-Identifier: Apache-2.0
'use strict';

// Size limits of a complex task in the validator: a timeout up to 3600 s and a fixture of up to 40 files.
// The task below is otherwise incomplete; the tests read only the lines about these two limits. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');

const VALIDATE = path.join(__dirname, '..', '..', 'tasks', 'validate-tasks.js');
const NO_QUESTIONS = 'Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
const RUBRIC = [1, 2, 3].map((n) => ({ id: `c${n}`, criterion: `Does thing ${n}.`, weight: 1 }));

/** Validate a complex task `cx-big` with `files` fixture files and `timeoutSec`; returns the validator's stderr. */
function stderrFor({ files, timeoutSec }) {
  const root = tmp();
  try {
    const dir = path.join(root, 'pack');
    for (let i = 0; i < files; i++) write(path.join(dir, 'fixtures', 'bigfx', `f${i}.txt`), `file ${i}\n`);
    write(path.join(dir, 'fixtures', 'bigfx', '.bench-answer-key.md'), 'key\n');
    write(path.join(dir, 'hidden', 'cx-big', 'hidden', 'a.test.js'), '// none\n');
    write(path.join(dir, 'cx-big.json'), JSON.stringify({
      id: 'cx-big', class: 'complex', target: null, prompt: `Do the work. ${NO_QUESTIONS}`, fixture: 'bigfx', hidden: 'cx-big', timeoutSec,
      checks: [{ type: 'tests', cmd: 'node --test hidden/*.test.js', min: 1 }, { type: 'fixture_unchanged', path: 'f0.txt' }], rubric: RUBRIC, tiers: ['full'],
    }));
    fs.mkdirSync(path.join(root, 'h'), { recursive: true });
    const r = spawnSync(process.execPath, [VALIDATE, '--only-extra', '--extra-tasks', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: path.join(root, 'h') } });
    return r.stderr;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('a complex task may run for 3600 s and not for longer', () => {
  assert.doesNotMatch(stderrFor({ files: 3, timeoutSec: 3600 }), /complex tasks need timeoutSec/);
  assert.match(stderrFor({ files: 3, timeoutSec: 3601 }), /complex tasks need timeoutSec from 900 to 3600/);
});

test('a complex fixture may hold 40 files and not more; other fixtures keep the limit of 15', () => {
  assert.doesNotMatch(stderrFor({ files: 40, timeoutSec: 1800 }), /files, limit/);
  assert.match(stderrFor({ files: 41, timeoutSec: 1800 }), /fixture bigfx: 41 files, limit 40/);
});
