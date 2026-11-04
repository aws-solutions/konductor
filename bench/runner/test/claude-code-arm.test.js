// SPDX-License-Identifier: Apache-2.0
'use strict';

// Preparing a konductor arm for Claude Code: build once, cache by source and binary hash, install per run, refuse a bad pin.
// The build is a stub (ctx.claudeBuild); one test runs the real `konductor install --harness claude` when a prebuilt
// binary and a synthesized source tree are given through KONDUCTOR_TEST_BIN and KONDUCTOR_TEST_SRC.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { claudeCode: cc } = require('../lib/harness/index.js');
const { prepareAll, preflightTable } = require('../lib/orchestrate.js');
const { executeRun } = require('../lib/run-one.js');
const sandbox = require('../lib/sandbox.js');

const CANON = 'claude-sonnet-5-5';
const NAMES = ['k-architect', 'k-browser', 'k-developer', 'k-media-analyzer', 'k-product-manager', 'k-quality-assurance', 'k-researcher', 'k-tpm', 'konductor', 'konductor-cmux-orchestrator', 'konductor-mux-orchestrator'];
const STUB_BIN = (pin) => `#!/bin/sh
[ "$1" = install ] || exit 2
mkdir -p "$HOME/.claude/agents" "$HOME/.claude/skills/demo"
for n in ${NAMES.join(' ')}; do printf -- '---\\nname: %s\\nmodel: ${pin}\\n---\\nstub\\n' "$n" > "$HOME/.claude/agents/$n.md"; done
printf -- '---\\nname: demo\\ndescription: d\\n---\\n' > "$HOME/.claude/skills/demo/SKILL.md"
echo installed
`;

function dirArm(root, name, contentHash) {
  const dir = path.join(root, `src-${name}`);
  write(path.join(dir, 'cli/konductor-rs/Cargo.toml'), '[package]\nname = "konductor"\n');
  write(path.join(dir, 'skills/demo/SKILL.md'), '---\nname: demo\n---\n');
  write(path.join(dir, 'agent-sops/k-plan.sop.md'), 'x');
  return { id: `cc-${name}`, label: `cc-${name}@${contentHash.slice(0, 12)}`, ref: `dir:${dir}`, commitSha: null, source: 'dir', dir, contentHash, cacheKey: contentHash.slice(0, 12), harness: 'claude', runtime: 'claude-code', agent: 'konductor', vanilla: false, warnings: [] };
}

function ctxFor(root, { pin = CANON, builds = [] } = {}) {
  return {
    repo: root, cacheDir: path.join(root, 'cache'), cargoTarget: path.join(root, 'target'), scratchDir: path.join(root, 'scratch'),
    config: { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: CANON, effort: 'default' },
    claudeBuild: (arm, ctx, { exportDir, bin }) => {
      builds.push(arm.id);
      write(path.join(exportDir, 'dist/claude/marker'), 'synth');
      write(path.join(exportDir, 'skills/demo/SKILL.md'), '---\nname: demo\n---\n');
      write(path.join(exportDir, 'agent-sops/k-plan.sop.md'), 'x');
      write(bin, STUB_BIN(pin));
      fs.chmodSync(bin, 0o755);
    },
  };
}

