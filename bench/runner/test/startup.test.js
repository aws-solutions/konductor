// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startupRecord } = require('../lib/startup.js');
const { mkScratch } = require('./scratch.js');

function scratch(t) {
  const root = mkScratch('startup-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = { realHome: path.join(root, 'real'), home: path.join(root, 'run', 'home'), cwd: path.join(root, 'run', 'work') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return dirs;
}
const put = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body)); };

test('a vanilla Kiro arm in an empty scratch HOME starts the built-in default agent with no MCP server, steering or skill', (t) => {
  const d = scratch(t);
  for (const sub of ['agents', 'steering', 'skills']) fs.mkdirSync(path.join(d.home, '.kiro', sub), { recursive: true });
  const r = startupRecord({ runtime: 'kiro-cli', arm: { vanilla: true, agent: null }, ...d });
  assert.equal(r.agent, 'kiro_default');
  assert.equal(r.agentSource, 'built-in default');
  assert.deepEqual(r.mcpServers, []);
  assert.deepEqual(r.steering, []);
  assert.equal(r.skills, 0);
  assert.equal(r.homeIsolated, true);
  assert.deepEqual(r.realHomeLinks, []);
});

test('a Kiro default agent set in settings, the agent file servers and steering are all recorded', (t) => {
  const d = scratch(t);
  put(path.join(d.home, '.kiro/settings/cli.json'), { 'chat.defaultAgent': 'amzn-builder' });
  put(path.join(d.home, '.kiro/agents/konductor.json'), { mcpServers: { 'skill-lookup': {} } });
  put(path.join(d.home, '.kiro/steering/a.md'), 'x');
  put(path.join(d.home, '.kiro/skills/s1/SKILL.md'), 'x');
  assert.equal(startupRecord({ runtime: 'kiro-cli', arm: { vanilla: true }, ...d }).agent, 'amzn-builder');
  const r = startupRecord({ runtime: 'kiro-cli', arm: { vanilla: false, agent: 'konductor' }, ...d });
  assert.equal(r.agent, 'konductor');
  assert.deepEqual(r.mcpServers, [{ name: 'skill-lookup', source: '~/.kiro/agents/konductor.json' }]);
  assert.deepEqual(r.steering, ['~/.kiro/steering/a.md']);
  assert.equal(r.skills, 1);
});

test('a link from the run into the real ~/.kiro is caught, and the real home as HOME is not isolated', (t) => {
  const d = scratch(t);
  put(path.join(d.realHome, '.kiro/steering/rule.md'), 'x');
  fs.mkdirSync(path.join(d.home, '.kiro'), { recursive: true });
  fs.symlinkSync(path.join(d.realHome, '.kiro/steering'), path.join(d.home, '.kiro/steering'));
  const r = startupRecord({ runtime: 'kiro-cli', arm: { vanilla: true }, ...d });
  assert.equal(r.realHomeLinks.length, 1);
  assert.equal(r.realHomeLinks[0].link, '~/.kiro/steering');
  assert.equal(startupRecord({ runtime: 'kiro-cli', arm: { vanilla: true }, ...d, home: d.realHome }).homeIsolated, false);
  assert.equal(startupRecord({ runtime: 'kiro-cli', arm: { vanilla: true }, ...d, home: path.join(d.realHome, '.kiro', 'h') }).homeIsolated, false);
  assert.equal(startupRecord({ runtime: 'kiro-cli', arm: { vanilla: true }, ...d, home: path.join(d.realHome, 'scratch', 'h') }).homeIsolated, true);
});

test('Claude Code with --strict-mcp-config loads no MCP server and lists the declared ones as ignored', (t) => {
  const d = scratch(t);
  put(path.join(d.cwd, '.mcp.json'), { mcpServers: { builder: {} } });
  put(path.join(d.home, '.claude/rules/empty.md'), '');
  put(path.join(d.home, '.claude/skills/k1/SKILL.md'), 'x');
  const strict = startupRecord({ runtime: 'claude-code', arm: { vanilla: false, agent: 'konductor' }, ...d, strictMcp: true });
  assert.equal(strict.agent, 'konductor');
  assert.deepEqual(strict.mcpServers, []);
  assert.deepEqual(strict.mcpIgnored, [{ name: 'builder', source: './.mcp.json' }]);
  assert.deepEqual(strict.steering, ['~/.claude/rules/empty.md']);
  assert.equal(strict.skills, 1);
  const loose = startupRecord({ runtime: 'claude-code', arm: { vanilla: true }, ...d });
  assert.equal(loose.agent, 'default');
  assert.deepEqual(loose.mcpServers.map((s) => s.name), ['builder']);
});

test('startup.json records the konductor skills each runtime serves, and the cap variant a dir arm was built as', (t) => {
  const d = scratch(t);
  put(path.join(d.home, '.konductor/skills/alpha/SKILL.md'), 'x');
  put(path.join(d.home, '.claude/skills/beta/SKILL.md'), 'x');
  put(path.join(d.home, '.claude/skills/gamma/SKILL.md'), 'x');
  put(path.join(d.home, '.claude/skills/sop-k-plan/SKILL.md'), 'x');
  put(path.join(d.home, '.kiro/skills/sop-k-plan/SKILL.md'), 'x');
  put(path.join(d.home, '.kiro/skills/sop-k-verify/SKILL.md'), 'x');
  assert.deepEqual(startupRecord({ runtime: 'kiro-cli', arm: { vanilla: false, agent: 'konductor' }, ...d }).konductorSkills, { skills: 1, sops: 2 });
  assert.deepEqual(startupRecord({ runtime: 'claude-code', arm: { vanilla: false, agent: 'konductor' }, ...d }).konductorSkills, { skills: 2, sops: 1 });
  const root = path.join(d.home, '..', 'variant');
  put(path.join(root, 'variant.json'), { variantId: 'noskills', armName: 'konductor-noskills', base: { commitSha: 'abc' }, ops: [{ op: 'preset', id: 'noskills' }], variantHash: 'h' });
  const r = startupRecord({ runtime: 'kiro-cli', arm: { vanilla: false, agent: 'konductor', dir: path.join(root, 'tree') }, ...d });
  assert.deepEqual(r.variant, { variantId: 'noskills', armName: 'konductor-noskills', base: 'abc', ops: ['preset noskills'], variantHash: 'h' });
  assert.equal(startupRecord({ runtime: 'kiro-cli', arm: { vanilla: true }, ...d }).variant, null);
});
