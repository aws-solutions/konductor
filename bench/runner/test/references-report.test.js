// SPDX-License-Identifier: Apache-2.0
'use strict';

// The references-read scorer on synthetic streams: a read that works, a read that is refused, a read that errors, no
// read attempt, a skill that never loaded, sandbox errno, the planted fact, the decision rules and the report text.
// No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');
const R = require('../../report/refs.js');

const manifest = R.loadManifest();
const SKILLS_PATH = '/home/u/.konductor/skills/dynamodb-design/references/aws-best-practices.md';
const FACT = 'Write sharding: the shard suffix range is 1 to 200, hash(eventId) % 200.';

// ---- synthetic stream builders (engine v3 shapes) ----

let seq = 0;
const id = () => `toolu_${++seq}`;
const ev = (update, extra = {}) => ({ type: 'sessionUpdate', data: { sessionId: 's', update: { ...update, _meta: { kiro: extra } } } });
const say = (text) => ev({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }, { executionId: 'e1' });
function tool(events, title, rawInput, message, { status = 'completed', kind } = {}) {
  const toolCallId = id();
  events.push(ev({ sessionUpdate: 'tool_call', toolCallId, title, kind, rawInput }), ev({ sessionUpdate: 'tool_call_update', toolCallId, status, rawOutput: { message } }));
}
const loadSchema = (e) => tool(e, 'Tool Load', { id: 'tool::konductor-skills::get_skill' }, '{"loaded":[{"tool_id":"tool::konductor-skills::get_skill"}],"not_found":[]}');
const getSkill = (e, name, body = true) => tool(e, '@konductor-skills/get_skill', { tool_id: 'tool::konductor-skills::get_skill', arguments: { name } },
  body ? JSON.stringify({ name, content: `---\nname: ${name}\n---\nbody\nRead references/aws-best-practices.md` }) : 'Error: no skill', { status: body ? 'completed' : 'failed' });
const readFile = (e, p, message, status) => tool(e, 'Read File', { path: p }, message, { status, kind: 'read' });
const shell = (e, command, message) => tool(e, 'run it', { command }, message, { kind: 'execute' });
const finish = (e, text) => e.push({ type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: text } });
const FILE = `# DynamoDB AWS best practices\n${'Line of guidance about keys and indexes.\n'.repeat(40)}`;
const REFUSAL = `Path ${SKILLS_PATH} is outside the workspace and cannot be read.`;

function mkRun(root, { arm = 'refs-pr155', task = 'refs-dynamodb-design', rep = 1, events, workspace, stderr = '', result = {} }) {
  const dir = path.join(root, arm, 'k-architect', task, String(rep));
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'stream.jsonl'), [{ type: 'runStarted', data: { engine: 'v3' } }, ...events].map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ armId: arm, taskId: task, replicate: rep, agent: 'k-architect', status: 'success', creditsCharged: 3, wallClockMs: 60000, ...result }));
  fs.writeFileSync(path.join(dir, 'stderr.txt'), stderr);
  const files = workspace ?? { 'docs/data-model.md': `# Model\n${FACT}\n` };
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, 'workspace', rel)), { recursive: true }); fs.writeFileSync(path.join(dir, 'workspace', rel), text); }
  return dir;
}
const score = (dir) => R.scoreRun(dir, { manifest });
const root = () => mkScratch('refs-rep-');
const base = (e) => { loadSchema(e); getSkill(e, 'dynamodb-design'); };

// ---- one run ----

test('read ok and fact used: the skill loaded, the file read, the planted fact is in the artifact', () => {
  const r = root();
  const e = [];
  base(e);
  readFile(e, SKILLS_PATH, FILE);
  finish(e, 'Done.');
  const row = score(mkRun(r, { events: e }));
  assert.equal(row.skill.loaded, true);
  assert.deepEqual(row.skill.forms, ['get_skill']);
  assert.equal(row.readAttempts, 1);
  assert.equal(row.readSucceeded, 1);
  assert.equal(row.reads[0].where, 'skills-root');
  assert.equal(row.outcome, 'read-ok');
  assert.equal(row.usedReference, true);
  assert.equal(row.usable, true);
  assert.equal(row.credits, 3);
  assert.equal(row.wallMs, 60000);
});