test('prepareArm builds once and reuses the build while the source and binary are unchanged', () => {
  const root = tmp();
  try {
    const builds = [];
    const ctx = ctxFor(root, { builds });
    const arm = dirArm(root, 'pr-105', 'a'.repeat(64));
    const first = cc.prepareArm(arm, ctx);
    assert.equal(first.cached, false);
    assert.match(first.cliSha256, /^[0-9a-f]{64}$/);
    assert.equal(first.mcpSha256, null);
    const second = cc.prepareArm(arm, ctx);
    assert.equal(second.cached, true);
    assert.equal(second.cliSha256, first.cliSha256);
    assert.deepEqual(builds, ['cc-pr-105']);
    const ready = JSON.parse(fs.readFileSync(path.join(root, 'cache', `cc-pr-105-${'a'.repeat(12)}`, '.ready'), 'utf8'));
    assert.deepEqual(Object.keys(ready).sort(), ['cliSha256', 'commitSha', 'contentHash']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepareArm rebuilds when the binary no longer matches its recorded hash or the synth output is gone', () => {
  const root = tmp();
  try {
    const builds = [];
    const ctx = ctxFor(root, { builds });
    const arm = dirArm(root, 'x', 'b'.repeat(64));
    const p = cc.prepareArm(arm, ctx);
    fs.appendFileSync(p.bin, '# tampered\n');
    assert.equal(cc.prepareArm(arm, ctx).cached, false);
    fs.rmSync(path.join(p.exportDir, 'dist'), { recursive: true });
    assert.equal(cc.prepareArm(arm, ctx).cached, false);
    assert.equal(builds.length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a different source gets its own cache entry', () => {
  const root = tmp();
  try {
    const builds = [];
    const ctx = ctxFor(root, { builds });
    cc.prepareArm(dirArm(root, 'one', 'c'.repeat(64)), ctx);
    cc.prepareArm(dirArm(root, 'two', 'd'.repeat(64)), ctx);
    assert.equal(builds.length, 2);
    assert.equal(fs.readdirSync(path.join(root, 'cache')).length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepareAll with a Claude Code arm: layout check, build, trial install, skill catalog, preflight table', () => {
  const root = tmp();
  try {
    const ctx = ctxFor(root);
    const arm = dirArm(root, 'pr-105', 'e'.repeat(64));
    const logs = [];
    const { prepared, errors } = prepareAll({ arms: [arm], ctx, log: (m) => logs.push(m) });
    assert.equal(errors.size, 0);
    const p = prepared.get('cc-pr-105');
    assert.deepEqual(p.rewrittenAgents, []);
    assert.deepEqual(p.skillInfo.catalog.skills, ['demo']);
    assert.deepEqual(p.skillInfo.catalog.sops, ['k-plan']);
    assert.match(preflightTable([arm], prepared, errors), /cc-pr-105@eeeeeeeeeeee .* ready \(built\)/);
    assert.deepEqual(fs.readdirSync(root).filter((n) => /^w-/.test(n)), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an arm whose install lacks the dashed pin does not prepare, and says why', () => {
  const root = tmp();
  try {
    const ctx = ctxFor(root, { pin: 'claude-sonnet-5.5' });
    const arm = dirArm(root, 'old', 'f'.repeat(64));
    assert.throws(() => prepareAll({ arms: [arm], ctx, log: () => {} }), /not pinned to model claude-sonnet-5-5.*predates the dashed model pin/s);
    const { prepared, errors } = prepareAll({ arms: [arm], ctx, log: () => {}, allowPartial: true });
    assert.equal(prepared.size, 0);
    assert.match(errors.get('cc-old'), /dashed model pin/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an arm tree without the CLI layout is refused before any build', () => {
  const root = tmp();
  try {
    const ctx = ctxFor(root);
    const arm = dirArm(root, 'bare', '1'.repeat(64));
    fs.rmSync(path.join(arm.dir, 'cli'), { recursive: true });
    assert.throws(() => prepareAll({ arms: [arm], ctx, log: () => {} }), /has no cli\/konductor-rs\/Cargo\.toml/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the install runs per run in the scratch HOME and refuses the real HOME', () => {
  const root = tmp();
  try {
    const ctx = ctxFor(root);
    const arm = dirArm(root, 'h', '2'.repeat(64));
    const p = cc.prepareArm(arm, ctx);
    const home = path.join(root, 'home');
    cc.installInto(home, { arm, prepared: p, ctx, config: ctx.config, outDir: null });
    assert.equal(fs.existsSync(path.join(home, '.claude', 'agents', 'konductor.md')), true);
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'rules')), ['empty.md']);
    const realHome = fs.realpathSync(require('node:os').homedir());
    assert.throws(() => sandbox.runKonductor(p.bin, ['install'], { home: realHome }), /refused to run with the real HOME/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an arm install that cannot write agents fails the run as a setup error with the spend at zero', async () => {
  const root = tmp();
  try {
    const bad = path.join(root, 'bad');
    write(bad, '#!/bin/sh\nexit 3\n');
    fs.chmodSync(bad, 0o755);
    const ctx = ctxFor(root);
    ctx.claude = { bin: '/nonexistent/claude', version: 'x', supportsHookEvents: false };
    ctx.isolation = { mode: 'none' };
    ctx.tripwire = { roots: [], extraExcludes: [], absExclude: [] };
    fs.mkdirSync(ctx.scratchDir, { recursive: true });
    const bench = path.join(root, 'bench');
    const { makeBench } = require('./helpers.js');
    makeBench(bench);
    const { loadTasks } = require('../lib/tasks.js');
    const arm = dirArm(root, 'bad', '3'.repeat(64));
    const r = await executeRun({ arm, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: { bin: bad, exportDir: arm.dir }, outDir: path.join(root, 'out') });
    assert.equal(r.status, 'error');
    assert.match(r.infraError, /install --harness claude.*failed \(exit 3\)/);
    assert.equal(r.costUsd, null);
    assert.equal(r.claudeCode, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const REAL_BIN = process.env.KONDUCTOR_TEST_BIN;
const REAL_SRC = process.env.KONDUCTOR_TEST_SRC;
test('real konductor install --harness claude: 11 agents, dashed pin, rules file', { skip: REAL_BIN && REAL_SRC ? false : 'set KONDUCTOR_TEST_BIN (a built konductor) and KONDUCTOR_TEST_SRC (a source tree after `konductor synth`) to run' }, () => {
  const root = tmp();
  try {
    const ctx = { config: { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: CANON, effort: 'default' }, claude: { version: 'test' } };
    const home = path.join(root, 'home');
    const meta = cc.installInto(home, { arm: { vanilla: false, agent: 'konductor' }, prepared: { bin: REAL_BIN, exportDir: REAL_SRC }, ctx, config: ctx.config, outDir: null });
    assert.equal(meta.installedAgents, 11);
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'rules')), ['empty.md']);
    assert.ok(fs.readdirSync(path.join(home, '.claude', 'skills')).length >= 100);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
