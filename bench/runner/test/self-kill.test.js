// SPDX-License-Identifier: Apache-2.0
'use strict';

// DEBT D-243: an agent that kills its own kiro-cli (an interrupted `pkill -f "node -"`, then a SIGTERM exit) made an
// errored run that the runner read as an infrastructure failure (exit 5), which stopped a study. The live runner now
// flags such a run `agentSelfKill` and keeps it out of the infra check.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isSelfKill, markSelfKill, SELF_KILL_FLAG } = require('../lib/self-kill.js');
const { infraFailure } = require('../lib/infra-check.js');

const update = (command, status, text) => JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status, rawInput: { command }, content: [{ type: 'content', content: { type: 'text', text } }] } } });
const CUT = 'This tool was interrupted before it reported a result, so it may or may not have taken effect.';
const SIGTERM = 'kas exit code=143 reason=SIGTERM during signal shutdown\n';

function runDir(root, name, stream, stderr) {
  const d = path.join(root, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'stream.jsonl'), `${stream}\n`);
  fs.writeFileSync(path.join(d, 'stderr.txt'), stderr);
  return d;
}

test('isSelfKill: an errored run whose last interrupted shell call is a kill and that exited on SIGTERM', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kbench-selfkill-'));
  try {
    assert.equal(isSelfKill(runDir(root, 'a', update('pkill -f "node -" ; timeout 5 node -', 'failed', CUT), SIGTERM), 'error'), true);
    assert.equal(isSelfKill(runDir(root, 'b', update('npm test', 'failed', CUT), SIGTERM), 'error'), false, 'kills nothing');
    assert.equal(isSelfKill(runDir(root, 'c', update('pkill -f "node -"', 'failed', CUT), 'timeout\n'), 'error'), false, 'no SIGTERM');
    assert.equal(isSelfKill(runDir(root, 'd', update('pkill -f "node -"', 'completed', 'ok'), ''), 'success'), false, 'finished');
    assert.equal(isSelfKill(path.join(root, 'missing'), 'error'), false, 'no run files');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('markSelfKill flags the result, and the infra check does not count a self-killed run as an infra failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kbench-selfkill-'));
  try {
    const dir = runDir(root, 'a', update('pkill -f "node -"', 'failed', CUT), SIGTERM);
    const r = { status: 'error', flags: [], wallClockMs: 200000 };
    markSelfKill(r, dir);
    assert.equal(r.agentSelfKill, true);
    assert.deepEqual(r.flags, [SELF_KILL_FLAG]);
    const plain = { status: 'error', flags: [], wallClockMs: 5 };
    markSelfKill(plain, path.join(root, 'none'));
    assert.equal(plain.agentSelfKill, undefined);
    // Every run errored, but one was the agent's own kill: the study ran, so it is not an infra failure.
    assert.equal(infraFailure([r, { status: 'error' }]), null);
    assert.ok(infraFailure([{ status: 'error' }, { status: 'error' }]), 'plain errors still are');
    // The flagged result still validates against result.schema.json.
    const { errorResult, validateResult } = require('../lib/result.js');
    const full = errorResult({ arm: { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, armKind: 'none', agent: null, vanilla: true }, task: { id: 't1', class: 'simple', checks: [], rubric: [] }, replicate: 1, config: { model: 'm', effort: 'high' }, env: {}, message: 'SIGTERM', meta: { isolation: 'none' } });
    markSelfKill(full, dir);
    assert.equal(full.agentSelfKill, true);
    assert.deepEqual(validateResult(full), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
