// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const cl = require('../../scripts/canary-layers.js');
const report = require('../../report/canary-layers.js');
const { loadTasks, loadSuite, suiteExtraDirs, BENCH_DIR, SUITE_NAMES } = require('../lib/tasks.js');

function writeTree(dir) {
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  w('context/k-core-rules.md', '# Core\n');
  w('context/k-orchestrator-routing-rules.md', '# Routing\n');
  w('skills/workspace-skills/SKILL.md', '---\nname: workspace-skills\ndescription: Capture procedures\n---\n\nBody A\n');
  w('skills/humanize-writing/SKILL.md', '---\nname: humanize-writing\ndescription: Plain prose\n---\n\nBody B\n');
  w('agent-sops/k-plan.sop.md', '# Plan\n');
  w('agents/konductor.agent-spec.json', JSON.stringify({
    name: 'konductor', config: { systemPrompt: '# Orchestrator\n' },
    dependencies: { skills: { skillNames: ['workspace-skills', 'humanize-writing'] }, agentSops: { agentSopNames: ['k-plan'] }, context: { contextNames: ['k-orchestrator-routing-rules.md', 'k-core-rules.md'] } },
  }));
  w('agents/k-tpm.agent-spec.json', JSON.stringify({
    name: 'k-tpm', config: { systemPrompt: '# TPM\n' },
    dependencies: { skills: { skillNames: ['humanize-writing'] }, agentSops: { agentSopNames: [] }, context: { contextNames: ['k-core-rules.md'] } },
  }));
}

const opts = { sops: ['k-plan'] };

test('applyLayers adds one distinct token per layer, each at its own site', () => {
  const dir = tmp();
  writeTree(dir);
  const { tokens } = cl.applyLayers(dir, opts);
  assert.deepEqual(Object.keys(tokens), cl.LAYERS);
  assert.equal(new Set(Object.values(tokens)).size, cl.LAYERS.length);
  for (const [layer, t] of Object.entries(tokens)) assert.match(t, new RegExp(`^kd-cl-${layer}-[0-9a-f]{8}$`));
  const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  assert.ok(read('context/k-core-rules.md').includes(tokens.rules));
  assert.ok(read('context/k-orchestrator-routing-rules.md').includes(tokens.ctx));
  assert.ok(read('agent-sops/k-plan.sop.md').includes(tokens.sop));
  assert.ok(read('skills/humanize-writing/SKILL.md').includes(tokens.skill));
  assert.match(read('skills/workspace-skills/SKILL.md'), new RegExp(`^description: Capture procedures \\(marker ${tokens.index}\\)$`, 'm'));
  assert.ok(!read('skills/workspace-skills/SKILL.md').split('\n').slice(5).join('\n').includes(tokens.index), 'the index token is in the description only, not the body');
  for (const f of ['konductor', 'k-tpm']) assert.ok(JSON.parse(read(`agents/${f}.agent-spec.json`)).config.systemPrompt.includes(tokens.prompt));
  for (const [layer, t] of Object.entries(tokens)) {
    const hits = ['context/k-core-rules.md', 'context/k-orchestrator-routing-rules.md', 'skills/workspace-skills/SKILL.md', 'skills/humanize-writing/SKILL.md', 'agent-sops/k-plan.sop.md', 'agents/konductor.agent-spec.json']
      .filter((f) => read(f).includes(t));
    assert.ok(hits.length >= 1, layer);
    if (layer !== 'prompt') assert.equal(hits.length, 1, `${layer} appears in exactly one file`);
  }
});

test('applyLayers keeps given tokens and rejects equal index and body skills and unknown SOPs', () => {
  const dir = tmp();
  writeTree(dir);
  const keep = { rules: 'kd-cl-rules-00000001' };
  assert.equal(cl.applyLayers(dir, { ...opts, tokens: keep }).tokens.rules, keep.rules);
  const d2 = tmp();
  writeTree(d2);
  assert.throws(() => cl.applyLayers(d2, { ...opts, indexSkill: 'humanize-writing' }), /must differ/);
  assert.throws(() => cl.applyLayers(d2, { sops: ['k-nope'] }), /k-nope/);
});

test('expectedDelivery follows what each agent spec declares', () => {
  const dir = tmp();
  writeTree(dir);
  const { expected } = cl.applyLayers(dir, opts);
  assert.deepEqual(expected.konductor, { rules: true, prompt: true, index: true, skill: true, sop: true, ctx: true });
  assert.deepEqual(expected['k-tpm'], { rules: true, prompt: true, index: false, skill: true, sop: false, ctx: false });
});