test('read refused as an error result: the exact refusal text is kept', () => {
  const r = root();
  const e = [];
  base(e);
  readFile(e, SKILLS_PATH, REFUSAL, 'failed');
  finish(e, 'Could not read it.');
  const row = score(mkRun(r, { events: e, workspace: { 'docs/data-model.md': '# Model\nShard suffix range 1 to 16.\n' } }));
  assert.equal(row.outcome, 'refused');
  assert.equal(row.readRefused, 1);
  assert.equal(row.refusals[0].message, REFUSAL);
  assert.equal(row.refusals[0].path, SKILLS_PATH);
  assert.equal(row.usedReference, false);
});

test('read refused as a short successful result is still a refusal, a long file that mentions "denied" is not', () => {
  const short = 'Access denied: path not in the allowed directories.';
  assert.equal(R.classifyRead({ result: short, failed: false }), 'refused');
  assert.equal(R.classifyRead({ result: `${FILE}\nA request can be denied by the table.`, failed: false }), 'succeeded');
  assert.equal(R.classifyRead({ result: 'ENOENT: no such file or directory', failed: true }), 'error');
  assert.equal(R.classifyRead({ result: 'Permission denied (EACCES)', failed: true }), 'refused');
  assert.equal(R.classifyRead({ result: '   ', failed: false }), 'error');
  assert.equal(R.classifyRead({ result: 'path is not trusted by the workspace policy', failed: true }), 'refused');
});

test('a read that errors for another reason is an error, not a refusal', () => {
  const r = root();
  const e = [];
  base(e);
  readFile(e, SKILLS_PATH, 'ENOENT: no such file or directory', 'failed');
  finish(e, 'ok');
  const row = score(mkRun(r, { events: e }));
  assert.equal(row.outcome, 'error');
  assert.equal(row.readErrored, 1);
  assert.equal(row.readRefused, 0);
});

test('loaded but no read attempt: reading other files does not count', () => {
  const r = root();
  const e = [];
  base(e);
  readFile(e, 'docs/requirements.md', 'requirements text');
  readFile(e, '/home/u/.konductor/skills/dynamodb-design/SKILL.md', 'skill text');
  finish(e, 'Done.');
  const row = score(mkRun(r, { events: e, workspace: { 'docs/data-model.md': '# Model\nShard suffix range 1 to 16.\n' } }));
  assert.equal(row.outcome, 'no-attempt');
  assert.equal(row.readAttempts, 0);
  assert.equal(row.skill.loaded, true);
  assert.equal(row.usedReference, false);
});

test('not loaded: no get_skill call, a deferred call before the schema, or a failed call', () => {
  const r = root();
  let e = [];
  readFile(e, 'docs/requirements.md', 'x');
  finish(e, 'Done.');
  assert.equal(score(mkRun(r, { events: e, rep: 1 })).outcome, 'not-loaded');
  e = [];
  tool(e, 'Tool Call', { tool_id: 'tool::konductor-skills::get_skill', arguments: { name: 'dynamodb-design' } }, 'tool is not loaded: load its schema first', { status: 'failed' });
  finish(e, 'Done.');
  const deferred = score(mkRun(r, { events: e, rep: 2 }));
  assert.equal(deferred.skill.loaded, false);
  assert.equal(deferred.skill.attemptedLoad, true);
  assert.equal(deferred.outcome, 'not-loaded');
  e = [];
  loadSchema(e);
  getSkill(e, 'dynamodb-design', false);
  finish(e, 'Done.');
  assert.equal(score(mkRun(r, { events: e, rep: 3 })).skill.loaded, false);
});

