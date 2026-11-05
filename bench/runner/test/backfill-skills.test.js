// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench.js backfill --skills: recomputes the skill-load fields of finished runs from stream.jsonl with the runner's own
// code. Credits are never touched. A killed run is included because its skill calls are in the stream.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, mkResult } = require('./helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const { parseStream } = require('../lib/stream.js');
const { SKILL_FIELDS, extractSkills, resultFields, catalogFrom, capInvocationOf } = require('../lib/skills.js');
const { aggregateRunDir } = require('../lib/harness/kiro.js');
const { backfillAll, PRE_BACKFILL } = require('../lib/backfill.js');
const { backfillSkills, summarizeSkillsBackfill, PRE_SKILLS_BACKFILL } = require('../lib/backfill-skills.js');

const BENCH = path.join(__dirname, '..', 'bench.js');
const FX = path.join(__dirname, 'fixtures');
const NOW = () => '2026-11-01T09:00:00.000Z';
const fixture = (name) => fs.readFileSync(path.join(FX, name), 'utf8');
const V3 = fixture('v3-skill-loads.stream.jsonl');
const completion = JSON.stringify({ type: 'sessionUpdate', data: { sessionId: 'sess_root', update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'turn_completion', executionId: 'e1', turnId: 'e1', elapsedTime: 4321, promptTurnSummaries: [{ unit: 'credit', usage: 6.5, usedTools: [] }], requestIds: [] } } } } });
const finished = JSON.stringify({ type: 'runFinished', data: { sessionId: 'sess_root', status: 'success', stopReason: 'end_turn', finalText: 'done', finalTextTruncated: false } });

// What the old runner wrote for a v3 run: every skill field empty, target unknown, capInvocation blind.
const blind = (o = {}) => mkResult({
  harness: 'kiro-cli', agentEngine: 'v3', credits: 6.5, creditsCharged: 6.5,
  skillsLoaded: [], skillQueries: [], sopsLoaded: [], skillBytesLoaded: 0, skillCallsFailed: 0, findSkillsCalls: 0, findSkillsEmpty: 0,
  startupResourceCount: null, targetLoaded: null, targetAttempted: null, targetReachable: null, sopNameSource: 'convention', skillsScope: 'all-sessions',
  capInvocation: { delegatedTo: [], findSkillsBytes: 0, requested: [], firstDecision: { kind: 'none', name: null }, identified: [] },
  ...o,
});

function put(cell, arm, task, rep, result, stream) {
  const dir = path.join(cell, arm, task, String(rep));
  write(path.join(dir, 'result.json'), `${JSON.stringify({ ...result, armId: arm, taskId: task, replicate: rep }, null, 2)}\n`);
  if (stream != null) write(path.join(dir, 'stream.jsonl'), stream);
  return dir;
}

// A repo listing with the skills the fixture loads, and a bench dir whose task targets delegation-protocol.
function makeWorld() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'), { cls: 'orchestration' });
  const task = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...task, target: 'delegation-protocol' }));
  const repo = path.join(root, 'repo');
  for (const s of ['delegation-protocol', 'design-doc-guidelines', 'design-evaluation']) write(path.join(repo, 'skills', s, 'SKILL.md'), `# ${s}\n`);
  write(path.join(repo, 'agent-sops', 'k-plan.sop.md'), '# k-plan\n');
  const cell = path.join(root, 'cell');
  put(cell, 'orch', 't1', 1, blind(), V3);
  put(cell, 'orch', 't1', 2, blind({ status: 'timeout', exitCode: null, runFinishedStatus: null, credits: null, creditsCharged: 1, creditsCensored: true, creditsLowerBound: 0 }), `${V3}{"type":"sessionUpdate","data":{"update":{"sessionUpda`);
  put(cell, 'vanilla', 't1', 1, blind({ credits: 2, creditsCharged: 2 }), `${completion}\n${finished}\n`);
  return { root, bench, repo, cell, tasks: loadTasks(bench) };
}

