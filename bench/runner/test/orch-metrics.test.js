// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spawn count and depth, review rounds, reworks after a PASS and phase-document presence, read from fixture streams
// and fixture workspaces. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const om = require('../lib/orch-metrics.js');

const PROFILES = path.join(__dirname, '..', '..', 'profiles');

// ---- stream fixtures ----
const call = (session, id, input) => ({ type: 'sessionUpdate', data: { sessionId: session, update: { sessionUpdate: 'tool_call', toolCallId: id, _meta: { kiro: { toolName: 'subagent' } }, rawInput: input } } });
const done = (session, id, output, status = 'completed') => ({ type: 'sessionUpdate', data: { sessionId: session, update: { sessionUpdate: 'tool_call_update', toolCallId: id, status, rawOutput: output } } });
const child = (session) => ({ type: 'metadata', data: { sessionId: session, turnDurationMs: 1 } });
const brief = (role, task) => ({ task, mode: 'blocking', stages: [{ name: role, role, prompt_template: `TARGET AGENT: ${role}\n\nTASK: ${task}\n\nCONTEXT: x` }] });

test('no subagent call gives 0 spawns and depth 0', () => {
  const r = om.spawnTree([child('root'), { type: 'runFinished', data: { sessionId: 'root', status: 'success' } }]);
  assert.deepEqual({ spawns: r.spawns, calls: r.spawnCalls, depth: r.maxSpawnDepth }, { spawns: 0, calls: 0, depth: 0 });
});

test('one call with two stages is 2 spawns at depth 1; a repeated tool_call id counts once', () => {
  const input = { stages: [{ name: 'a', role: 'k-developer' }, { name: 'b', role: 'k-architect' }] };
  const r = om.spawnTree([child('root'), call('root', 'c1', input), call('root', 'c1', input), child('s1'), child('s2'), done('root', 'c1', 'ok')]);
  assert.equal(r.spawnCalls, 1);
  assert.equal(r.spawns, 2);
  assert.equal(r.maxSpawnDepth, 1);
});

test('a spawn made by a subagent session is one level deeper', () => {
  const r = om.spawnTree([
    child('root'), call('root', 'c1', brief('k-developer', 'build it')),
    child('s1'), call('s1', 'c2', brief('k-researcher', 'look it up')),
    child('s2'), call('s2', 'c3', brief('k-tpm', 'plan')), child('s3'),
    done('s2', 'c3', 'ok'), done('s1', 'c2', 'ok'), done('root', 'c1', 'ok'),
  ]);
  assert.equal(r.spawns, 3);
  assert.equal(r.maxSpawnDepth, 3);
});

test('two parallel children of the root are both depth 1 even when one of them spawns', () => {
  const r = om.spawnTree([
    child('root'), call('root', 'c1', brief('k-developer', 'a')), call('root', 'c2', brief('k-architect', 'b')),
    child('s1'), call('s1', 'c3', brief('k-researcher', 'x')),
    child('s2'), child('s3'),
    done('s1', 'c3', 'ok'), done('root', 'c1', 'ok'), done('root', 'c2', 'ok'),
  ]);
  assert.equal(r.spawns, 3);
  assert.equal(r.maxSpawnDepth, 2, 'only the grandchild call sits at depth 2');
});

test('a child of the first parallel call that spawns is at depth 2, not below the other child', () => {
  const r = om.spawnTree([
    child('root'), call('root', 'c1', brief('k-developer', 'a')), call('root', 'c2', brief('k-architect', 'b')),
    child('s1'), call('s1', 'c3', brief('k-researcher', 'x')),
    child('s2'), call('s2', 'c4', brief('k-tpm', 'y')),
    done('s1', 'c3', 'ok'), done('s2', 'c4', 'ok'), done('root', 'c1', 'ok'), done('root', 'c2', 'ok'),
  ]);
  assert.equal(r.calls.find((c) => c.id === 'c3').depth, 2);
  assert.equal(r.calls.find((c) => c.id === 'c4').depth, 2, 'c1 and c2 each claim one child in order; s2 is the child of c2');
  assert.equal(r.maxSpawnDepth, 2);
});

test('the first session seen is the root, whatever its id', () => {
  const r = om.spawnTree([{ type: 'runStarted', data: { engine: 'v3' } }, call('zzz', 'c1', brief('k-developer', 'a')), child('aaa')]);
  assert.equal(r.maxSpawnDepth, 1);
});

// ---- review flow ----
const spec = () => om.loadMetricsSpec();

function flow(spawns) {
  const events = [child('root')];
  spawns.forEach((s, i) => {
    events.push(call('root', `c${i}`, brief(s.role, s.task)), child(`s${i}`), done('root', `c${i}`, s.out));
  });
  return om.reviewFlow(events, spec());
}

