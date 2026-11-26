// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-241: a konductor arm's run HOME follows konductor's Claude Code guide in full (team mode and the guide's
// permissions.allow in settings.json); the vanilla arm's run HOME stays as it was.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { HARNESSES } = require('../lib/harness/index.js');
const cc = HARNESSES['claude-code'];
const { GUIDE_ALLOW, applyTeamMode } = require('../../plugins/claude-code/team-mode.js');

const CANON = 'claude-sonnet-5-5';
const NAMES = ['k-architect', 'k-browser', 'k-developer', 'k-media-analyzer', 'k-product-manager', 'k-quality-assurance', 'k-researcher', 'k-tpm', 'konductor', 'konductor-cmux-orchestrator', 'konductor-mux-orchestrator'];
const HOOKS = { SessionStart: [{ hooks: [{ type: 'command', command: 'konductor hook session-start' }] }] };

// What `konductor install --harness claude` leaves: the agents and a settings.json holding its SessionStart hook.
function stubInstall(home) {
  for (const n of NAMES) write(path.join(home, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\nmodel: ${CANON}\n---\nstub\n`);
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: HOOKS }));
  return 'installed';
}

const ctx = { config: { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: CANON, effort: 'high' }, claude: { version: 'test' }, claudeInstall: stubInstall };

function install(root, arm) {
  const home = path.join(root, 'home');
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  cc.installInto(home, { arm, prepared: {}, ctx, config: ctx.config, outDir: out });
  return { claude: path.join(home, '.claude'), log: fs.readFileSync(path.join(out, 'install.log'), 'utf8') };
}

test('a konductor arm gets team mode and the guide allow list in settings.json, beside the install hook', () => {
  const root = tmp();
  try {
    const { claude, log } = install(root, { vanilla: false, agent: 'konductor' });
    const s = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    assert.deepEqual(s.env, { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' });
    assert.deepEqual(s.permissions.allow, [...GUIDE_ALLOW]);
    assert.deepEqual(s.hooks, HOOKS);
    assert.match(log, /team mode: settings.json env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, permissions.allow 23 entries/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the vanilla arm gets neither: its config directory holds only the empty rules file', () => {
  const root = tmp();
  try {
    const { claude, log } = install(root, { vanilla: true });
    assert.deepEqual(fs.readdirSync(claude), ['rules']);
    assert.deepEqual(fs.readdirSync(path.join(claude, 'rules')), ['empty.md']);
    assert.doesNotMatch(log, /team mode/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The list-hook arm's tree carries the Kiro hook's text as a Claude Code rules file (cap/nudge.js opHook 'list');
// the install copies it into the run HOME's user-level rules, which Claude Code loads at session start
// (https://code.claude.com/docs/en/memory, "User-level rules"). Other konductor arms get the empty file only.
test('a konductor tree with a bench rules file gets it in the run HOME rules, byte for byte; trees without one do not', () => {
  const root = tmp();
  try {
    const text = 'Your skills (load one with get_skill):\nrisk-management, decision-writing\nCheck this list and load a matching skill before you start; say "no skill fits" if none does.\n';
    const exportDir = path.join(root, 'tree');
    write(path.join(exportDir, '.bench-claude-rules', 'skill-list.md'), text);
    const home = path.join(root, 'home'); const out = path.join(root, 'out');
    fs.mkdirSync(out, { recursive: true });
    cc.installInto(home, { arm: { vanilla: false, agent: 'konductor' }, prepared: { exportDir }, ctx, config: ctx.config, outDir: out });
    const rules = path.join(home, '.claude', 'rules');
    assert.deepEqual(fs.readdirSync(rules).sort(), ['empty.md', 'skill-list.md']);
    assert.equal(fs.readFileSync(path.join(rules, 'skill-list.md'), 'utf8'), text);
    assert.match(fs.readFileSync(path.join(out, 'install.log'), 'utf8'), new RegExp(`rules: skill-list.md \\(${Buffer.byteLength(text)} bytes\\)`));

    const plain = path.join(root, 'plain-tree'); fs.mkdirSync(plain, { recursive: true });
    const home2 = path.join(root, 'home2'); const out2 = path.join(root, 'out2'); fs.mkdirSync(out2, { recursive: true });
    cc.installInto(home2, { arm: { vanilla: false, agent: 'konductor' }, prepared: { exportDir: plain }, ctx, config: ctx.config, outDir: out2 });
    assert.deepEqual(fs.readdirSync(path.join(home2, '.claude', 'rules')), ['empty.md']);
    assert.match(fs.readFileSync(path.join(out2, 'install.log'), 'utf8'), /rules: empty.md only/);
    const home3 = path.join(root, 'home3'); const out3 = path.join(root, 'out3'); fs.mkdirSync(out3, { recursive: true });
    cc.installInto(home3, { arm: { vanilla: true }, prepared: { exportDir }, ctx, config: ctx.config, outDir: out3 });
    assert.deepEqual(fs.readdirSync(path.join(home3, '.claude', 'rules')), ['empty.md'], 'the vanilla arm never reads a tree');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the command and environment of both arms are unchanged by team mode', () => {
  const home = '/var/tmp/x/home';
  const c = { claude: { bin: '/b/claude', supportsHookEvents: false }, runBudgetUsd: 1 };
  const k = cc.buildCommand({ arm: { vanilla: false, agent: 'konductor' }, task: { prompt: 'p' }, config: ctx.config, ctx: c, home });
  assert.deepEqual(k.args.slice(k.args.indexOf('--allowedTools')), ['--allowedTools', 'Bash', 'Edit', 'Write', 'Read']);
  for (const vanilla of [true, false]) assert.equal(cc.envSetup({ arm: { vanilla }, ctx: {}, home, baseEnv: {} }).env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, undefined);
});

test('applyTeamMode keeps allow entries already there and refuses a symlinked settings.json', () => {
  const root = tmp();
  try {
    write(path.join(root, 'a', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(make*)', 'Read'] } }));
    applyTeamMode(path.join(root, 'a'));
    const s = JSON.parse(fs.readFileSync(path.join(root, 'a', 'settings.json'), 'utf8'));
    assert.deepEqual(s.permissions.allow, ['Bash(make*)', 'Read', ...GUIDE_ALLOW.filter((x) => x !== 'Read')]);
    write(path.join(root, 'target.json'), '{}');
    fs.mkdirSync(path.join(root, 'b'));
    fs.symlinkSync(path.join(root, 'target.json'), path.join(root, 'b', 'settings.json'));
    assert.throws(() => applyTeamMode(path.join(root, 'b')), /is a symlink/);
    assert.equal(fs.readFileSync(path.join(root, 'target.json'), 'utf8'), '{}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the allow list is the one in konductor\'s Claude Code guide', () => {
  const guide = fs.readFileSync(path.join(__dirname, '../../../docs/user-guide/tasks/install-claude-code.md'), 'utf8');
  const block = /```json\n(\{\n {2}"permissions"[\s\S]*?)```/.exec(guide);
  assert.ok(block, 'the guide has a permissions JSON block');
  assert.deepEqual(JSON.parse(block[1]).permissions.allow, [...GUIDE_ALLOW]);
  assert.match(guide, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"/);
});
