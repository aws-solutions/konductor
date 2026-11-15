// SPDX-License-Identifier: Apache-2.0
'use strict';

// A scrub failure is classed by its cause: tamper causes count as failures in a stamped rubric mean, the rest are gaps.
// Every secret is a made-up value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { buildStudy, renderAll, LINKED, DEFAULT_RUNS, DEFAULT_NOT_JUDGED } = require('./rubric-policy-fixture.js');
const { scrubTreeDetailed, scrubCauseOf, SCRUB_CAUSES } = require('../lib/hygiene.js');
const { SCRUB_CAUSE_CLASS, EXCLUSION_CLASS, scrubCausesOf, exclusionClassOfRun, exclusionClassOfReason, reasonLabel } = require('../../judge/exclusion.js');
const { notJudgedReason } = require('../../judge/run.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

const KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const STAMP = 'excluded-as-failures';
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const isRoot = process.getuid?.() === 0;
const err = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

test('scrubCauseOf names the cause class of an error', () => {
  for (const code of ['ELOOP', 'ENXIO', 'EISDIR', 'ENOTDIR', 'ENODEV']) assert.equal(scrubCauseOf(err(code)), 'link', code);
  assert.equal(scrubCauseOf(err('EACCES', { scrubPhase: 'read' })), 'unreadable');
  assert.equal(scrubCauseOf(err('EPERM')), 'unreadable');
  assert.equal(scrubCauseOf(err('EACCES', { scrubPhase: 'write' })), 'unwritable');
  assert.equal(scrubCauseOf(err('EROFS', { scrubPhase: 'write' })), 'unwritable');
  assert.equal(scrubCauseOf(err('EIO')), 'error');
  assert.equal(scrubCauseOf(new Error('anything')), 'error');
  assert.equal(scrubCauseOf(Object.assign(new Error('x'), { scrubCause: 'too-large' })), 'too-large');
  assert.deepEqual(SCRUB_CAUSES, Object.keys(SCRUB_CAUSE_CLASS));
});

test('a file that was read but cannot be rewritten is unwritable', { skip: isRoot && 'root can write any file' }, () => {
  const dir = tmp();
  const file = path.join(dir, 'ro.txt');
  fs.writeFileSync(file, `key ${KEY}\n`);
  fs.chmodSync(file, 0o444);
  const r = scrubTreeDetailed(dir, [], { shapes: true });
  fs.chmodSync(file, 0o600);
  assert.deepEqual(r.unscrubbed.map((u) => [path.basename(u.file), u.reason]), [['ro.txt', 'unwritable']]);
  assert.match(r.unscrubbed[0].detail, /EACCES/);
});

function withReadFailures(failures, fn) {
  const real = fs.readFileSync;
  let calls = 0;
  fs.readFileSync = function patched(file, ...rest) {
    if (String(file).endsWith('flaky.txt')) { calls++; if (calls <= failures.length) throw err(failures[calls - 1]); }
    return real.call(this, file, ...rest);
  };
  try { return fn(() => calls); } finally { fs.readFileSync = real; }
}

test('a transient read error is retried once and the file is scrubbed', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'flaky.txt'), `key ${KEY}\n`);
  const r = withReadFailures(['EIO'], () => scrubTreeDetailed(dir, [], { shapes: true }));
  assert.deepEqual(r.unscrubbed, []);
  assert.equal(r.scrubbed, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'flaky.txt'), 'utf8'), 'key <redacted>\n');
});

test('a read error that persists after one retry is reported as error, not retried again', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'flaky.txt'), `key ${KEY}\n`);
  const [r, calls] = withReadFailures(['EIO', 'EIO', 'EIO'], (n) => [scrubTreeDetailed(dir, [], { shapes: true }), n]);
  assert.deepEqual(r.unscrubbed.map((u) => [u.reason, u.detail]), [['error', 'EIO']]);
  assert.equal(calls(), 2);
});

