// SPDX-License-Identifier: Apache-2.0
'use strict';

// The "Skills actually used" report section, the `skills` command, and the harness wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { summarizeSkills, renderSkillsMarkdown, collectRows } = require('../../report/skills.js');
const { loadRun } = require('../../report/load.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { loadTasks } = require('../lib/tasks.js');
const { armRecords } = require('../lib/runconfig.js');
const { kiro, opencode: oc } = require('../lib/harness/index.js');
const { extractSkills, resultFields, SKILL_FIELDS } = require('../lib/skills.js');
const { executeRun } = require('../lib/run-one.js');
const { makeFakeKiro } = require('./fake-kiro.js');

const FX = path.join(__dirname, 'fixtures');
const BENCH_JS = path.join(__dirname, '..', 'bench.js');

const empty = () => Object.fromEntries(SKILL_FIELDS.map((k) => [k, null]));
const fields = (o = {}) => ({
  ...empty(), skillsLoaded: [], skillQueries: [], sopsLoaded: [], skillBytesLoaded: 0, skillCallsFailed: 0, findSkillsCalls: 0, findSkillsEmpty: 0,
  skillsScope: 'all-sessions', sopNameSource: 'listing', ...o,
});
const sk = (name, count = 1) => ({ name, via: 'get_skill', count });
const row = (armId, taskId, taskClass, target, f, rep = 1) => ({ armId, taskId, replicate: rep, taskClass, target, fields: f });

const ROWS = [
  row('main', 's1', 'sop', 'k-verify', fields({ skillsLoaded: [sk('k-verify')], sopsLoaded: [sk('k-verify')], skillBytesLoaded: 1000, targetLoaded: true, targetAttempted: true, targetReachable: true }), 1),
  row('main', 's1', 'sop', 'k-verify', fields({ skillsLoaded: [sk('verification', 2)], skillBytesLoaded: 3000, targetLoaded: false, targetAttempted: false, targetReachable: true }), 2),
  row('main', 's1', 'sop', 'k-verify', fields({ targetLoaded: false, targetAttempted: true, targetReachable: true, skillCallsFailed: 1 }), 3),
  row('main', 'r1', 'review', 'backend-review', fields({ skillsLoaded: [sk('a', 4), sk('b', 3), sk('c', 2), sk('d', 1), sk('e', 1), sk('f', 1)], skillBytesLoaded: 500, targetLoaded: false, targetAttempted: false, targetReachable: false, findSkillsCalls: 2, findSkillsEmpty: 2 })),
  row('main', 'o1', 'orchestration', 'konductor', fields()),
  row('main', 'old', 'simple', null, null),
  row('vanilla', 's1', 'sop', 'k-verify', fields()),
];

test('summarizeSkills: shares, SOP activation, target rates, bytes, failures, top skills, runs without data', () => {
  const sum = summarizeSkills(ROWS, { armOrder: ['vanilla', 'main'], startup: { main: { count: 5, totalBytes: 9000, unknownSizes: 2 }, vanilla: { builtin: true, count: null, totalBytes: null } } });
  assert.deepEqual(Object.keys(sum.arms), ['vanilla', 'main']);
  assert.equal(sum.recorded, 6);
  assert.equal(sum.notRecorded, 1);
  const m = sum.arms.main;
  assert.equal(m.notRecorded, 1);
  assert.equal(m.overall.runs, 5);
  assert.equal(m.overall.anySkill, 3);
  assert.equal(m.byClass.sop.runs, 3);
  assert.equal(m.byClass.sop.sopRuns, 1);
  assert.equal(m.byClass.sop.targetLoaded, 1);
  assert.equal(m.byClass.sop.targetAttempted, 2);
  assert.equal(m.byClass.sop.bytesMean, 1333.3333333333333);
  assert.equal(m.byClass.sop.bytesMedian, 1000);
  assert.equal(m.byClass.sop.callsFailed, 1);
  assert.equal(m.byClass.orchestration.targetRuns, 0, 'an agent target is not counted');
  assert.equal(m.tasks.s1.sopRuns, 1);
  assert.equal(m.tasks.r1.findEmpty, 2);
  assert.equal(m.tasks.r1.targetReachable, 0);
  assert.deepEqual(m.topSkills, [{ name: 'a', loads: 4 }, { name: 'b', loads: 3 }, { name: 'c', loads: 2 }, { name: 'verification', loads: 2 }, { name: 'd', loads: 1 }]);
  assert.equal(m.startup.count, 5);
  assert.equal(sum.arms.vanilla.overall.anySkill, 0);
  assert.deepEqual(sum.arms.vanilla.topSkills, []);
  assert.equal(sum.arms.vanilla.startup.builtin, true);
  assert.equal(summarizeSkills([], {}).recorded, 0);
});

test('renderSkillsMarkdown: class and task tables, top skills, startup bytes and the vanilla note; an empty summary says how to get data', () => {
  const md = renderSkillsMarkdown(summarizeSkills(ROWS, { armOrder: ['vanilla', 'main'], startup: { main: { count: 5, totalBytes: 9000, unknownSizes: 2 }, vanilla: { builtin: true } } }));
  assert.match(md, /^## Skills actually used/);
  assert.match(md, /### By task class/);
  assert.match(md, /### By task/);
  assert.match(md, /### Top skills by load count/);
  assert.match(md, /\| main \| sop \| 3 \| 67% \(2\/3\) \| 33% \(1\/3\) \| 33% \(1\/3\); tried 2 \| 1,333 \/ 1,000 \| 1 \|/);
  assert.match(md, /a \(4\), b \(3\), c \(2\), verification \(2\), d \(1\)/);
  assert.match(md, /5 entries, 9,000 B, 2 unsized/);
  assert.match(md, /n\/a \(built-in agent\)/);
  assert.match(md, /Vanilla arms \(vanilla\) install no konductor skills/);
  assert.match(md, /1 run\(s\) have no skill fields/);
  assert.match(renderSkillsMarkdown(summarizeSkills([], {})), /No run recorded skill fields.*bench\.js skills --run DIR/s);
  assert.equal(/[\u2013\u2014]/.test(md), false, 'no en or em dashes in generated text');
});

const WITH = {
  skillsLoaded: [sk('verification')], skillQueries: [], sopsLoaded: [], skillBytesLoaded: 1200, skillCallsFailed: 0, findSkillsCalls: 0, findSkillsEmpty: 0,
  startupResourceCount: 5, targetLoaded: null, targetAttempted: null, targetReachable: null, sopNameSource: 'convention', skillsScope: 'all-sessions',
};

test('report: runs without skill fields keep the report as it was; runs with them add the section at the end', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const old = makeRun(path.join(root, 'old'), bench, [{ arm: 'vanilla', rep: 1 }, { arm: 'k', rep: 1 }]);
    const o = buildReport({ run: loadRun(old), tasks: loadTasks(bench) });
    assert.equal('skills' in o.report, false);
    assert.equal(renderMarkdown(o.report).includes('Skills actually used'), false);

    const cur = makeRun(path.join(root, 'cur'), bench, [{ arm: 'vanilla', rep: 1, ...fields() }, { arm: 'k', rep: 1, ...WITH }], {
      armIds: ['vanilla', 'k'], arms: [{ id: 'k', startupResources: { builtin: false, count: 5, totalBytes: 7000, unknownSizes: 1 } }],
    });
    const c = buildReport({ run: loadRun(cur), tasks: loadTasks(bench) });
    assert.equal(c.report.skills.recorded, 2);
    assert.equal(c.report.skills.arms.k.overall.anySkill, 1);
    assert.equal(c.report.skills.arms.k.startup.totalBytes, 7000);
    const md = renderMarkdown(c.report);
    assert.ok(md.indexOf('## Results') < md.indexOf('## Skills actually used'));
    assert.match(md, /5 entries, 7,000 B, 1 unsized/);
    const { skills: _skills, ...withoutSkills } = c.report;
    assert.ok(md.startsWith(renderMarkdown(withoutSkills)), 'the section is only appended to the existing report');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p).update(fs.readFileSync(p)).update(String(fs.statSync(p).mtimeMs));
    }
  };
  walk(dir);
  return h.digest('hex');
}

const getSkill = (id, name, out) => [
  { type: 'sessionUpdate', data: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: { name }, _meta: { kiro: { toolName: 'get_skill', mcpServerName: 'konductor-skills' } } } } },
  { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { items: [{ Json: { content: [{ type: 'text', text: out }], isError: false } }] } } } },
].map((e) => JSON.stringify(e)).join('\n');