test('build extracts a ref into the base directory, keeps tokens on rebuild and writes layers.json', () => {
  const repo = tmp();
  writeTree(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'tree');
  const base = tmp();
  const a = cl.build({ repo, ref: 'HEAD', base, ...opts });
  const b = cl.build({ repo, ref: 'HEAD', base, ...opts });
  assert.deepEqual(a.tokens, b.tokens);
  assert.equal(a.spec, `k-layers=dir:${path.join(base, 'layers-src')}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(base, 'layers.json'), 'utf8')).sha, a.sha);
  assert.ok(!fs.readFileSync(path.join(repo, 'context/k-core-rules.md'), 'utf8').includes('kd-cl'), 'the source repository is untouched');
  const cmds = cl.commandsFor(a, { repo, base, agents: ['konductor', 'k-tpm'] });
  assert.ok(!cmds[0].includes('--arm-agent'));
  assert.ok(cmds[1].includes('--arm-agent k-layers=k-tpm'));
  assert.ok(cmds.every((c) => c.includes('--suite canary-layers') && c.includes('--agent-engine v3')));
});

const tokens = Object.fromEntries(cl.LAYERS.map((l) => [l, `kd-cl-${l}-0123abcd`]));

test('scoreEntries separates a tool-result hit from an echo and ignores unrelated text', () => {
  const entries = [
    { kind: 'skill-load', input: { name: 'humanize-writing' }, result: `Body\nDelivery marker: ${tokens.skill}` },
    { kind: 'assistant', text: `I saw ${tokens.rules} in my instructions.` },
    { kind: 'tool', tool: 'fs_write', input: { path: 'a.txt', text: tokens.prompt }, result: 'ok' },
    { kind: 'final', text: 'Tokens: none for the rest' },
  ];
  const s = report.scoreEntries({ entries, tokens });
  assert.deepEqual(s.layers.skill, { toolResult: true, echoed: false, prompt: false, seen: true });
  assert.deepEqual(s.layers.rules, { toolResult: false, echoed: true, prompt: false, seen: true });
  assert.equal(s.layers.prompt.echoed, true, 'a token written by the model counts as an echo');
  for (const l of ['index', 'sop', 'ctx']) assert.equal(s.layers[l].seen, false, l);
  assert.deepEqual(s.forged, []);
});

test('scoreEntries lists a made-up token of the right shape as forged', () => {
  const s = report.scoreEntries({ entries: [{ kind: 'assistant', text: `${tokens.rules} and kd-cl-sop-ffffffff` }], tokens });
  assert.deepEqual(s.forged, ['kd-cl-sop-ffffffff']);
  assert.equal(s.layers.sop.seen, false);
});

test('summarize keeps agents and tasks apart and counts only usable runs', () => {
  const mk = (agent, task, rules, skill) => ({
    usable: true, agent, task, rep: 1, forged: [],
    layers: Object.fromEntries(cl.LAYERS.map((l) => [l, { toolResult: l === 'skill' && skill, echoed: l === 'rules' && rules, prompt: false, seen: (l === 'skill' && skill) || (l === 'rules' && rules) }])),
  });
  const rows = [mk('konductor', 'cl-plain', true, false), mk('konductor', 'cl-plan', true, true), mk('k-tpm', 'cl-plain', false, false), { usable: false, agent: 'k-tpm', task: 'cl-plain', excluded: 'no stream.jsonl' }];
  const sum = report.summarize(rows, { 'k-tpm': { rules: true } });
  assert.equal(sum.usable, 3);
  assert.equal(sum.byAgent.konductor.rules.seen, 2);
  assert.equal(sum.byAgent['k-tpm'].rules.n, 1);
  assert.equal(sum.byAgent['k-tpm'].rules.seen, 0);
  assert.equal(sum.byTask['cl-plan'].skill.toolResult, 1);
  assert.equal(sum.byAgentTask['konductor / cl-plain'].skill.n, 1);
  const md = report.renderMarkdown(sum);
  assert.match(md, /By entry agent and task/);
  assert.match(md, /k-tpm \|.*spec yes/);
});

test('scoreRun excludes a run with no stream instead of throwing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ armId: 'k-layers', taskId: 'cl-plain', agent: 'k-tpm', replicate: 2 }));
  const row = report.scoreRun(dir, { tokens });
  assert.equal(row.usable, false);
  assert.equal(row.agent, 'k-tpm');
  assert.equal(row.excluded, 'no stream.jsonl');
});

test('the canary-layers suite is registered and its tasks load with their fixture', () => {
  assert.ok(SUITE_NAMES.includes('canary-layers'));
  const tasks = loadTasks(BENCH_DIR, { extraDirs: suiteExtraDirs('canary-layers', BENCH_DIR) });
  const suite = loadSuite('canary-layers', tasks, BENCH_DIR);
  assert.deepEqual([...suite.taskIds].sort(), ['cl-plain', 'cl-plan', 'cl-writing']);
  assert.equal(suite.replicates, 3);
  for (const id of suite.taskIds) assert.match(tasks.get(id).prompt, /kd-cl-<word>-<8 hex digits>/);
});
