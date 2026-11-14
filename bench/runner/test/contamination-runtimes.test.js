// SPDX-License-Identifier: Apache-2.0
'use strict';

// The external-fetch audit reads only the kiro-cli stream. For opencode and Claude Code runs it must say so
// ("not checked for this runtime") and never count the run as clean.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canAuditFetches, fetchUnchecked, externalFetchCell, contaminationFlags } = require('../lib/contamination.js');
const { auditContamination } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { makeRealBench, tmp } = require('./real-helpers.js');
const { makeBench, makeRun, mkResult } = require('./helpers.js');
const { loadRun } = require('../../report/load.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { validate, loadSchema } = require('../lib/schema.js');

const FETCH_EVENT = JSON.stringify({
  type: 'sessionUpdate',
  data: { update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'x', rawInput: { command: 'git clone https://github.com/example/demo /tmp/x' }, _meta: { kiro: { toolName: 'shell' } } } },
});

test('only kiro-cli streams can be audited for fetches', () => {
  assert.equal(canAuditFetches('kiro-cli'), true);
  assert.equal(canAuditFetches('opencode'), false);
  assert.equal(canAuditFetches('claude-code'), false);
  assert.equal(canAuditFetches('some-new-runtime'), false);
});

test('helpers: unchecked is read from the record, null counts as no flag, the cell names unchecked runs', () => {
  assert.equal(fetchUnchecked({ externalFetch: null, externalFetchChecked: false }), true);
  assert.equal(fetchUnchecked({ externalFetch: [], externalFetchChecked: true }), false);
  assert.equal(fetchUnchecked({ externalFetch: [] }), false);
  assert.equal(fetchUnchecked(null), false);
  assert.deepEqual(contaminationFlags({ externalFetch: null, fixRecallChars: 0 }), []);
  assert.deepEqual(contaminationFlags({ externalFetch: null, fixRecallChars: 90 }), ['fixRecall']);
  assert.equal(externalFetchCell({ hits: 2, audited: 4, unchecked: 0 }), 2);
  assert.equal(externalFetchCell({ hits: 0, audited: 4, unchecked: 4 }), 'not checked for this runtime');
  assert.equal(externalFetchCell({ hits: 1, audited: 4, unchecked: 3 }), '1 (3 of 4 not checked for this runtime)');
});

function audit(runtime) {
  const b = makeRealBench({ useEnv: true });
  const root = tmp('cr-');
  try {
    const outDir = path.join(root, 'out');
    const cwd = path.join(root, 'cwd');
    fs.mkdirSync(outDir); fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(outDir, 'stream.jsonl'), `${FETCH_EVENT}\n`);
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    const arm = { id: 'x', runtime, harness: runtime === 'kiro-cli' ? 'kiro-cli-v2' : runtime };
    return auditContamination({ task, arm, ctx: { realCache: b.cache }, outDir, cwd });
  } finally {
    b.done();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('a kiro stream with a fetch is flagged and recorded as checked', () => {
  const { record, flags } = audit('kiro-cli');
  assert.equal(record.externalFetchChecked, true);
  assert.equal(record.externalFetch.length, 1);
  assert.match(record.externalFetch[0], /^shell: git clone /);
  assert.deepEqual(flags, ['externalFetch']);
});

test('opencode and Claude Code runs are recorded as unchecked, with no fetch verdict and no flag', () => {
  for (const runtime of ['opencode', 'claude-code']) {
    const { record, flags } = audit(runtime);
    assert.equal(record.externalFetch, null, runtime);
    assert.equal(record.externalFetchChecked, false, runtime);
    assert.deepEqual(flags, [], runtime);
    assert.equal(typeof record.fixRecallChars, 'number', `${runtime} still gets the fix recall audit`);
  }
});

test('the result schema accepts the unchecked record and the checked one', () => {
  const schema = loadSchema('result');
  const base = { ...mkResult({ harness: 'opencode' }) };
  assert.deepEqual(validate(schema, { ...base, contamination: { externalFetch: null, externalFetchChecked: false, fixRecallChars: 0 } }), []);
  assert.deepEqual(validate(schema, { ...base, contamination: { externalFetch: [], externalFetchChecked: true, fixRecallChars: 0 } }), []);
  assert.notDeepEqual(validate(schema, { ...base, contamination: { externalFetch: 'no', fixRecallChars: 0 } }), []);
});

const audited = (externalFetch, checked, extra = {}) => ({ contamination: { externalFetch, externalFetchChecked: checked, fixRecallChars: 0 }, flags: [], ...extra });

function reportFor(specs) {
  const root = tmp('cr-rep-');
  const bench = makeBench(path.join(root, 'bench'), { cls: 'real' });
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  const out = buildReport({ run: loadRun(runDir), tasks: loadTasks(bench) });
  return { ...out, markdown: renderMarkdown(out.report), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the report counts unchecked runs apart, says so in the table and does not call them clean', () => {
  const r = reportFor([
    { arm: 'oc', rep: 1, ...audited(null, false) },
    { arm: 'oc', rep: 2, ...audited(null, false) },
    { arm: 'kiro', rep: 1, ...audited([], true) },
    { arm: 'kiro', rep: 2, ...audited(['shell: curl https://example.org/x'], true) },
  ]);
  try {
    const oc = r.report.arms.oc.real.contamination;
    assert.equal(oc.audited, 2);
    assert.equal(oc.externalFetchUnchecked, 2);
    assert.equal(oc.externalFetch, 0);
    const kiro = r.report.arms.kiro.real.contamination;
    assert.equal(kiro.externalFetchUnchecked, 0);
    assert.equal(kiro.externalFetch, 1);
    assert.match(r.markdown, /\| oc \| 2 \| not checked for this runtime \|/);
    assert.match(r.markdown, /\| kiro \| 2 \| 1 \|/);
  } finally { r.cleanup(); }
});