function makeSkillsRun(root) {
  const bench = makeBench(path.join(root, 'bench'), { cls: 'sop' });
  const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, target: 'verification' }));
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'skills/verification/SKILL.md'), '---\nname: verification\n---\n');
  write(path.join(repo, 'agent-sops/k-verify.sop.md'), 'sop');
  write(path.join(repo, 'agents/konductor.agent-spec.json'), '{}');
  const run = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', rep: 1 }, { arm: 'main', rep: 1 }], { armIds: ['vanilla', 'main'] });
  const stream = fs.readFileSync(path.join(FX, 'kiro-find-skills.stream.jsonl'), 'utf8') + getSkill('g1', 'verification', 'x'.repeat(40)) + '\n';
  write(path.join(run, 'main/t1/1/stream.jsonl'), stream);
  write(path.join(run, 'main/t1/1/installed-agent.json'), fs.readFileSync(path.join(FX, 'kiro-main-installed-agent.json'), 'utf8'));
  write(path.join(run, 'main/t1/2/stream.jsonl'), stream);
  return { bench, repo, run };
}

test('skills command: recomputes from stream.jsonl, skips runs still in progress, and writes nothing', () => {
  const root = tmp();
  try {
    const { bench, repo, run } = makeSkillsRun(root);
    const before = treeHash(run);
    const r = spawnSync('node', [BENCH_JS, 'skills', '--run', run, '--bench-dir', bench, '--repo-root', repo], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Skills actually used/);
    assert.match(r.stdout, /2 finished run\(s\), 1 without result\.json \(in progress\) left out/);
    assert.match(r.stdout, /\| main \| overall \| 1 \| 100% \(1\/1\) \| 0% \(0\/1\) \| 100% \(1\/1\)/);
    assert.match(r.stdout, /verification \(1\)/);
    assert.match(r.stdout, /\| 1\/1 \|/, 'one find_skills call, empty');
    assert.match(r.stdout, /vanilla/);
    assert.equal(treeHash(run), before, 'the run directory is byte and mtime identical afterwards');
    assert.equal(fs.existsSync(path.join(run, 'main/t1/1/result.json')), true);

    const j = spawnSync('node', [BENCH_JS, 'skills', '--run', run, '--bench-dir', bench, '--repo-root', repo, '--json'], { encoding: 'utf8' });
    const parsed = JSON.parse(j.stdout);
    assert.equal(parsed.inProgress, 1);
    assert.equal(parsed.arms.main.tasks.t1.targetLoaded, 1);
    assert.equal(parsed.arms.main.startup.count, 5, 'startup resources come from the arm installed-agent.json');
    assert.equal(parsed.arms.vanilla.startup.builtin, true);

    const bad = spawnSync('node', [BENCH_JS, 'skills', '--run', path.join(root, 'missing')], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectRows works without a repo listing and without a task file: convention names, unknown class', () => {
  const root = tmp();
  try {
    const { run } = makeSkillsRun(root);
    const { rows } = collectRows(run, { tasks: new Map(), repoRoot: null });
    const main = rows.find((r) => r.armId === 'main' && r.complete);
    assert.equal(main.taskClass, 'unknown');
    assert.equal(main.fields.sopNameSource, 'agent-filter');
    assert.equal(main.fields.targetLoaded, null);
    const van = rows.find((r) => r.armId === 'vanilla');
    assert.deepEqual(van.fields.skillsLoaded, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('armRecords: konductor arms carry the trial-install startup record, vanilla the best-effort built-in one', () => {
  const startup = { runtime: 'kiro-cli', builtin: false, count: 5, totalBytes: 100 };
  const prepared = new Map([['main', { skillInfo: { startup, catalog: { sopSource: 'listing' } }, mcpSha256: 'x' }]]);
  const recs = armRecords([{ id: 'vanilla', vanilla: true, runtime: 'kiro-cli', warnings: [] }, { id: 'main', vanilla: false, warnings: [] }, { id: 'v1', vanilla: false, warnings: [] }], prepared, new Map());
  assert.equal(recs[0].startupResources.builtin, true);
  assert.equal(recs[0].startupResources.count, null);
  assert.deepEqual(recs[1].startupResources, startup);
  assert.equal(recs[1].sopNameSource, 'listing');
  assert.equal(recs[2].startupResources, null);
});

test('harness wiring: kiro and opencode parseResult capture skills from their streams and survive a broken one', () => {
  const root = tmp();
  try {
    const info = { catalog: null, startup: { count: 3 } };
    const ctx = { skillInfo: new Map([['main', info], ['oc-main', info]]), opencode: { bin: path.join(root, 'no-such-opencode') } };
    const k = path.join(root, 'k');
    write(path.join(k, 'stream.jsonl'), fs.readFileSync(path.join(FX, 'kiro-find-skills.stream.jsonl'), 'utf8') + getSkill('g1', 'verification', 'body') + '\n');
    const accK = { meta: { flags: [] } };
    kiro.parseResult(k, { home: path.join(root, 'home'), acc: accK, arm: { id: 'main', vanilla: false }, ctx });
    assert.deepEqual(accK.skills.extraction.skillsLoaded, [{ name: 'verification', via: 'get_skill', count: 1 }]);
    assert.equal(accK.skills.info, info);
    const accV = { meta: { flags: [] } };
    kiro.parseResult(k, { home: path.join(root, 'home'), acc: accV, arm: { id: 'vanilla', vanilla: true }, ctx });
    assert.equal(accV.skills.info, null, 'vanilla has no per-arm info');

    const o = path.join(root, 'o');
    fs.mkdirSync(o);
    fs.copyFileSync(path.join(FX, 'opencode-skill.stream.jsonl'), path.join(o, 'stream.jsonl'));
    const accO = { meta: { flags: [] } };
    oc.parseResult(o, { home: path.join(root, 'home'), tmpdir: path.join(root, 'tmp'), acc: accO, arm: { id: 'oc-main', vanilla: false }, ctx, config: { model: 'm', effort: 'high' } });
    assert.deepEqual(accO.skills.extraction.skillsLoaded.map((s) => s.name), ['backend-review', 'sop-k-verify']);

    const broken = path.join(root, 'b');
    write(path.join(broken, 'stream.jsonl'), 'not json\n{"type":"sessionUpdate"}\n');
    const accB = { meta: { flags: [] } };
    kiro.parseResult(broken, { home: path.join(root, 'home'), acc: accB, arm: { id: 'main', vanilla: false }, ctx });
    assert.deepEqual(accB.skills.extraction.skillsLoaded, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a vanilla kiro run through executeRun records empty skill fields and passes the schema', async () => {
  const root = tmp();
  const prevPath = process.env.PATH;
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(path.join(root, 'bin'), { dir: probe });
    fs.writeFileSync(path.join(root, 'data.sqlite3'), 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    const watch = path.join(root, 'watch');
    fs.mkdirSync(scratchDir);
    fs.mkdirSync(watch);
    const ctx = {
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb: path.join(root, 'data.sqlite3'), envKeep: [],
      envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null }, isolation: { mode: 'none' },
      tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    };
    process.env.PATH = `${path.join(root, 'bin')}${path.delimiter}${prevPath}`;
    const arm = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
    const r = await executeRun({ arm, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir: path.join(root, 'out', 't1') });
    assert.equal(r.status, 'success');
    assert.deepEqual(r.skillsLoaded, []);
    assert.deepEqual(r.sopsLoaded, []);
    assert.equal(r.skillBytesLoaded, 0);
    assert.equal(r.targetLoaded, null);
    assert.equal(r.startupResourceCount, null);
    assert.equal(r.skillsScope, 'all-sessions');
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'out/t1/result.json'), 'utf8'));
    assert.deepEqual(onDisk.skillsLoaded, []);
    assert.equal(onDisk.error, null);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extraction and field building never mutate their inputs', () => {
  const events = fs.readFileSync(path.join(FX, 'kiro-find-skills.stream.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const frozen = JSON.stringify(events);
  resultFields({ extraction: extractSkills(events, 'kiro-cli'), info: null, task: { target: 'x', class: 'sop' }, arm: { vanilla: false } });
  assert.equal(JSON.stringify(events), frozen);
});