test('other forms of a load count: load_resource(skill::name) and a read of SKILL.md', () => {
  const r = root();
  let e = [];
  tool(e, 'Load Resource', { id: 'skill::dynamodb-design' }, '{"loaded":[{"id":"skill::dynamodb-design"}],"not_found":[]}');
  finish(e, 'ok');
  assert.deepEqual(score(mkRun(r, { events: e, rep: 1 })).skill.forms, ['load_resource']);
  e = [];
  tool(e, 'Load Resource', { id: 'skill::dynamodb-design' }, '{"loaded":[],"not_found":["skill::dynamodb-design"]}');
  finish(e, 'ok');
  assert.equal(score(mkRun(r, { events: e, rep: 2 })).skill.loaded, false);
  e = [];
  readFile(e, '/home/u/.konductor/skills/dynamodb-design/SKILL.md', '---\nname: dynamodb-design\n---\nbody');
  finish(e, 'ok');
  const row = score(mkRun(r, { events: e, rep: 3 }));
  assert.deepEqual(row.skill.forms, ['read-skill-md']);
  assert.equal(row.skill.loaded, true);
});

test('a shell read of the reference counts as an attempt; a grep of the workspace does not', () => {
  const r = root();
  const e = [];
  base(e);
  shell(e, `cat ${SKILLS_PATH}`, FILE);
  shell(e, 'grep -rn shard docs', 'nothing');
  finish(e, 'ok');
  const row = score(mkRun(r, { events: e }));
  assert.equal(row.readAttempts, 1);
  assert.equal(row.reads[0].via, 'shell');
  assert.equal(row.outcome, 'read-ok');
});

test('the readable arm: a relative read of references/ inside the workspace counts and is located in the workspace', () => {
  const r = root();
  const e = [];
  base(e);
  readFile(e, 'references/aws-best-practices.md', FILE);
  finish(e, 'ok');
  const row = score(mkRun(r, { arm: 'refs-readable', task: 'refs-dynamodb-readable', events: e }));
  assert.equal(row.role, 'readable');
  assert.equal(row.reads[0].where, 'workspace');
  assert.equal(row.outcome, 'read-ok');
  assert.equal(row.usedReference, true);
});

test('the sprint task: the fact needs the lost subtasks and the number 22, and the control skill name counts as a load', () => {
  const r = root();
  const e = [];
  loadSchema(e);
  getSkill(e, 'asana-sprint-planning');
  finish(e, 'ok');
  const art = { 'docs/rollover-plan.md': 'The recreated T-103 loses its subtasks, so the board shows 22 of 27.\n' };
  const row = score(mkRun(r, { arm: 'refs-main-forced', task: 'refs-sprint-capacity', events: e, workspace: art }));
  assert.equal(row.skill.loaded, true);
  assert.equal(row.usedReference, true);
  const e2 = [];
  loadSchema(e2);
  getSkill(e2, 'sprint-planning');
  finish(e2, 'ok');
  const row2 = score(mkRun(r, { arm: 'refs-asana', task: 'refs-sprint-capacity', events: e2, workspace: { 'docs/rollover-plan.md': 'The board shows 27 of 27.\n' } }));
  assert.equal(row2.usedReference, false);
  assert.equal(row2.role, 'reference');
});

test('sandbox errno 38 marks the run unusable and records the match', () => {
  const r = root();
  const e = [];
  base(e);
  readFile(e, SKILLS_PATH, 'Error 38: Function not implemented', 'failed');
  finish(e, 'ok');
  const a = score(mkRun(r, { events: e, rep: 1 }));
  assert.equal(a.sandboxErrno, true);
  assert.equal(a.usable, false);
  assert.equal(a.excludedReason, 'sandboxErrno');
  const b = score(mkRun(r, { events: [], rep: 2, stderr: 'spawn: ENOSYS' }));
  assert.equal(b.sandboxErrno, true);
});

