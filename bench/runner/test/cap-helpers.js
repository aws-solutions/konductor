// SPDX-License-Identifier: Apache-2.0
'use strict';

// A small konductor-shaped git repo for the cap tests: skills, SOPs, context files and agent specs, committed and tagged.
// Layout facts the tests rely on:
//   alpha   plain description with a "use when" cue, listed by konductor and k-dev
//   beta    folded description, listed by k-dev only
//   gamma   no description, listed by nobody
//   delta   near duplicate of alpha, listed by konductor only
//   ghost   listed by k-dev but has no directory
//   k-plan  SOP listed by konductor; k-orphan is listed by nobody
//   core.md listed by both agents, routing.md by konductor only

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { write } = require('./helpers.js');

const git = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

const ALPHA_DESC = 'Use when reviewing backend code for input handling and injection risks. Checks validation, escaping and error paths.';

const skillMd = (name, desc, body = `# ${name}\n\nSteps for ${name}.\n`, extra = '') => `---\nname: ${name}\n${desc}\n${extra}---\n\n${body}`;

const spec = (name, { skills = [], sops = [], contexts = [], subagents = [], claudeSkills = [], prompt = `You are ${name}.` }) => ({
  schemaVersion: '1',
  name,
  config: { description: `Agent ${name}.`, systemPrompt: prompt, model: 'claude-sonnet-5.5' },
  dependencies: {
    skills: { skillNames: skills },
    agentSops: { agentSopNames: sops },
    context: { contextNames: contexts },
    ...(subagents.length ? { subagents: { agentNames: subagents } } : {}),
  },
  clientConfig: { kiroCli: { toolsSettings: { subagent: { availableAgents: subagents } }, resources: ['file://AGENTS.md', 'skill://.kiro/skills/ws-*/SKILL.md'] }, claudeCli: { tools: ['Read'], skills: claudeSkills } },
});

function writeFiles(repo) {
  write(path.join(repo, 'skills/alpha/SKILL.md'), skillMd('alpha', `description: ${ALPHA_DESC}`, '# Alpha\n\nValidate every input. Escape output. Report findings with severity.\n', 'tags: [review, security]\n'));
  write(path.join(repo, 'skills/beta/SKILL.md'), skillMd('beta', 'description: >\n  Plans database migrations step by step. Use for schema changes\n  that need a rollback path.', '# Beta\n\nWrite the migration. Write the rollback.\n'));
  write(path.join(repo, 'skills/gamma/SKILL.md'), '---\nname: gamma\n---\n\n# Gamma\n\nSee the `alpha` skill for review.\n');
  write(path.join(repo, 'skills/delta/SKILL.md'), skillMd('delta', 'description: Use when reviewing backend code for input handling and injection hazards. Checks validation, escaping and error handling.', '# Delta\n\nLoad the `alpha` skill first.\n'));
  write(path.join(repo, 'agent-sops/k-plan.sop.md'), '# Plan\n\n## Overview\n\nThis SOP breaks work into steps. Use it before any non-trivial change.\n\n## Parameters\n\n- **objective** (required): goal\n');
  write(path.join(repo, 'agent-sops/k-orphan.sop.md'), '# Orphan\n\n## Overview\n\nNobody lists this SOP.\n');
  write(path.join(repo, 'context/core.md'), '# Core rules\n\nNever skip tests.\n');
  write(path.join(repo, 'context/routing.md'), '# Routing\n\nFor planning, run the k-plan SOP. Delegate to k-dev.\n');
  const j = (o) => `${JSON.stringify(o, null, 2)}\n`;
  write(path.join(repo, 'agents/konductor.agent-spec.json'), j(spec('konductor', { skills: ['alpha', 'delta'], sops: ['k-plan'], contexts: ['routing.md', 'core.md'], subagents: ['k-dev'], claudeSkills: ['alpha', 'delta'], prompt: 'Orchestrate. Use the alpha skill when needed.' })));
  write(path.join(repo, 'agents/k-dev.agent-spec.json'), j(spec('k-dev', { skills: ['alpha', 'beta', 'ghost'], contexts: ['core.md'] })));
}

function makeCapRepo(root, { files = writeFiles, tag = 'v0' } = {}) {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  files(repo);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  if (tag) git(repo, 'tag', tag);
  return { repo, sha: git(repo, 'rev-parse', 'HEAD'), git: (...a) => git(repo, ...a) };
}

// A bench dir with one hard-ish task (hidden tests) and one rubric-only task, plus an empty capabilities dir.
function makeCapBench(root) {
  const bench = path.join(root, 'bench');
  write(path.join(bench, 'fixtures/fx/a.txt'), 'alpha\n');
  const base = { class: 'review', target: null, fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], tiers: ['lite'] };
  const rubric = [{ id: 'c1', criterion: 'Does it.', weight: 1 }];
  const tasks = {
    'rev-one': { ...base, id: 'rev-one', prompt: 'Review the service for problems and write review.md.', rubric },
    'hid-one': { ...base, id: 'hid-one', class: 'hard', prompt: 'Make the endpoint reject bad input.', rubric: [], hidden: 'hid-one', checks: [{ type: 'tests', path: 'hid' }] },
    'rx-one': { ...base, id: 'rx-one', prompt: 'Write notes.md.', rubric: [], checks: [{ type: 'contains', path: 'notes.md', pattern: 'x' }] },
  };
  for (const t of Object.values(tasks)) write(path.join(bench, `tasks/${t.id}.json`), JSON.stringify(t));
  write(path.join(bench, 'tasks/hidden/hid-one/t.test.js'), 'test\n');
  fs.mkdirSync(path.join(bench, 'capabilities'), { recursive: true });
  return bench;
}

const entry = (over = {}) => ({
  id: 'skill:alpha',
  kind: 'skill',
  path: 'skills/alpha/SKILL.md',
  owner: 'k-dev',
  tasks: { lift: ['rev-one'], trigger: [], headroom: {} },
  trigger: { gen: 1, queries: [] },
  expect: { 'kiro-cli': { tool: 'get_skill', actingAgents: ['k-dev'] }, opencode: { tool: 'skill' } },
  notes: '',
  ...over,
});

const writeEntry = (bench, e) => {
  const [kind, name] = e.id.split(':');
  const file = path.join(bench, 'capabilities', kind, `${name}.json`);
  write(file, `${JSON.stringify(e, null, 2)}\n`);
  return file;
};

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'captest-'));

module.exports = { makeCapRepo, makeCapBench, entry, writeEntry, writeFiles, scratch, git, spec, ALPHA_DESC };
