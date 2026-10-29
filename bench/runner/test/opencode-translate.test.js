// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { parseAgent, translateAgent, translateAll, TOOL_PERMISSIONS } = require('../lib/harness/opencode-translate.js');

const ORCH = `---
name: konductor
description: Orchestrator: delegates "everything" to specialists.
model: claude-sonnet-5.5
tools:
- Workflow
- WebFetch
- Agent(k-developer, k-researcher)
- SendMessage
- Read
- Bash
- Write
- Skill
skills:
- constraints
---

# Konductor

Body line with Agent( and SendMessage mentioned.
`;

const READER = `---
name: k-researcher
description: Reads things.
model: claude-sonnet-5.5
tools:
- Read
- Grep
- mcp__aws-mcp__*
---
Researcher body.
`;

const OPTS = { model: 'amazon-bedrock/global.anthropic.claude-sonnet-5-5', variant: 'high' };

test('parseAgent reads scalars, lists and keeps the body byte for byte', () => {
  const a = parseAgent(ORCH);
  assert.equal(a.fm.name, 'konductor');
  assert.equal(a.fm.description, 'Orchestrator: delegates "everything" to specialists.');
  assert.deepEqual(a.fm.tools, ['Workflow', 'WebFetch', 'Agent(k-developer, k-researcher)', 'SendMessage', 'Read', 'Bash', 'Write', 'Skill']);
  assert.ok(a.body.startsWith('\n# Konductor'));
  assert.throws(() => parseAgent('no frontmatter'), /frontmatter/);
});

test('the orchestrator mirrors its tool list: Write grants edit, Agent(..) restricts task, unlisted tools are denied', () => {
  const t = translateAgent(parseAgent(ORCH), { ...OPTS, primary: 'konductor' });
  assert.equal(t.name, 'konductor');
  assert.deepEqual(t.dropped, ['Workflow', 'SendMessage']);
  const golden = [
    '---',
    'description: "Orchestrator: delegates \\"everything\\" to specialists."',
    'mode: primary',
    'model: amazon-bedrock/global.anthropic.claude-sonnet-5-5',
    'variant: high',
    'permission:',
    '  bash: allow',
    '  codesearch: deny',
    '  edit: allow',
    '  glob: deny',
    '  grep: deny',
    '  list: allow',
    '  lsp: deny',
    '  question: deny',
    '  read: allow',
    '  skill: allow',
    '  task:',
    '    "*": deny',
    '    k-developer: allow',
    '    k-researcher: allow',
    '  todowrite: deny',
    '  webfetch: allow',
    '  websearch: deny',
    '---',
  ].join('\n');
  assert.ok(t.text.startsWith(`${golden}\n`), t.text.split('---')[1]);
  assert.ok(t.text.endsWith('\n# Konductor\n\nBody line with Agent( and SendMessage mentioned.\n'));
});

test('a specialist is a subagent with edit, bash and task denied and the mcp wildcard dropped', () => {
  const t = translateAgent(parseAgent(READER), OPTS);
  assert.match(t.text, /^mode: subagent$/m);
  assert.match(t.text, /^ {2}edit: deny$/m);
  assert.match(t.text, /^ {2}bash: deny$/m);
  assert.match(t.text, /^ {2}task: deny$/m);
  assert.match(t.text, /^ {2}grep: allow$/m);
  assert.deepEqual(t.dropped, ['mcp__aws-mcp__*']);
  assert.equal(t.text.includes('Researcher body.'), true);
});

test('every Claude tool maps to a known permission key', () => {
  assert.deepEqual(Object.keys(TOOL_PERMISSIONS).sort(), ['Agent', 'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Skill', 'TodoWrite', 'WebFetch', 'WebSearch', 'Write']);
});

test('translateAll skips mux and cmux orchestrator variants and non-agent files', () => {
  const src = tmp();
  const dst = path.join(tmp(), 'agents');
  write(path.join(src, 'konductor.md'), ORCH);
  write(path.join(src, 'k-researcher.md'), READER);
  write(path.join(src, 'konductor-mux-orchestrator.md'), ORCH.replace('name: konductor', 'name: konductor-mux-orchestrator'));
  write(path.join(src, 'konductor-cmux-orchestrator.md'), ORCH.replace('name: konductor', 'name: konductor-cmux-orchestrator'));
  write(path.join(src, '_sop_scopes.json'), '{}');
  const r = translateAll(src, dst, OPTS);
  assert.deepEqual(r.agents, ['k-researcher', 'konductor']);
  assert.deepEqual(r.skipped, ['konductor-cmux-orchestrator', 'konductor-mux-orchestrator']);
  assert.deepEqual(fs.readdirSync(dst).sort(), ['k-researcher.md', 'konductor.md']);
});

test('an agent without a tools list is refused rather than silently granted everything', () => {
  assert.throws(() => translateAgent(parseAgent('---\nname: x\ndescription: d\n---\nbody'), OPTS), /no tools list/);
});