test('thin runs never throw: no stream, an unknown task, an unfinished run', () => {
  const r = root();
  const dir = mkRun(r, { events: [], rep: 1 });
  fs.rmSync(path.join(dir, 'stream.jsonl'));
  assert.equal(score(dir).excludedReason, 'no-stream');
  assert.equal(score(mkRun(r, { task: 'not-a-task', events: [], rep: 2 })).excludedReason, 'unknown-task');
  const unfinished = score(mkRun(r, { events: [], rep: 3, workspace: {}, result: { status: 'timeout' } }));
  assert.equal(unfinished.usable, false);
  assert.equal(unfinished.excludedReason, 'unfinished');
});

// ---- decision rules ----

const row = (over) => ({ role: 'reference', usable: true, skill: { loaded: true }, readAttempts: 0, readSucceeded: 0, readRefused: 0, usedReference: false, refusals: [], arm: 'refs-pr155', task: 't', rep: 1, ...over });
const many = (n, over) => Array.from({ length: n }, (_, i) => row({ rep: i + 1, ...over }));

test('DECISION: any refusal means the install must grant read access', () => {
  const rows = [...many(3, { readAttempts: 1, readSucceeded: 1, usedReference: true }), row({ readAttempts: 1, readRefused: 1, refusals: [{ n: 4, path: SKILLS_PATH, message: REFUSAL }] })];
  const d = R.decide(rows);
  assert.equal(d.key, 'refused');
  assert.match(d.text, /install must grant read access to the skills root/);
  assert.equal(d.refusals[0].message, REFUSAL);
});

test('DECISION: reads that worked and carried the fact mean it works', () => {
  const d = R.decide(many(4, { readAttempts: 1, readSucceeded: 1, usedReference: true }));
  assert.equal(d.key, 'works');
  assert.equal(d.counts.readOkUsed, 4);
});

test('DECISION: loaded runs that never tried mean the agent does not follow the pointer', () => {
  const d = R.decide(many(5));
  assert.equal(d.key, 'no-follow');
  assert.match(d.text, /does not follow the pointer/i);
});

test('DECISION: too few loaded runs is inconclusive, and a refusal in a run that did not load still counts', () => {
  const few = [...many(2), ...many(5, { skill: { loaded: false } })];
  assert.equal(R.decide(few).key, 'inconclusive');
  const refusedUnloaded = [...many(5, { skill: { loaded: false } }), row({ skill: { loaded: false }, readAttempts: 1, readRefused: 1 })];
  assert.equal(R.decide(refusedUnloaded).key, 'refused');
});

test('DECISION: reads without the fact, or a split, is mixed; control and excluded runs do not enter the decision', () => {
  const rows = [...many(2, { readAttempts: 1, readSucceeded: 1, usedReference: false }), ...many(1)];
  assert.equal(R.decide(rows).key, 'mixed');
  const withControl = [...many(5), ...many(9, { role: 'control', readAttempts: 1, readRefused: 1 }), ...many(9, { usable: false, readRefused: 1 })];
  assert.equal(R.decide(withControl).key, 'no-follow');
});

test('thresholds are fixed and frozen', () => {
  assert.equal(Object.isFrozen(R.THRESHOLDS), true);
  assert.deepEqual({ ...R.THRESHOLDS }, { minLoaded: 3, refusedAny: 1, worksReadShare: 0.5, worksUsedShare: 0.5, noAttemptShare: 0.5, controlUsedMin: 0.5, refusalChars: 400, smallResult: 600 });
});

test('the forced control is valid only when enough loaded runs carry the fact', () => {
  assert.equal(R.controlCheck(many(4, { role: 'control', usedReference: true })).valid, true);
  assert.equal(R.controlCheck(many(4, { role: 'control' })).valid, false);
  assert.equal(R.controlCheck([]).valid, false);
});

// ---- table and report ----

