// SPDX-License-Identifier: Apache-2.0
'use strict';

// Variant building on a temp git repo: ops, lists, provenance, hash, guards. No cargo; --verify runs against a fake installer.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, scratch } = require('./cap-helpers.js');
const { write } = require('./helpers.js');
const { buildVariant, verifyInstalled, reachWarning } = require('../../cap/variant.js');
const { guardInstalls, installsHash } = require('../../cap/guard.js');
const { snapshotDir } = require('../lib/arm-source.js');
const { parseArmSpec } = require('../lib/arms.js');
const { loadAgentSpecs } = require('../../cap/scan.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function setup() {
  const root = scratch();
  const r = makeCapRepo(root);
  const out = path.join(root, 'scratch');
  const build = (o = {}) => buildVariant({ repo: r.repo, base: 'v0', scratch: o.scratch ?? out, ...o });
  return { root, repo: r.repo, sha: r.sha, git: r.git, out, build, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const spec_ = (v, name) => JSON.parse(fs.readFileSync(path.join(v.dir, `agents/${name}.agent-spec.json`), 'utf8'));
const lists = (v, name) => { const d = spec_(v, name).dependencies; return { skills: d.skills.skillNames, sops: d.agentSops.agentSopNames, ctx: d.context.contextNames }; };

test('drop removes the skill directory and its name from every list of every spec', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'] });
    assert.equal(fs.existsSync(path.join(v.dir, 'skills/alpha')), false);
    assert.ok(fs.existsSync(path.join(v.dir, 'skills/beta/SKILL.md')));
    assert.deepEqual(lists(v, 'konductor').skills, ['delta']);
    assert.deepEqual(lists(v, 'k-dev').skills, ['beta', 'ghost']);
    assert.equal(v.meta.ops[0].op, 'drop');
    assert.deepEqual(v.meta.ops[0].removedFrom.map((r) => `${r.agent}:${r.list}`).sort(), ['k-dev:skillNames', 'konductor:claudeCli.skills', 'konductor:skillNames']);
  } finally { s.done(); }
});

test('drop also removes a skill from clientConfig.claudeCli.skills, which synth checks against the skill directories', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'] });
    assert.deepEqual(spec_(v, 'konductor').clientConfig.claudeCli.skills, ['delta']);
    assert.ok(v.meta.ops[0].removedFrom.some((r) => r.agent === 'konductor' && r.list === 'claudeCli.skills'));
    assert.deepEqual(spec_(v, 'k-dev').clientConfig.claudeCli.skills, []);
  } finally { s.done(); }
});

test('verify fails when a dropped skill is still in claudeCli.skills of a spec', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'] });
    const file = path.join(v.dir, 'agents/konductor.agent-spec.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    j.clientConfig.claudeCli.skills.push('alpha');
    fs.writeFileSync(file, JSON.stringify(j));
    const r = verifyInstalled({ variant: v, prepared: fakePrepared(s.root, v.dir), tmpRoot: path.join(s.root, 'tmp') });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /konductor: claudeCli\.skills still lists alpha/);
  } finally { s.done(); }
});

test('drop of a SOP and of a context file edits the SOP and context lists', () => {
  const s = setup();
  try {
    const a = s.build({ drop: ['sop:k-plan'] });
    assert.equal(fs.existsSync(path.join(a.dir, 'agent-sops/k-plan.sop.md')), false);
    assert.deepEqual(lists(a, 'konductor').sops, []);
    const b = s.build({ drop: ['context:core'], scratch: path.join(s.root, 's2') });
    assert.equal(fs.existsSync(path.join(b.dir, 'context/core.md')), false);
    assert.deepEqual(lists(b, 'konductor').ctx, ['routing.md']);
    assert.deepEqual(lists(b, 'k-dev').ctx, []);
  } finally { s.done(); }
});

test('an agent cannot be dropped, and an unknown id is an error', () => {
  const s = setup();
  try {
    assert.throws(() => s.build({ drop: ['agent:k-dev'] }), /cannot drop an agent/);
    assert.throws(() => s.build({ drop: ['skill:nope'] }), /skill:nope does not exist at the base ref/);
    assert.throws(() => s.build({}), /nothing to do/);
  } finally { s.done(); }
});

