// SPDX-License-Identifier: Apache-2.0
'use strict';

// The trace header names the failed skill calls by tool when the run's result.json recorded them, and says nothing
// otherwise, so the trace of a run without failures or from before the field is unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { buildTrace, renderMarkdown } = require('../lib/trace.js');

const FX = path.join(__dirname, 'fixtures');

function runDir(root, extra) {
  const dir = path.join(root, 'run', 'konductor', 't1', '1');
  write(path.join(dir, 'stream.jsonl'), fs.readFileSync(path.join(FX, 'v3-load-resource-refused.stream.jsonl'), 'utf8'));
  write(path.join(dir, 'result.json'), JSON.stringify({ armId: 'konductor', taskId: 't1', replicate: 1, harness: 'kiro-cli', status: 'success', flags: [], ...extra }));
  return dir;
}

test('the header and the markdown name the failed skill calls by tool, leaving out the tools with none', () => {
  const root = tmp();
  try {
    const t = buildTrace(runDir(root, { skillCallsFailedByTool: { get_skill: 1, load_resource: 1, find_skills: 0 } }));
    assert.deepEqual(t.header.skillCallsFailedByTool, { get_skill: 1, load_resource: 1, find_skills: 0 });
    assert.match(renderMarkdown(t), /^- failed skill calls: get_skill 1, load_resource 1$/m);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('no failures, a null split or a result from before the field leave the header and the markdown as they were', () => {
  const root = tmp();
  try {
    for (const extra of [{ skillCallsFailedByTool: { get_skill: 0, load_resource: 0, find_skills: 0 } }, { skillCallsFailedByTool: null }, {}]) {
      const t = buildTrace(runDir(root, extra));
      assert.equal('skillCallsFailedByTool' in t.header, false, JSON.stringify(extra));
      assert.doesNotMatch(renderMarkdown(t), /failed skill calls/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
