// SPDX-License-Identifier: Apache-2.0
'use strict';

// The real validator script on copies of bench/ that keep only the autonomy tasks (the other classes are slow to
// validate and have their own coverage; each copy keeps one task, as the evidence runs take seconds per task): the shipped
// task raises no error, and breaking the evidence is reported.
// The other suites then disagree with the task set, so only the autonomy lines are read.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BENCH = path.join(__dirname, '..', '..');

function validateCopy(keep, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'val-'));
  fs.cpSync(BENCH, path.join(root, 'bench'), { recursive: true, filter: (p) => path.basename(p) !== 'results' });
  const tasks = path.join(root, 'bench/tasks');
  for (const f of fs.readdirSync(tasks)) if (f.endsWith('.json') && f !== `${keep}.json`) fs.rmSync(path.join(tasks, f));
  const fixtures = path.join(root, 'bench/fixtures');
  for (const f of fs.readdirSync(fixtures)) if (!f.startsWith('auto-')) fs.rmSync(path.join(fixtures, f), { recursive: true, force: true });
  mutate(path.join(root, 'bench'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'bench/tasks/validate-tasks.js')], { cwd: root, env: { PATH: process.env.PATH, HOME: path.join(root, 'home') } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => { fs.rmSync(root, { recursive: true, force: true }); resolve({ code, out }); });
  });
}

test('the validator accepts the shipped autonomy tasks and rejects broken evidence and prompts', async () => {
  const [ok, noWrongGuess, withSentence, oneClarificationDropped] = await Promise.all([
    validateCopy('autonomy-gateway-throttle', () => {}),
    validateCopy('autonomy-format-bytes', (b) => {
      fs.cpSync(path.join(b, 'tasks/solutions/autonomy-format-bytes'), path.join(b, 'tasks/partials/autonomy-format-bytes/two-decimals'), { recursive: true });
    }),
    validateCopy('autonomy-league-table', (b) => {
      const file = path.join(b, 'tasks/autonomy-league-table.json');
      const t = JSON.parse(fs.readFileSync(file, 'utf8'));
      t.prompt += ' Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
      fs.writeFileSync(file, JSON.stringify(t));
    }),
    validateCopy('autonomy-storage-cleanup', (b) => {
      const file = path.join(b, 'tasks/autonomy-storage-cleanup.json');
      const t = JSON.parse(fs.readFileSync(file, 'utf8'));
      t.autonomy.clarifications[1].keywords = ['zzz-never-matches'];
      fs.writeFileSync(file, JSON.stringify(t));
    }),
  ]);
  assert.deepEqual(ok.out.split('\n').filter((l) => /^error: (?!suites\/).*autonomy/.test(l)), []);
  assert.match(ok.out, /autonomy autonomy-gateway-throttle: reference 7\/7 intended \+ 6\/6 invariants/);
  assert.match(noWrongGuess.out, /error: autonomy-format-bytes: partial "two-decimals" passes every intended test/);
  assert.match(withSentence.out, /error: autonomy-league-table\.json: the prompt must not contain the no-questions sentence/);
  assert.match(oneClarificationDropped.out, /error: autonomy-storage-cleanup\.json: clarification "tmp" matches none of the example questions/);
});