test('replace overlays the file and leaves every list unchanged', () => {
  const s = setup();
  try {
    const cand = path.join(s.root, 'cand.md');
    fs.writeFileSync(cand, '---\nname: alpha\ndescription: Use when checking handlers for unsafe input. Short and sharp.\n---\n\n# Alpha v2\n');
    const before = spec_({ dir: path.join(s.root, 'repo') }, 'konductor');
    const v = s.build({ replace: [`skill:alpha=${cand}`] });
    assert.equal(fs.readFileSync(path.join(v.dir, 'skills/alpha/SKILL.md'), 'utf8'), fs.readFileSync(cand, 'utf8'));
    assert.deepEqual(lists(v, 'konductor').skills, ['alpha', 'delta']);
    assert.deepEqual(spec_(v, 'konductor'), before);
    const op = v.meta.ops[0];
    assert.equal(op.afterSha256, sha(fs.readFileSync(cand)));
    assert.notEqual(op.beforeSha256, op.afterSha256);
    assert.equal(op.beforeSha256, sha(spawnSync('git', ['-C', s.repo, 'show', 'v0:skills/alpha/SKILL.md']).stdout));
  } finally { s.done(); }
});

test('replace refuses a skill whose frontmatter name differs from the id', () => {
  const s = setup();
  try {
    const cand = path.join(s.root, 'c.md');
    fs.writeFileSync(cand, '---\nname: renamed\ndescription: x\n---\n');
    assert.throws(() => s.build({ replace: [`skill:alpha=${cand}`] }), /frontmatter name "renamed" must stay "alpha"/);
  } finally { s.done(); }
});

test('add creates the file and lists it for the named agent only', () => {
  const s = setup();
  try {
    const cand = path.join(s.root, 'n.md');
    fs.writeFileSync(cand, '---\nname: newone\ndescription: Use when testing adds.\n---\n\nbody\n');
    const v = s.build({ add: [`skill:newone=${cand}`], toAgent: ['k-dev'] });
    assert.ok(fs.existsSync(path.join(v.dir, 'skills/newone/SKILL.md')));
    assert.deepEqual(lists(v, 'k-dev').skills, ['alpha', 'beta', 'ghost', 'newone']);
    assert.deepEqual(lists(v, 'konductor').skills, ['alpha', 'delta']);
    assert.throws(() => s.build({ add: [`skill:newone=${cand}`] }), /--add needs --to-agent/);
    assert.throws(() => s.build({ add: [`skill:newone=${cand}`], toAgent: ['k-nobody'] }), /agent "k-nobody" is not an agent spec/);
    assert.throws(() => s.build({ add: [`skill:alpha=${cand}`], toAgent: ['k-dev'] }), /skill:alpha already exists; use --replace/);
  } finally { s.done(); }
});

test('preset skills-only keeps the orchestrator skill and SOP lists and drops its context files', () => {
  const s = setup();
  try {
    const v = s.build({ preset: 'skills-only' });
    const k = lists(v, 'konductor');
    assert.deepEqual([k.skills, k.sops, k.ctx], [['alpha', 'delta'], ['k-plan'], []]);
    assert.deepEqual(lists(v, 'k-dev').ctx, ['core.md'], 'other agents are untouched');
    assert.equal(v.meta.armName, 'skills-only');
  } finally { s.done(); }
});

test('preset bare gives the orchestrator a one-line prompt, empty lists and no subagents', () => {
  const s = setup();
  try {
    const v = s.build({ preset: 'bare' });
    const j = spec_(v, 'konductor');
    assert.equal(j.config.systemPrompt.split('\n').length, 1);
    assert.deepEqual(lists(v, 'konductor'), { skills: [], sops: [], ctx: [] });
    assert.deepEqual(j.clientConfig.kiroCli.toolsSettings.subagent.availableAgents, []);
    assert.deepEqual(j.dependencies.subagents?.agentNames ?? [], []);
    assert.throws(() => s.build({ preset: 'weird' }), /--preset takes skills-only or bare/);
  } finally { s.done(); }
});

test('variant.json records the base, every op with before and after hashes, inbound references and the tree hash', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'], agentEngine: 'v3', now: new Date('2026-01-02T03:04:05Z') });
    const j = JSON.parse(fs.readFileSync(path.join(v.root, 'variant.json'), 'utf8'));
    assert.deepEqual(j, v.meta);
    assert.equal(j.agentEngine, 'v3');
    assert.deepEqual(j.base, { ref: 'v0', commitSha: s.sha, tree: s.git('rev-parse', 'v0^{tree}') });
    assert.equal(j.createdAt, '2026-01-02T03:04:05.000Z');
    assert.match(j.toolVersion, /^cap-variant\//);
    assert.equal(j.variantHash, snapshotDir(v.dir).hash, 'the hash is the one the runner computes for the directory arm');
    assert.deepEqual(j.inboundRefs[0].id, 'skill:alpha');
    assert.deepEqual(j.inboundRefs[0].refs.map((r) => r.from).sort(), ['agent:konductor', 'skill:delta', 'skill:gamma']);
    assert.equal(j.ops[0].afterSha256, null);
    assert.equal(fs.existsSync(path.join(v.dir, 'variant.json')), false, 'provenance sits beside the tree, not in it');
  } finally { s.done(); }
});