test('a review that finds a problem, a fix, and a passing re-review: 2 rounds, no rework after a pass', () => {
  const f = flow([
    { role: 'k-developer', task: 'Review the diff of the hold service', out: 'Verdict: FAIL. 1 IMPORTANT: missing lock' },
    { role: 'k-developer', task: 'Fix the IMPORTANT finding in the lock handling', out: 'Fixed.' },
    { role: 'k-developer', task: 'Re-review the lock handling', out: 'No CRITICAL or IMPORTANT findings. Verdict: PASS' },
  ]);
  assert.equal(f.reviewRounds, 2);
  assert.deepEqual(f.verdicts, ['fail', 'pass']);
  assert.equal(f.fixSpawns, 1);
  assert.equal(f.reworksAfterPass, 0);
});

test('a fix brief that follows a passing review is a rework after a pass', () => {
  const f = flow([
    { role: 'k-architect', task: 'Review the design doc', out: 'Verdict: PASS. No critical or important findings.' },
    { role: 'k-architect', task: 'Revise the design doc to address the review comments', out: 'done' },
    { role: 'k-architect', task: 'Review the revised design doc', out: 'Verdict: PASS' },
    { role: 'k-developer', task: 'Fix the review findings', out: 'done' },
  ]);
  assert.equal(f.reviewRounds, 2);
  assert.equal(f.reworksAfterPass, 2);
});

test('authoring spawns are neither reviews nor fixes; an unreadable verdict is unknown, not a pass', () => {
  const f = flow([
    { role: 'k-architect', task: 'Write the design for the hold service', out: 'Design written to docs/design.md' },
    { role: 'k-developer', task: 'Review the code', out: 'Looks fine to me.' },
    { role: 'k-developer', task: 'Fix the lint warnings from the review', out: 'done' },
  ]);
  assert.equal(f.reviewRounds, 1);
  assert.deepEqual(f.verdicts, ['unknown']);
  assert.equal(f.reworksAfterPass, 0, 'an unknown verdict is not a pass');
  assert.equal(f.fixSpawns, 1);
});

test('a TASK line decides the headline, so a long brief that mentions review in its context is not a review', () => {
  const events = [child('root'), call('root', 'c1', { stages: [{ name: 'impl', role: 'k-developer', prompt_template: 'TARGET AGENT: k-developer\n\nTASK: Implement the queue\n\nCONTEXT: a reviewer will check this later; review comments follow in the next step.' }] }), child('s1'), done('root', 'c1', 'ok')];
  assert.equal(om.reviewFlow(events, spec()).reviewRounds, 0);
});

test('a CRITICAL line in the returned text reads as a fail', () => {
  const f = flow([{ role: 'k-developer', task: 'Review the change', out: '## Findings\nCRITICAL: SQL built from user input\nIMPORTANT: no test' }]);
  assert.deepEqual(f.verdicts, ['fail']);
});

test('an explicit verdict wins over a sentence that says no CRITICAL defects (read from a real review)', () => {
  const out = 'Pipeline completed.\n\nVERDICT: NEEDS_CHANGES. The logic is correct and I found no CRITICAL defects.\n\nFINDINGS\n\nCRITICAL: none.\n\nMAJOR\n1. README.md:11 does not match the code.';
  const f = flow([{ role: 'k-developer', task: 'Independent code review', out }]);
  assert.deepEqual(f.verdicts, ['fail']);
});

test('the returned text is read from the result object, so a newline before VERDICT is a word boundary', () => {
  const events = [child('root'), call('root', 'c1', brief('k-developer', 'Review the diff')), child('s1'), done('root', 'c1', { items: [{ Text: 'Pipeline completed.\n\nVERDICT: NEEDS_CHANGES. No CRITICAL defects.' }] })];
  assert.deepEqual(om.reviewFlow(events, spec()).verdicts, ['fail']);
});

test('MAJOR counts like IMPORTANT, and a verdict word that is not listed falls back to the patterns', () => {
  assert.deepEqual(flow([{ role: 'k-developer', task: 'Review', out: '2 MAJOR findings' }]).verdicts, ['fail']);
  assert.deepEqual(flow([{ role: 'k-developer', task: 'Review', out: 'The verdict is clear. No CRITICAL or IMPORTANT findings.' }]).verdicts, ['pass']);
});

test('a numbered TASK line is the headline, and a fix needs a review word: fixing a failing test is a task, not a rework', () => {
  const numbered = (task) => [child('root'), call('root', 'c1', { stages: [{ name: 'x', role: 'k-developer', prompt_template: `1. TARGET AGENT: k-developer\n\n2. TASK: ${task}\n\n3. CONTEXT: A reviewer found things.` }] }), child('s1'), done('root', 'c1', 'ok')];
  assert.deepEqual(om.reviewFlow(numbered('Fix two README inaccuracies in the 400 section'), spec()).sequence, ['fix']);
  assert.deepEqual(om.reviewFlow(numbered('Fix the failing test in src/parse.js'), spec()).sequence, ['other']);
  assert.deepEqual(om.reviewFlow(numbered('Independent code review of the change'), spec()).sequence, ['review']);
});

// ---- phase documents ----
function workspace(files) {
  const root = tmp();
  for (const f of files) write(path.join(root, f), '# doc\n');
  return root;
}