function fixtureRuns() {
  const r = root();
  let rep = 0;
  const add = (arm, task, build) => { const e = []; build(e); finish(e, 'ok'); return mkRun(r, { arm, task, rep: ++rep, events: e }); };
  add('refs-pr155', 'refs-dynamodb-design', (e) => { base(e); readFile(e, SKILLS_PATH, REFUSAL, 'failed'); });
  add('refs-pr155', 'refs-dynamodb-design', (e) => { base(e); readFile(e, SKILLS_PATH, FILE); });
  add('refs-pr155', 'refs-dynamodb-design', (e) => { base(e); });
  add('refs-pr155', 'refs-dynamodb-design', () => {});
  add('refs-pr155-forced', 'refs-dynamodb-design', (e) => { base(e); readFile(e, SKILLS_PATH, 'Error 38: Function not implemented', 'failed'); });
  add('refs-main-forced', 'refs-dynamodb-design', (e) => { base(e); });
  return r;
}

test('the arm table counts outcomes over usable runs, lists excluded runs apart, and carries credits', () => {
  const a = R.analyze([fixtureRuns()]);
  const t = Object.fromEntries(a.table.map((x) => [x.arm, x]));
  assert.equal(t['refs-pr155'].usable, 4);
  assert.deepEqual(t['refs-pr155'].outcomes, { 'not-loaded': 1, 'no-attempt': 1, refused: 1, error: 0, 'read-ok': 1 });
  assert.equal(t['refs-pr155-forced'].usable, 0);
  assert.equal(t['refs-pr155-forced'].excluded, 1);
  assert.equal(t['refs-pr155'].credits, 12);
  assert.equal(a.decision.key, 'refused');
});

test('the report has the table with Wilson intervals, the verbatim refusal, the decision rules and the excluded list', () => {
  const a = R.analyze([fixtureRuns()]);
  const md = R.renderReport(a);
  assert.match(md, /## Arm by outcome/);
  assert.match(md, /\| refs-pr155 \| reference \| 4 \|/);
  assert.match(md, /1\/4 \(\d+-\d+%\)/);
  assert.match(md, /## DECISION\n\nREFUSED: 1 reference-arm run\(s\)/);
  assert.ok(md.includes(REFUSAL), 'the refusal is quoted in full');
  assert.match(md, /Any refused reference read \(1 or more runs\)/);
  assert.match(md, /refs-pr155-forced \/ refs-dynamodb-design #\d+: sandboxErrno/);
  assert.match(md, /Sandbox errno 38 runs are listed here and counted in no rate/);
  assert.match(md, /`\/home\/u\/\.konductor\/skills\/dynamodb-design\/references\/aws-best-practices\.md`/);
});

test('refs-report writes the three files and prints the decision; missing flags are an error', () => {
  const r = fixtureRuns();
  const out = path.join(mkScratch('refs-out-'), 'o');
  const lines = [];
  const logged = console.log;
  const errored = console.error;
  const code = process.exitCode;
  console.log = (m) => lines.push(String(m));
  console.error = (m) => lines.push(`ERR ${m}`);
  try {
    R.cmdRefsReport({ run: r, out });
    assert.equal(process.exitCode, code);
    assert.match(lines.join('\n'), /REFUSED/);
    for (const f of ['refs-report.md', 'refs-report.json', 'refs-runs.jsonl']) assert.ok(fs.existsSync(path.join(out, f)), f);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'refs-report.json'), 'utf8')).decision.key, 'refused');
    assert.equal(fs.readFileSync(path.join(out, 'refs-runs.jsonl'), 'utf8').trim().split('\n').length, 6);
    R.cmdRefsReport({ run: r });
    assert.equal(process.exitCode, 2);
    process.exitCode = code;
    R.cmdRefsReport({ run: path.join(r, 'nope'), out });
    assert.equal(process.exitCode, 2);
  } finally {
    console.log = logged;
    console.error = errored;
    process.exitCode = code;
  }
  assert.ok(lines.some((l) => /^ERR refs-report: --out DIR is required/.test(l)));
});