test('the printed arm string parses as a dir arm and points at the tree', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'] });
    assert.equal(v.armName, 'x-minus');
    assert.equal(v.armSpec, `x-minus=dir:${v.dir}`);
    const p = parseArmSpec(v.armSpec);
    assert.deepEqual([p.kind, p.name, p.path], ['dir', 'x-minus', v.dir]);
    assert.ok(fs.statSync(v.dir).isDirectory());
  } finally { s.done(); }
});

test('the variant hash is stable for the same ops and changes with a single byte of the replaced file', () => {
  const s = setup();
  try {
    const a = s.build({ drop: ['skill:alpha'] });
    const b = s.build({ drop: ['skill:alpha'], scratch: path.join(s.root, 'other') });
    assert.equal(a.meta.variantHash, b.meta.variantHash);
    const f1 = path.join(s.root, 'a.md');
    const f2 = path.join(s.root, 'b.md');
    fs.writeFileSync(f1, '---\nname: alpha\ndescription: Use when A.\n---\n');
    fs.writeFileSync(f2, '---\nname: alpha\ndescription: Use when B.\n---\n');
    const r1 = s.build({ replace: [`skill:alpha=${f1}`], scratch: path.join(s.root, 'r1') });
    const r2 = s.build({ replace: [`skill:alpha=${f2}`], scratch: path.join(s.root, 'r2') });
    assert.notEqual(r1.meta.variantHash, r2.meta.variantHash);
    assert.notEqual(r1.meta.variantHash, a.meta.variantHash);
  } finally { s.done(); }
});

test('the variant is built from the ref: later working-tree edits do not leak in', () => {
  const s = setup();
  try {
    fs.writeFileSync(path.join(s.repo, 'skills/beta/SKILL.md'), 'edited\n');
    fs.writeFileSync(path.join(s.repo, 'untracked.txt'), 'x\n');
    const v = s.build({ drop: ['skill:alpha'] });
    assert.match(fs.readFileSync(path.join(v.dir, 'skills/beta/SKILL.md'), 'utf8'), /Write the migration/);
    assert.equal(fs.existsSync(path.join(v.dir, 'untracked.txt')), false);
  } finally { s.done(); }
});

test('the scratch directory may not be inside the repo or under the real HOME', () => {
  const s = setup();
  const prev = process.env.HOME;
  try {
    assert.throws(() => s.build({ drop: ['skill:alpha'], scratch: path.join(s.repo, 'tmp-variants') }), /inside the repository/);
    const home = path.join(s.root, 'home');
    fs.mkdirSync(home);
    process.env.HOME = home;
    assert.throws(() => s.build({ drop: ['skill:alpha'], scratch: path.join(home, 'work') }), /under the real HOME/);
  } finally { process.env.HOME = prev; s.done(); }
});

// ---- installs guard ----

