// SPDX-License-Identifier: Apache-2.0
'use strict';

// Synthetic repo, bench dir, run directories and stream fixtures for the prune-report tests. Nothing here calls a model.
//   used      konductor lists it
//   idle      konductor lists it, never loaded in the fixtures
//   pref      konductor lists it, registry class preference
//   harmful   konductor lists it (evidence says hurts)
//   helped    konductor lists it (evidence says helps)
//   orphan    listed by no agent, no sign of another harness
//   claudey   listed by no agent, listed in the konductor claudeCli skills, description names Claude Code
//   devonly   k-dev lists it
//   big       konductor lists it, far larger than the others
//   twina/twinb  konductor lists them, near-identical descriptions

const fs = require('node:fs');
const path = require('node:path');
const { write } = require('./helpers.js');
const { makeCapRepo, makeCapBench, writeEntry, entry, scratch, spec } = require('./cap-helpers.js');

const SKILLS = {
  used: 'Use when tracing request lifecycles through gateways and caches. Maps hops and timeouts.',
  idle: 'Use when reconciling ledger exports against bank statements. Flags unmatched rows.',
  pref: 'Use when formatting changelog entries in house style. Normalises headings and dates.',
  harmful: 'Use when drafting migration runbooks for sharded databases. Lists cutover checkpoints.',
  helped: 'Use when profiling slow startup paths in command line tools. Reports hot imports.',
  orphan: 'Use when cataloguing legacy cron jobs. Records owners and schedules.',
  claudey: 'Use when running Claude Code agent teams. Loaded only in Claude Code sessions.',
  devonly: 'Use when sizing message queue partitions for batch consumers. Estimates throughput.',
  twina: 'Use when reviewing database schema migrations for locking hazards. Checks index builds, column defaults and rollback order.',
  twinb: 'Use when reviewing database schema migrations for locking hazards. Checks index builds, column defaults and rollback plans.',
};

function pruneFiles(repo) {
  for (const [name, desc] of Object.entries(SKILLS)) {
    write(path.join(repo, `skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nSteps for ${name}.\n`);
  }
  write(path.join(repo, 'skills/big/SKILL.md'), `---\nname: big\ndescription: Use when writing exhaustive compliance matrices. Produces long tables.\n---\n\n# big\n\n${'Detail line for the matrix.\n'.repeat(900)}`);
  write(path.join(repo, 'context/core.md'), '# Core\n\nRules.\n');
  const j = (o) => `${JSON.stringify(o, null, 2)}\n`;
  const konductorSkills = ['used', 'idle', 'pref', 'harmful', 'helped', 'big', 'twina', 'twinb'];
  write(path.join(repo, 'agents/konductor.agent-spec.json'), j(spec('konductor', { skills: konductorSkills, contexts: ['core.md'], subagents: ['k-dev'], claudeSkills: [...konductorSkills, 'claudey'] })));
  write(path.join(repo, 'agents/k-dev.agent-spec.json'), j(spec('k-dev', { skills: ['devonly'], contexts: ['core.md'] })));
}

function makeEnv(entries = []) {
  const root = scratch();
  const r = makeCapRepo(root, { files: pruneFiles });
  const bench = makeCapBench(root);
  for (const e of entries) writeEntry(bench, e);
  const home = path.join(root, 'h');
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(home);
  fs.mkdirSync(tmpdir);
  return { root, repo: r.repo, bench, home, tmpdir, git: r.git, sha: r.sha, runsDir: path.join(root, 'runs'), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const prefEntry = () => entry({ id: 'skill:pref', path: 'skills/pref/SKILL.md', owner: 'konductor', class: 'preference', tasks: { lift: [], trigger: [], headroom: {} }, expect: { 'kiro-cli': { tool: 'get_skill', actingAgents: ['konductor'] }, opencode: { tool: 'skill' } } });

// ---- streams ----

const call = (id, tool, input, { server = 'konductor-skills', sid = 's1' } = {}) => ({
  type: 'sessionUpdate',
  data: { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: input, _meta: { kiro: { toolName: tool, mcpServerName: server } } } },
});
const done = (id, rawOutput) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput } } });
const skillOut = (name, size) => ({ items: [{ Json: { content: [{ type: 'text', text: JSON.stringify({ name, content: `# ${name}\n${'x'.repeat(size)}` }) }], isError: false } }] });