test('a refused read is not retried and counts as unreadable', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'flaky.txt'), `key ${KEY}\n`);
  const [r, calls] = withReadFailures(['EACCES', 'EACCES'], (n) => [scrubTreeDetailed(dir, [], { shapes: true }), n]);
  assert.deepEqual(r.unscrubbed.map((u) => u.reason), ['unreadable']);
  assert.equal(calls(), 1);
});

test('each scrub cause maps to the class the table says, and the table is the only place that says it', () => {
  assert.deepEqual(SCRUB_CAUSE_CLASS, { link: 'integrity', unreadable: 'integrity', unwritable: 'gap', 'too-large': 'gap', error: 'gap' });
  assert.equal(EXCLUSION_CLASS.credsUnscrubbed, 'by-cause');
  for (const [cause, cls] of Object.entries(SCRUB_CAUSE_CLASS)) {
    const result = { flags: ['credsUnscrubbed'], unscrubbedFiles: [{ file: 'x', reason: cause }] };
    assert.equal(exclusionClassOfRun('credsUnscrubbed', result), cls, cause);
  }
});

test('a run with several scrub failures is an integrity run when any cause is a tamper cause', () => {
  const mixed = { unscrubbedFiles: [{ reason: 'unwritable' }, { reason: 'error' }, { reason: 'link' }] };
  assert.equal(exclusionClassOfRun('credsUnscrubbed', mixed), 'integrity');
  assert.deepEqual(scrubCausesOf(mixed), ['error', 'link', 'unwritable']);
  assert.equal(exclusionClassOfRun('credsUnscrubbed', { unscrubbedFiles: [{ reason: 'unwritable' }, { reason: 'too-large' }] }), 'gap');
});

test('an unknown cause is a gap: no entries, free-text reasons from older runs, a missing result', () => {
  assert.equal(exclusionClassOfRun('credsUnscrubbed', { flags: ['credsUnscrubbed'] }), 'gap');
  assert.equal(exclusionClassOfRun('credsUnscrubbed', { unscrubbedFiles: [{ file: 'x', reason: 'EACCES' }] }), 'gap');
  assert.equal(exclusionClassOfRun('credsUnscrubbed', { unscrubbedFiles: [{ file: 'x', reason: 'constructor' }] }), 'gap');
  assert.equal(exclusionClassOfReason('credsUnscrubbed'), 'gap');
  assert.deepEqual(scrubCausesOf(undefined), ['error']);
});

test('a benign scrub cause on a run that also tampered with stdio or the usage database stays an integrity run', () => {
  for (const flag of ['stdioTampered', 'usageDbTampered']) {
    assert.equal(exclusionClassOfRun('credsUnscrubbed', { flags: ['credsUnscrubbed', flag], unscrubbedFiles: [{ reason: 'unwritable' }] }), 'integrity', flag);
  }
});

test('reasons other than credsUnscrubbed keep their class whatever the result says', () => {
  const r = { unscrubbedFiles: [{ reason: 'link' }] };
  assert.equal(exclusionClassOfRun('infraError', r), 'gap');
  assert.equal(exclusionClassOfRun('no workspace', r), 'gap');
  assert.equal(exclusionClassOfRun('stdioTampered', r), 'integrity');
  assert.equal(exclusionClassOfRun('usageDbTampered', {}), 'integrity');
  assert.equal(exclusionClassOfRun(null, r), null);
  assert.equal(exclusionClassOfRun('something else', r), null);
  assert.equal(reasonLabel('infraError', r), 'infraError');
  assert.equal(reasonLabel('credsUnscrubbed', r), 'credsUnscrubbed [link]');
});