test('the installs guard passes when the registry directory is untouched and fails when it changes', () => {
  const root = scratch();
  try {
    const inst = path.join(root, '.konductor/installs');
    write(path.join(inst, 'a.json'), '{}');
    const before = installsHash([root]);
    assert.equal(guardInstalls(() => 7, { homes: [root] }), 7);
    assert.equal(installsHash([root]), before);
    assert.throws(() => guardInstalls(() => write(path.join(inst, 'b.json'), '{}'), { homes: [root] }), /~\/\.konductor\/installs changed/);
    assert.throws(() => guardInstalls(() => write(path.join(inst, 'a.json'), '{"x":1}'), { homes: [root] }), /changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the installs guard hashes a registry that is a file or a symlink instead of failing on it', () => {
  const root = scratch();
  try {
    write(path.join(root, '.konductor/installs'), 'not a directory');
    const a = installsHash([root]);
    assert.equal(guardInstalls(() => 1, { homes: [root] }), 1);
    fs.writeFileSync(path.join(root, '.konductor/installs'), 'changed');
    assert.notEqual(installsHash([root]), a);
    fs.rmSync(path.join(root, '.konductor/installs'));
    fs.symlinkSync('/nonexistent-target', path.join(root, '.konductor/installs'));
    assert.match(installsHash([root]), /^[0-9a-f]{64}$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('BENCH_CAP_INSTALLS_HOMES replaces the watched homes', () => {
  const root = scratch();
  const prev = process.env.BENCH_CAP_INSTALLS_HOMES;
  try {
    process.env.BENCH_CAP_INSTALLS_HOMES = root;
    const { defaultHomes } = require('../../cap/guard.js');
    assert.deepEqual(defaultHomes(), [fs.realpathSync(root)]);
  } finally { if (prev === undefined) delete process.env.BENCH_CAP_INSTALLS_HOMES; else process.env.BENCH_CAP_INSTALLS_HOMES = prev; fs.rmSync(root, { recursive: true, force: true }); }
});

test('the installs guard also catches a registry that did not exist before', () => {
  const root = scratch();
  try {
    assert.throws(() => guardInstalls(() => write(path.join(root, '.konductor/installs/x.json'), '{}'), { homes: [root] }), /changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the guard also runs when the work throws, and reports the change over the error', async () => {
  const root = scratch();
  try {
    const run = () => guardInstalls(() => { write(path.join(root, '.konductor/installs/x.json'), '{}'); throw new Error('boom'); }, { homes: [root] });
    assert.throws(run, /changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cap variant fails with exit 1 when a build changes the watched install registry', () => {
  const s = setup();
  try {
    const watched = path.join(s.root, 'watched');
    fs.mkdirSync(watched);
    const home = path.join(s.root, 'h');
    fs.mkdirSync(home);
    const run = (scratchDir) => spawnSync(process.execPath, [BENCH_JS, 'cap', 'variant', '--repo-root', s.repo, '--base', 'v0', '--drop', 'skill:alpha', '--scratch', scratchDir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, BENCH_CAP_INSTALLS_HOMES: watched } });
    const clean = run(path.join(s.root, 'elsewhere'));
    assert.equal(clean.status, 0, clean.stderr);
    const dirty = run(path.join(watched, '.konductor', 'installs', 'scratch'));
    assert.equal(dirty.status, 1, dirty.stdout + dirty.stderr);
    assert.match(dirty.stderr, /~\/\.konductor\/installs changed during the command/);
  } finally { s.done(); }
});

// ---- reachability warning ----

test('a skills-only change to a skill the acting agent cannot reach at startup is refused', () => {
  const s = setup();
  try {
    const specs = loadAgentSpecs(path.join(s.root, 'repo'));
    const ops = [{ op: 'drop', id: 'skill:gamma' }];
    assert.match(reachWarning({ ops, specs, actingAgents: ['konductor'] }), /capability not reachable at startup: skill:gamma is not in the filter of konductor/);
    assert.equal(reachWarning({ ops: [{ op: 'drop', id: 'skill:alpha' }], specs, actingAgents: ['konductor'] }), null);
    assert.match(reachWarning({ ops: [{ op: 'drop', id: 'skill:beta' }], specs, actingAgents: ['konductor'] }), /skill:beta/);
    assert.equal(reachWarning({ ops: [{ op: 'drop', id: 'context:routing' }], specs, actingAgents: ['k-dev'] }), null, 'only changes confined to skills/ are checked');
    assert.equal(reachWarning({ ops: [{ op: 'drop', id: 'skill:gamma' }, { op: 'drop', id: 'sop:k-plan' }], specs, actingAgents: ['konductor'] }), null);
  } finally { s.done(); }
});

test('cap variant exits 2 on an unreachable skill unless --force, and runs with a scratch HOME', () => {
  const s = setup();
  try {
    const bench = makeCapBench(s.root);
    const home = path.join(s.root, 'h');
    fs.mkdirSync(home);
    const run = (...a) => spawnSync(process.execPath, [BENCH_JS, 'cap', 'variant', '--repo-root', s.repo, '--bench-dir', bench, '--base', 'v0', '--scratch', s.out, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: os.tmpdir(), BENCH_CAP_INSTALLS_HOMES: home } });
    const refused = run('--drop', 'skill:gamma');
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /capability not reachable at startup/);
    assert.equal(fs.existsSync(path.join(s.out, 'variants')), false, 'nothing was built');
    const forced = run('--drop', 'skill:gamma', '--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /--arms x-minus=dir:/);
    const ok = run('--drop', 'skill:alpha');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /referenced by: agent:konductor, skill:delta, skill:gamma/);
    assert.deepEqual(fs.readdirSync(home), [], 'the HOME it was given stays empty');
  } finally { s.done(); }
});

// ---- verify against a fake installer ----

// Stands in for `konductor install --harness H --from DIR --no-telemetry`: writes ~/.kiro/agents/<name>.json from the specs in DIR.
const FAKE_INSTALLER = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const from = args[args.indexOf('--from') + 1];
const dir = path.join(process.env.HOME, '.kiro/agents'); fs.mkdirSync(dir, { recursive: true });
const staleFile = path.join(__dirname, 'stale.json');
const skipDrop = fs.existsSync(staleFile) ? JSON.parse(fs.readFileSync(staleFile, 'utf8')) : null;
for (const f of fs.readdirSync(path.join(from, 'agents')).filter((n) => n.endsWith('.agent-spec.json'))) {
  const s = JSON.parse(fs.readFileSync(path.join(from, 'agents', f), 'utf8'));
  const d = s.dependencies || {};
  let skills = (d.skills || {}).skillNames || [];
  if (skipDrop && s.name === skipDrop.agent) skills = [...skills, skipDrop.name];
  fs.writeFileSync(path.join(dir, s.name + '.json'), JSON.stringify({ name: s.name, prompt: s.config.systemPrompt, resources: ((d.context || {}).contextNames || []).map((c) => 'file://' + path.join(process.env.HOME, '.kiro/context', c)),
    mcpServers: { 'konductor-skills': { command: 'x', args: ['--skill-name-filter', skills.join(','), '--agent-sop-filter', (((d.agentSops || {}).agentSopNames) || []).join(',')] } } }));
}
console.log('installed');
`;

// `stale` = { agent, name }: the fake lists that skill for that agent even though the spec does not.
function fakePrepared(root, exportDir, stale = null) {
  const bin = path.join(root, 'konductor');
  fs.writeFileSync(bin, FAKE_INSTALLER, { mode: 0o755 });
  fs.rmSync(path.join(root, 'stale.json'), { force: true });
  if (stale) fs.writeFileSync(path.join(root, 'stale.json'), JSON.stringify(stale));
  return { bin, exportDir };
}

test('verify passes when the installed filters equal what the ops predict', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'] });
    const r = verifyInstalled({ variant: v, prepared: fakePrepared(s.root, v.dir), tmpRoot: path.join(s.root, 'tmp') });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.checked.length >= 2);
  } finally { s.done(); }
});

test('verify fails when the dropped skill is still in an installed filter', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'] });
    const r = verifyInstalled({ variant: v, prepared: fakePrepared(s.root, v.dir, { agent: 'k-dev', name: 'alpha' }), tmpRoot: path.join(s.root, 'tmp') });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /k-dev: skill filter still lists alpha/);
  } finally { s.done(); }
});

test('verify for an add expects the name in the named agent and nowhere else', () => {
  const s = setup();
  try {
    const cand = path.join(s.root, 'n.md');
    fs.writeFileSync(cand, '---\nname: newone\ndescription: Use when adding.\n---\n');
    const v = s.build({ add: [`skill:newone=${cand}`], toAgent: ['k-dev'] });
    assert.equal(verifyInstalled({ variant: v, prepared: fakePrepared(s.root, v.dir), tmpRoot: path.join(s.root, 'tmp') }).ok, true);
    const bad = verifyInstalled({ variant: v, prepared: fakePrepared(s.root, v.dir, { agent: 'konductor', name: 'newone' }), tmpRoot: path.join(s.root, 'tmp') });
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join('\n'), /konductor: skill filter lists newone but the ops do not add it there/);
  } finally { s.done(); }
});

test('verify refuses the real HOME and removes its scratch HOME', () => {
  const s = setup();
  try {
    const v = s.build({ drop: ['skill:alpha'] });
    const tmpRoot = path.join(s.root, 'tmp');
    verifyInstalled({ variant: v, prepared: fakePrepared(s.root, v.dir), tmpRoot });
    assert.deepEqual(fs.readdirSync(tmpRoot), [], 'the scratch HOME is removed');
    assert.throws(() => verifyInstalled({ variant: v, prepared: fakePrepared(s.root, v.dir), tmpRoot: path.join(s.root, 'tmp'), home: os.homedir() }), /refused to run with the real HOME/);
  } finally { s.done(); }
});