const run = (w, o = {}) => backfillSkills({ runDir: w.cell, tasks: w.tasks, repoRoot: w.repo, write: false, now: NOW, ...o });
const read = (cell, arm, task, rep = 1, file = 'result.json') => JSON.parse(fs.readFileSync(path.join(cell, arm, task, String(rep), file), 'utf8'));
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => [path.join(e.parentPath, e.name), fs.readFileSync(path.join(e.parentPath, e.name), 'utf8')]));
const byRun = (out) => Object.fromEntries(out.map((r) => [`${r.armId}/${r.taskId}/${r.replicate}`, r]));

test('a dry run says what would change and writes nothing', () => {
  const w = makeWorld();
  try {
    const before = snapshot(w.cell);
    const by = byRun(run(w));
    assert.deepEqual(snapshot(w.cell), before);
    assert.equal(by['orch/t1/1'].status, 'changed');
    assert.equal(by['orch/t1/1'].after.skillsLoaded.length, 3);
    assert.equal(by['orch/t1/1'].before.skillsLoaded.length, 0);
    assert.equal(by['vanilla/t1/1'].status, 'unchanged', 'a run with nothing to recover is left alone');
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('--write rewrites the skill fields and capInvocation from the stream and nothing else', () => {
  const w = makeWorld();
  try {
    const original = read(w.cell, 'orch', 't1');
    run(w, { write: true });
    const r = read(w.cell, 'orch', 't1');
    assert.deepEqual(r.skillsLoaded.map((s) => `${s.name}:${s.count}`), ['delegation-protocol:1', 'design-doc-guidelines:3', 'design-evaluation:2']);
    assert.equal(r.skillCallsFailed, 5);
    assert.equal(r.targetLoaded, true);
    assert.equal(r.targetAttempted, true);
    assert.equal(r.capInvocation.firstDecision.name, 'delegation-protocol');
    assert.deepEqual(r.skillsBackfill, { at: NOW(), source: 'stream.jsonl' });
    const keep = (o) => { const rest = { ...o }; for (const k of [...SKILL_FIELDS, 'capInvocation', 'skillsBackfill']) delete rest[k]; return rest; };
    assert.deepEqual(keep(r), keep(original));
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('the fields equal what the runner computes for the same stream', () => {
  const w = makeWorld();
  try {
    run(w, { write: true });
    const events = parseStream(V3).events;
    const task = w.tasks.get('t1');
    const info = { catalog: catalogFrom({ skills: ['delegation-protocol', 'design-doc-guidelines', 'design-evaluation'], sops: ['k-plan'], agents: null }), startup: null };
    const expected = resultFields({ extraction: extractSkills(events, 'kiro-cli'), info, task, arm: { vanilla: false } });
    const r = read(w.cell, 'orch', 't1');
    for (const k of SKILL_FIELDS) assert.deepEqual(r[k], expected[k], k);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('--write keeps the original in result.json.pre-skills-backfill and leaves an earlier pre-backfill copy alone', () => {
  const w = makeWorld();
  try {
    const dir = path.join(w.cell, 'orch', 't1', '1');
    const original = fs.readFileSync(path.join(dir, 'result.json'), 'utf8');
    fs.writeFileSync(path.join(dir, `result.json${PRE_BACKFILL}`), 'the credit backfill original');
    run(w, { write: true });
    assert.equal(fs.readFileSync(path.join(dir, `result.json${PRE_SKILLS_BACKFILL}`), 'utf8'), original);
    assert.equal(fs.readFileSync(path.join(dir, `result.json${PRE_BACKFILL}`), 'utf8'), 'the credit backfill original');
    assert.notEqual(PRE_SKILLS_BACKFILL, PRE_BACKFILL);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('a pre-skills-backfill copy that differs from result.json is never overwritten', () => {
  const w = makeWorld();
  try {
    const copy = path.join(w.cell, 'orch', 't1', '1', `result.json${PRE_SKILLS_BACKFILL}`);
    fs.writeFileSync(copy, 'someone else\'s file');
    const by = byRun(run(w, { write: true }));
    assert.equal(by['orch/t1/1'].status, 'unrecoverable');
    assert.match(by['orch/t1/1'].reason, /pre-skills-backfill/);
    assert.equal(fs.readFileSync(copy, 'utf8'), 'someone else\'s file');
    assert.deepEqual(read(w.cell, 'orch', 't1').skillsLoaded, []);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('a second --write changes nothing', () => {
  const w = makeWorld();
  try {
    run(w, { write: true });
    const after = snapshot(w.cell);
    const by = byRun(run(w, { write: true, now: () => '2026-11-02T00:00:00.000Z' }));
    assert.deepEqual(snapshot(w.cell), after);
    assert.equal(by['orch/t1/1'].status, 'unchanged');
    assert.equal(by['orch/t1/2'].status, 'unchanged');
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('a killed run gets its skill fields from the stream and keeps its censored credits', () => {
  const w = makeWorld();
  try {
    const original = read(w.cell, 'orch', 't1', 2);
    const by = byRun(run(w, { write: true }));
    assert.equal(by['orch/t1/2'].status, 'changed');
    assert.equal(by['orch/t1/2'].killed, true);
    assert.equal(by['orch/t1/1'].killed, false);
    const r = read(w.cell, 'orch', 't1', 2);
    assert.equal(r.skillsLoaded.length, 3, 'a torn last line does not hide the earlier calls');
    for (const k of ['status', 'credits', 'creditsCharged', 'creditsCensored', 'creditsLowerBound', 'runFinishedStatus']) assert.deepEqual(r[k], original[k], k);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('a run that already holds the runner\'s fields is not rewritten, v2 included', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const stream = fixture('kiro-main-orch-input-validation.stream.jsonl');
    const extraction = extractSkills(parseStream(stream).events, 'kiro-cli');
    const fields = resultFields({ extraction, info: { catalog: catalogFrom(), startup: null }, task: loadTasks(bench).get('t1'), arm: { vanilla: false } });
    const cell = path.join(root, 'cell');
    const dir = put(cell, 'main', 't1', 1, mkResult({ harness: 'kiro-cli' }), stream);
    const capInvocation = capInvocationOf({ agg: aggregateRunDir(dir), extraction, sops: [] });
    put(cell, 'main', 't1', 1, { ...mkResult({ harness: 'kiro-cli' }), ...fields, capInvocation }, stream);
    const before = snapshot(cell);
    const by = byRun(backfillSkills({ runDir: cell, tasks: loadTasks(bench), repoRoot: null, write: true, now: NOW }));
    assert.equal(by['main/t1/1'].status, 'unchanged');
    assert.deepEqual(snapshot(cell), before);
    assert.equal(fs.existsSync(path.join(dir, `result.json${PRE_SKILLS_BACKFILL}`)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runs without a stream, with an unknown task or with a budget skip are skipped and not touched', () => {
  const w = makeWorld();
  try {
    put(w.cell, 'orch', 't1', 3, blind(), null);
    put(w.cell, 'orch', 'ghost', 1, blind(), V3);
    put(w.cell, 'orch', 't1', 4, blind({ status: 'budget_skipped' }), V3);
    const before = snapshot(w.cell);
    const by = byRun(run(w, { write: true }));
    assert.match(by['orch/t1/3'].reason, /no stream/);
    assert.match(by['orch/ghost/1'].reason, /task ghost/);
    assert.match(by['orch/t1/4'].reason, /budget/);
    for (const k of ['orch/t1/3', 'orch/ghost/1', 'orch/t1/4']) assert.equal(by[k].status, 'skipped', k);
    const after = snapshot(w.cell);
    for (const [file, text] of Object.entries(before)) {
      if (/\/(t1\/[34]|ghost\/1)\//.test(file)) assert.equal(after[file], text, file);
    }
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('an opencode run is skipped: its stream was always readable', () => {
  const w = makeWorld();
  try {
    const cell = path.join(w.root, 'oc-cell');
    put(cell, 'oc-orch', 't1', 1, blind({ harness: 'opencode' }), V3);
    const before = snapshot(cell);
    const by = byRun(backfillSkills({ runDir: cell, tasks: w.tasks, repoRoot: w.repo, write: true, now: NOW }));
    assert.match(by['oc-orch/t1/1'].reason, /not a kiro-cli run/);
    assert.deepEqual(snapshot(cell), before);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('the summary counts runs, loads and failed calls per arm, before and after', () => {
  const w = makeWorld();
  try {
    const sum = summarizeSkillsBackfill(run(w));
    const orch = sum.arms.find((a) => a.armId === 'orch');
    assert.equal(orch.runs, 2);
    assert.equal(orch.changed, 2);
    assert.deepEqual(orch.withSkill, { before: 0, after: 2 });
    assert.deepEqual(orch.loads, { before: 0, after: 12 });
    assert.deepEqual(orch.failedCalls, { before: 0, after: 10 });
    assert.deepEqual(orch.targetLoaded, { before: { n: 0, of: 0 }, after: { n: 2, of: 2 } });
    assert.deepEqual(orch.skills.find((s) => s.name === 'design-doc-guidelines'), { name: 'design-doc-guidelines', before: 0, after: 6 });
    assert.equal(sum.arms.find((a) => a.armId === 'vanilla').changed, 0);
    assert.equal(sum.killed, 1);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

// ---- command line ----

test('--write adds the split of failed calls by tool; a zero-failure result without the field is left alone', () => {
  const w = makeWorld();
  try {
    assert.equal('skillCallsFailedByTool' in read(w.cell, 'orch', 't1'), false);
    const by = byRun(run(w, { write: true }));
    assert.equal(by['vanilla/t1/1'].status, 'unchanged', 'no failures, so the missing split already says zero');
    assert.equal('skillCallsFailedByTool' in read(w.cell, 'vanilla', 't1'), false);
    const r = read(w.cell, 'orch', 't1');
    const split = r.skillCallsFailedByTool;
    assert.equal(Object.values(split).reduce((a, b) => a + b, 0), r.skillCallsFailed);
    assert.deepEqual(Object.keys(split).sort(), ['find_skills', 'get_skill', 'load_resource']);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('a stream with a refused load_resource and an SOP activation is recovered into the failed split and the SOP fields', () => {
  const w = makeWorld();
  try {
    const tail = `${completion}\n${finished}\n`;
    put(w.cell, 'orch', 't1', 3, blind(), fixture('v3-load-resource-refused.stream.jsonl') + tail);
    put(w.cell, 'orch', 't1', 4, blind(), fixture('v3-sop-activation.stream.jsonl') + tail);
    run(w, { write: true });
    const refused = read(w.cell, 'orch', 't1', 3);
    assert.deepEqual(refused.skillCallsFailedByTool, { get_skill: 1, load_resource: 1, find_skills: 0 });
    assert.equal(refused.skillCallsFailed, 2);
    assert.deepEqual(refused.capInvocation.firstDecision, { kind: 'get_skill', name: 'design-doc-guidelines' });
    const sop = read(w.cell, 'orch', 't1', 4);
    assert.deepEqual(sop.sopsLoaded.map((x) => `${x.name}:${x.via}`), ['sop-k-design-doc-creation:disclose_context']);
    assert.deepEqual(sop.capInvocation.firstDecision, { kind: 'skill', name: 'sop-k-design-doc-creation' });
    assert.deepEqual(sop.skillCallsFailedByTool, { get_skill: 1, load_resource: 0, find_skills: 0 });
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

const cli = (w, args) => spawnSync('node', [BENCH, 'backfill', '--run', w.cell, '--bench-dir', w.bench, '--repo-root', w.repo, ...args], { encoding: 'utf8', env: { ...process.env, HOME: tmp() } });

test('--skills is a dry run unless --write is given and prints a per-arm before and after table', () => {
  const w = makeWorld();
  try {
    const before = snapshot(w.cell);
    const dry = cli(w, ['--skills']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(snapshot(w.cell), before);
    assert.match(dry.stdout, /dry run, nothing written: would change 2/);
    assert.match(dry.stdout, /\| orch \| 2 \| 2 \| 0 -> 2 \| 0 -> 12 \| 0 -> 10 \|/);
    assert.match(dry.stdout, /delegation-protocol 0 -> 2/);
    assert.match(dry.stdout, /1 of them killed or timed out/);
    const wet = cli(w, ['--skills', '--write']);
    assert.equal(wet.status, 0, wet.stderr);
    assert.match(wet.stdout, /changed 2/);
    assert.equal(read(w.cell, 'orch', 't1').targetLoaded, true);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('without --skills the command only backfills credits, and --skills alone leaves credits alone', () => {
  const w = makeWorld();
  try {
    put(w.cell, 'main', 't1', 1, blind({ credits: null, creditsCharged: 0, turnDurationMs: null, modelCalls: { meteringEntries: 0, totalRequestCount: null }, toolNames: { unknown: 1 }, toolCalls: 1, workToolCalls: 1, subagentCalls: 0 }), `${completion}\n${finished}\n`);
    const credits = cli(w, ['--write']);
    assert.equal(credits.status, 0, credits.stderr);
    assert.equal(read(w.cell, 'main', 't1').credits, 6.5);
    assert.deepEqual(read(w.cell, 'orch', 't1').skillsLoaded, [], 'the default mode leaves skill fields alone');
    const credit = (a, t) => JSON.stringify(read(w.cell, a, t).credits);
    const snap = credit('main', 't1');
    assert.equal(cli(w, ['--skills', '--write']).status, 0);
    assert.equal(credit('main', 't1'), snap);
    assert.equal(read(w.cell, 'orch', 't1').skillsLoaded.length, 3);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('--credits --skills --write does both, keeps both copies, and a second pass changes nothing', () => {
  const w = makeWorld();
  try {
    put(w.cell, 'main', 't1', 1, blind({ credits: null, creditsCharged: 0, turnDurationMs: null, modelCalls: { meteringEntries: 0, totalRequestCount: null } }), `${V3}${completion}\n${finished}\n`);
    const dir = path.join(w.cell, 'main', 't1', '1');
    const original = fs.readFileSync(path.join(dir, 'result.json'), 'utf8');
    const first = cli(w, ['--credits', '--skills', '--write']);
    assert.equal(first.status, 0, first.stderr);
    const r = read(w.cell, 'main', 't1');
    assert.equal(r.credits, 6.5);
    assert.equal(r.skillsLoaded.length, 3);
    assert.equal(fs.readFileSync(path.join(dir, `result.json${PRE_BACKFILL}`), 'utf8'), original);
    assert.equal(fs.readFileSync(path.join(dir, `result.json${PRE_SKILLS_BACKFILL}`), 'utf8').includes('"creditsBackfill"'), true, 'the skills copy is taken after the credit rewrite');
    const after = snapshot(w.cell);
    assert.equal(cli(w, ['--credits', '--skills', '--write']).status, 0);
    assert.deepEqual(snapshot(w.cell), after);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('the credit backfill still works after a skills backfill of the same run', () => {
  const w = makeWorld();
  try {
    put(w.cell, 'main', 't1', 1, blind({ credits: null, creditsCharged: 0, turnDurationMs: null, modelCalls: { meteringEntries: 0, totalRequestCount: null } }), `${V3}${completion}\n${finished}\n`);
    assert.equal(cli(w, ['--skills', '--write']).status, 0);
    const by = byRun(backfillAll({ runDir: w.cell, write: true, now: NOW }));
    assert.equal(by['main/t1/1'].status, 'recovered');
    assert.equal(read(w.cell, 'main', 't1').credits, 6.5);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});