const GAP_FILE = { file: 'out.txt', reason: 'unwritable', detail: 'EACCES' };
const RUNS = [
  { arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2 }, { arm: 'vanilla', rep: 3 },
  { arm: 'v1', rep: 1 }, { arm: 'v1', rep: 2 },
  { arm: 'v1', rep: 3, flags: ['credsUnscrubbed'], unscrubbedFiles: [GAP_FILE] },
  { arm: 'v1', rep: 4, flags: ['credsUnscrubbed'], unscrubbedFiles: [LINKED] },
];
const NOT_JUDGED = [
  { armId: 'v1', taskId: 't1', replicate: 3, reason: 'credsUnscrubbed' },
  { armId: 'v1', taskId: 't1', replicate: 4, reason: 'credsUnscrubbed' },
];

function stampedStudy(opts = {}) {
  const root = tmp();
  const s = buildStudy(root, 'head', { stamp: STAMP, runs: RUNS, notJudged: NOT_JUDGED, ...opts });
  const r = buildReport({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
  return { root, ...s, ...r, md: renderMarkdown(r.report) };
}

test('stamped: a benign-cause scrub failure is a gap with a visible count; a tamper-cause one still counts as 0', () => {
  const s = stampedStudy();
  try {
    const c = s.report.arms.v1.overall;
    assert.deepEqual(c.rubricJudged, { n: 2, mean: 0.875, meanRaw: 0.875 });
    assert.deepEqual(c.rubricAll, { n: 3, mean: 0.5833333333333334, meanRaw: 0.5833333333333334 });
    assert.equal(c.excludedCount, 1);
    assert.equal(c.scrubGapCount, 1);
    const flag = c.flags.find((f) => f.includes('not judged'));
    assert.match(flag, /2 run\(s\) not judged \(credsUnscrubbed \[unwritable\], credsUnscrubbed \[link\]\)/);
    assert.match(flag, /1 of them count as failures \(0\) in the main rubric score/);
    assert.match(flag, /1 had a credential scrub failure that is not evidence of misbehavior, so they are left out of the rubric mean \(a gap\)/);
    assert.match(s.md, /Not judged \(2\): v1\/t1\/#3 \(credsUnscrubbed \[unwritable\], gap\), v1\/t1\/#4 \(credsUnscrubbed \[link\], integrity\)/);
    assert.match(s.md, /\| credsUnscrubbed \[unwritable\] \| gap \| left out \|/);
    assert.match(s.md, /\| credsUnscrubbed \[link\] \| integrity \| counted as 0 \|/);
  } finally { rm(s.root); }
});

test('stamped: an arm whose only exclusions are benign scrub failures has a main number equal to its judged number', () => {
  const s = stampedStudy({ runs: RUNS.filter((r) => r.rep !== 4), notJudged: NOT_JUDGED.slice(0, 1) });
  try {
    const c = s.report.arms.v1.overall;
    assert.equal(c.excludedCount, 0);
    assert.deepEqual(c.rubricAll, c.rubricJudged);
  } finally { rm(s.root); }
});

test('a benign-cause scrub failure is still kept out of judging', () => {
  const s = stampedStudy();
  try {
    const run = loadRun(s.dir);
    for (const rep of [3, 4]) assert.equal(notJudgedReason(run.runs.find((r) => r.armId === 'v1' && r.replicate === rep)), 'credsUnscrubbed');
  } finally { rm(s.root); }
});

test('unstamped: scrub causes change nothing in the reports', () => {
  const plain = tmp();
  const withCauses = tmp();
  try {
    const bare = DEFAULT_RUNS.map(({ unscrubbedFiles, ...r }) => r);
    const a = renderAll(plain, { runs: bare });
    const b = renderAll(withCauses, { runs: DEFAULT_RUNS.map((r) => (r.flags?.includes('credsUnscrubbed') ? { ...r, unscrubbedFiles: [GAP_FILE] } : r)) });
    assert.deepEqual(b, a);
    assert.ok(DEFAULT_NOT_JUDGED.some((n) => n.reason === 'credsUnscrubbed'));
  } finally { rm(plain); rm(withCauses); }
});
