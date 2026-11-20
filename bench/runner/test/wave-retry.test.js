// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/wave-retry.js: the throttled runs of a pilot wave and the ceiling left to rerun them once (D-138).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, mkResult } = require('./helpers.js');
const { throttledRetry } = require('../../scenarios/wave-retry.js');

const CLI = path.join(__dirname, '..', '..', 'scenarios', 'wave-retry.js');
const throttle = { type: 'runError', data: { stage: 'prompt', message: "You're sending requests faster than your rate limit allows. ClientThrottleError" } };

function wave() {
  const dir = tmp();
  const put = (task, result, stream) => {
    const runDir = path.join(dir, 'vanilla', task, '1');
    write(path.join(runDir, 'result.json'), JSON.stringify(mkResult({ harness: 'kiro-cli', taskId: task, replicate: 1, ...result })));
    if (stream) write(path.join(runDir, 'stream.jsonl'), stream.map((e) => JSON.stringify(e)).join('\n'));
  };
  put('t6-ok', { status: 'success', creditsCharged: 5 });
  put('t6-flagged', { status: 'error', flags: ['throttled'], creditsCharged: 3.5 });
  put('t6-old', { status: 'error', creditsCharged: 3.5 }, [throttle]);
  put('t6-crash', { status: 'error', creditsCharged: 2 }, [{ type: 'runError', data: { message: 'agent crashed' } }]);
  put('t6-skip', { status: 'budget_skipped', creditsCharged: 0 });
  return dir;
}

test('only throttled runs are retried; every charged run counts against the ceiling', () => {
  const r = throttledRetry(wave(), 30);
  assert.deepEqual(r.tasks, ['t6-flagged', 't6-old']);
  assert.equal(r.charged, 14);
  assert.equal(r.left, 16);
  assert.equal(throttledRetry(wave(), 10).left, 0);
});

test('the CLI prints the JSON and refuses a missing ceiling with 64', () => {
  const dir = wave();
  const ok = spawnSync(process.execPath, [CLI, dir, '--ceiling', '30'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).tasks, ['t6-flagged', 't6-old']);
  assert.equal(spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' }).status, 64);
});