function kiroEvents({ loads = [], delegate = [], unnamedDelegate = 0, tag = '' }) {
  const ev = [];
  let n = 0;
  for (const l of loads) {
    const { name, bytes = 100, times = 1 } = typeof l === 'string' ? { name: l } : l;
    for (let i = 0; i < times; i++) { const id = `g${n++}`; ev.push(call(id, 'get_skill', { name }), done(id, skillOut(name, bytes))); }
  }
  for (const role of delegate) ev.push(call(`s${n++}`, 'subagent', { role, task: 'work' }, { server: 'builtin' }));
  for (let i = 0; i < unnamedDelegate; i++) ev.push(call(`u${n++}`, 'subagent', { task: 'work' }, { server: 'builtin' }));
  ev.push({ type: 'runFinished', data: { status: 'success', finalText: `done ${tag}` } });
  return ev;
}

function opencodeEvents({ loads = [], tag = '' }) {
  const ev = loads.map((name, i) => ({ type: 'tool_use', part: { tool: 'skill', callID: `c${i}`, state: { status: 'completed', input: { name }, output: `# ${name}\n${'y'.repeat(120)}` } } }));
  ev.push({ type: 'text', part: { text: `done ${tag}` } });
  return ev;
}

const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

/**
 * Writes a run directory. arms: [{ id, ref, sha, label }] (ref null is vanilla).
 * runs: [{ arm, task, rep, agent, loads, delegate, unnamedDelegate, filter, infraError, noStream, noResult, harness, credits, wallClockMs, model, armConfig, status }].
 * filter: the installed agent's --skill-name-filter list; undefined writes no installed-agent.json. installedAs names the agent that file
 * claims to be (default: the entry agent); runs saved before the entry agent's own file was kept hold konductor's whatever agent started them.
 */
function makeRunDir(dir, { arms, runs, config = true }) {
  if (config) {
    write(path.join(dir, 'run-config.json'), JSON.stringify({ suite: 'lite', armIds: arms.map((a) => a.id), arms: arms.map((a) => ({ id: a.id, label: a.label ?? a.id, ref: a.ref ?? null, commitSha: a.sha ?? null })) }));
  }
  runs.forEach((r, i) => {
    const arm = arms.find((a) => a.id === r.arm);
    const { task = 't1', rep = 1, agent = 'konductor', harness = 'kiro-cli' } = r;
    const rd = path.join(dir, r.arm, task, String(rep));
    fs.mkdirSync(rd, { recursive: true });
    if (!r.noResult) {
      write(path.join(rd, 'result.json'), JSON.stringify({
        armId: r.arm, armLabel: arm?.label ?? r.arm, ref: arm?.ref ?? null, commitSha: arm?.sha ?? null, harness: harness === 'opencode' ? 'opencode' : 'kiro-cli-v2',
        agent, taskId: task, replicate: rep, status: r.status ?? 'success', infraError: r.infraError ?? null,
        ...(r.credits !== undefined ? { credits: r.credits } : {}), ...(r.wallClockMs !== undefined ? { wallClockMs: r.wallClockMs } : {}), ...(r.model ? { model: r.model } : {}), ...(r.armConfig ? { armConfig: r.armConfig } : {}), ...(r.checks ? { checks: r.checks } : {}), ...(r.hiddenTests ? { hiddenTests: r.hiddenTests } : {}),
      }));
    }
    if (!r.noStream) {
      const tag = `${path.basename(dir)}/${r.arm}/${task}/${rep}/${i}`;
      write(path.join(rd, 'stream.jsonl'), jsonl(harness === 'opencode' ? opencodeEvents({ loads: r.loads, tag }) : kiroEvents({ ...r, tag })));
    }
    if (r.filter !== undefined) {
      write(path.join(rd, 'installed-agent.json'), JSON.stringify({ name: r.installedAs ?? agent, mcpServers: { 'konductor-skills': { command: 'x', args: ['--skill-name-filter', r.filter.join(','), '--agent-sop-filter', 'k-plan'] } } }));
    }
  });
  return dir;
}

const V1 = { id: 'v1', label: 'v1', ref: 'v0', sha: '4430696d98aafa46f1c992c5fb0ca3479259ccd9' };
const V2 = { id: 'v2', label: 'v2', ref: 'origin/main', sha: '7428dd940fea7860e7b7df60fc058608c2953f50' };
const VAN = { id: 'vanilla', label: 'vanilla', ref: null };

module.exports = { makeEnv, pruneFiles, prefEntry, makeRunDir, kiroEvents, opencodeEvents, V1, V2, VAN, call, done, skillOut, jsonl };