test('the phase document list is a data file that names only documents the SOP names', () => {
  const docs = om.loadPhaseDocs();
  const sop = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'agent-sops', 'k-full-sdlc.sop.md'), 'utf8');
  assert.ok(docs.phases.length >= 9);
  for (const p of docs.phases) for (const d of p.documents) assert.ok(sop.includes(path.basename(d)), `${d} is not named in the SOP`);
});

test('every document of every phase present: complete', () => {
  const docs = om.loadPhaseDocs();
  const files = [];
  for (const p of docs.phases) {
    for (const d of p.documents) {
      const rel = d.replace(/\*/g, 'hold-service');
      files.push(p.atWorkspaceRoot ? rel : `.konductor/${rel}`);
    }
  }
  const root = workspace(files);
  try {
    const r = om.phaseDocuments(root, docs);
    assert.equal(r.complete, true);
    assert.equal(r.presentCount, r.totalCount);
    assert.deepEqual(r.missing, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a missing document is named, and its phase is incomplete', () => {
  const root = workspace(['.konductor/requirements/business-context.md', '.konductor/requirements/requirements-summary.md', '.konductor/design/system-design.md']);
  try {
    const r = om.phaseDocuments(root, om.loadPhaseDocs());
    assert.equal(r.complete, false);
    assert.equal(r.phases.requirements.complete, false);
    assert.deepEqual(r.phases.requirements.missing, ['requirements/user-stories-raw.md', 'requirements/user-stories-extract.md']);
    assert.equal(r.phases.design.complete, true);
    assert.equal(r.phases['code-review'].present, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a per-feature phase needs every feature to have every document', () => {
  const root = workspace([
    '.konductor/specs/a/requirements.md', '.konductor/specs/a/design.md', '.konductor/specs/a/tasks.md',
    '.konductor/specs/b/requirements.md', '.konductor/specs/b/design.md',
  ]);
  try {
    const r = om.phaseDocuments(root, om.loadPhaseDocs());
    assert.equal(r.phases.specs.complete, false);
    assert.deepEqual(r.phases.specs.missing, ['specs/b/tasks.md']);
    assert.equal(r.phases.specs.present, 5);
    assert.equal(r.phases.specs.total, 6);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an empty file does not count, and the project-root documents are read from the workspace root', () => {
  const root = workspace(['README.md', 'developer-guide.md']);
  write(path.join(root, '.konductor/sdlc-summary.md'), '');
  try {
    const r = om.phaseDocuments(root, om.loadPhaseDocs());
    assert.equal(r.phases.documentation.complete, true);
    assert.deepEqual(r.phases.summary.missing, ['sdlc-checklist.md', 'sdlc-summary.md']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a phase selection limits what is counted; an unknown phase is refused', () => {
  const root = workspace(['.konductor/design/system-design.md']);
  try {
    const r = om.phaseDocuments(root, om.loadPhaseDocs(), { phases: ['design'] });
    assert.equal(r.totalCount, 1);
    assert.equal(r.complete, true);
    assert.throws(() => om.phaseDocuments(root, om.loadPhaseDocs(), { phases: ['nope'] }), /unknown phase "nope"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a workspace that is not there gives null, not zero', () => {
  assert.equal(om.phaseDocuments('/nonexistent-dir-for-test', om.loadPhaseDocs()), null);
});

// ---- a run directory ----
test('orchMetricsOfRunDir reads stream.jsonl and workspace/ of a run directory', () => {
  const dir = tmp();
  try {
    const events = [child('root'), call('root', 'c1', brief('k-developer', 'Review the diff')), child('s1'), done('root', 'c1', 'Verdict: PASS')];
    write(path.join(dir, 'stream.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    write(path.join(dir, 'workspace/.konductor/design/system-design.md'), 'x');
    const m = om.orchMetricsOfRunDir(dir);
    assert.equal(m.spawns, 1);
    assert.equal(m.maxSpawnDepth, 1);
    assert.equal(m.reviewRounds, 1);
    assert.equal(m.reworksAfterPass, 0);
    assert.equal(m.phaseDocs.phases.design.complete, true);
    assert.equal(om.orchMetricsOfRunDir(path.join(dir, 'missing')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a stream with a malformed line still counts the good lines', () => {
  const dir = tmp();
  try {
    write(path.join(dir, 'stream.jsonl'), `${JSON.stringify(child('root'))}\nnot json\n${JSON.stringify(call('root', 'c1', brief('k-developer', 'x')))}\n`);
    assert.equal(om.orchMetricsOfRunDir(dir).spawns, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the spec files load and refuse a bad shape', () => {
  assert.ok(om.loadMetricsSpec(path.join(PROFILES, 'orch-metrics.json')).fix.length);
  const dir = tmp();
  try {
    write(path.join(dir, 'bad.json'), JSON.stringify({ fix: ['('], review: [], fail: [], pass: [] }));
    assert.throws(() => om.loadMetricsSpec(path.join(dir, 'bad.json')), /not a valid pattern/);
    write(path.join(dir, 'bad2.json'), JSON.stringify({ phases: [{ id: 'x' }] }));
    assert.throws(() => om.loadPhaseDocs(path.join(dir, 'bad2.json')), /documents/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
