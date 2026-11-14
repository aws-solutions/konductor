// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Claude Code harness against a fake claude that replays recorded streams: no network, no cloud credentials.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeClaude } = require('./fake-claude.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { harnessFor, claudeCode: cc, kiro, opencode } = require('../lib/harness/index.js');
const { scanTree } = require('../lib/hygiene.js');
const { validateResult } = require('../lib/result.js');

const FX = path.join(__dirname, 'fixtures', 'claude-code');
const MODEL = 'us.anthropic.claude-sonnet-5-5';
const CANON = 'claude-sonnet-5-5';
const SECRET = 'fakeSecretValueNotReal0123456789abcdefgh';
const TOKEN = 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==';
const KEY_ID = 'AK' + 'IATESTTESTTEST1234';
const CC_VANILLA = { id: 'cc-vanilla', label: 'cc-vanilla', ref: null, commitSha: null, harness: 'none', runtime: 'claude-code', agent: null, vanilla: true };
const CC_KONDUCTOR = { id: 'cc-pr-105', label: 'cc-pr-105@abc', ref: 'pr-105', commitSha: 'abc', harness: 'claude', runtime: 'claude-code', agent: 'konductor', vanilla: false };
const AGENT_NAMES = ['k-architect', 'k-browser', 'k-developer', 'k-media-analyzer', 'k-product-manager', 'k-quality-assurance', 'k-researcher', 'k-tpm', 'konductor', 'konductor-cmux-orchestrator', 'konductor-mux-orchestrator'];

const FAKE_KONDUCTOR = (pin, names) => `#!/bin/sh
[ "$1" = install ] || exit 2
mkdir -p "$HOME/.claude/agents"
for n in ${names.join(' ')}; do printf -- '---\\nname: %s\\nmodel: ${pin}\\n---\\nstub\\n' "$n" > "$HOME/.claude/agents/$n.md"; done
printf '{"hooks":{}}\\n' > "$HOME/.claude/settings.json"
echo "installed"
`;

const CRED_NAMES = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE'];

// Credentials come from the caller's environment; the tests set fake ones and put the environment back.
function withEnv(vars, fn) {
  const saved = Object.fromEntries(CRED_NAMES.map((k) => [k, process.env[k]]));
  for (const k of CRED_NAMES) delete process.env[k];
  Object.assign(process.env, vars);
  const restore = () => { for (const k of CRED_NAMES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}
const CREDS = { AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: SECRET, AWS_SESSION_TOKEN: TOKEN };

function setup(stream = 'vanilla-success', cfg = {}, { pin = CANON, names = AGENT_NAMES } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const tools = path.join(root, 'tools');
  const tmpBase = path.join(root, 'faketmp');
  fs.mkdirSync(tmpBase);
  const bin = makeFakeClaude(tools, { dir: probe, streamFile: path.join(FX, `${stream}.stream.jsonl`), tmpBases: [tmpBase], ...cfg });
  const kdir = path.join(root, 'kd');
  write(path.join(kdir, 'konductor'), FAKE_KONDUCTOR(pin, names));
  fs.chmodSync(path.join(kdir, 'konductor'), 0o755);
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: MODEL, canonicalModel: CANON, effort: 'default' }, scratchDir, claude: cc.resolveClaude({ binOverride: bin }), claudeTmpBases: [tmpBase], envKeep: [],
    envInfo: { kiroCliVersion: null, harnessVersion: '9.9.9', modelListSnapshotPath: null, region: 'us-east-1' },
    isolation: { mode: 'none' }, runBudgetUsd: 0.75,
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  const task = loadTasks(bench).get('t1');
  return {
    root, bench, ctx, task, probe, scratchDir, tmpBase, tools, bin, prepared: { bin: path.join(kdir, 'konductor'), exportDir: path.join(root, 'src') },
    outDir: path.join(root, 'out', 't1'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const started = (s) => JSON.parse(fs.readFileSync(path.join(s.probe, 'started.json'), 'utf8'));
const run = (s, arm = CC_VANILLA) => withEnv(CREDS, () => executeRun({ arm, task: s.task, replicate: 1, ctx: s.ctx, prepared: arm.vanilla ? null : s.prepared, outDir: s.outDir, inFlightAtStart: 0 }));

test('resolveClaude picks the newest version by number and records it', () => {
  const root = tmp();
  try {
    for (const v of ['2.1.9.100', '2.1.316.1544', '2.1.10.5']) makeFakeClaude(path.join(root, 'tools'), { dir: root }, v);
    write(path.join(root, 'tools', 'info.json'), '{}');
    fs.mkdirSync(path.join(root, 'tools', 'notes'));
    const r = cc.resolveClaude({ toolsDir: path.join(root, 'tools') });
    assert.equal(r.version, '2.1.316.1544');
    assert.equal(r.bin, path.join(root, 'tools', '2.1.316.1544', 'claude'));
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.equal(r.supportsHookEvents, true);
    assert.throws(() => cc.resolveClaude({ toolsDir: path.join(root, 'none') }), /no claude binary found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveClaude refuses a launcher by file name or size, also through a symlink', () => {
  const root = tmp();
  try {
    const real = makeFakeClaude(path.join(root, 'tools'), { dir: root });
    const small = path.join(root, 'launcher', 'claude');
    write(small, '#!/bin/sh\nexec true\n');
    fs.chmodSync(small, 0o755);
    assert.throws(() => cc.resolveClaude({ binOverride: small }), /this is a launcher, not the claude binary; it can override the model, region and credentials/);
    const renamed = path.join(root, 'launcher', 'run-claude');
    write(renamed, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(renamed, 0o755);
    fs.truncateSync(renamed, cc.MIN_BINARY_BYTES + 1);
    assert.throws(() => cc.resolveClaude({ binOverride: renamed }), /its file name is run-claude, not claude/, 'a large file with another name is not claude');
    assert.throws(() => cc.resolveClaude({ binOverride: small }), /it is \d+ bytes, far smaller/);
    const alias = path.join(root, 'alias', 'claude-link');
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.symlinkSync(real, alias);
    assert.equal(cc.resolveClaude({ binOverride: alias }).bin, alias, 'a symlink to the real file is judged by its target');
    const named = path.join(root, 'launcher2', 'claude');
    fs.mkdirSync(path.dirname(named), { recursive: true });
    fs.symlinkSync(small, named);
    assert.throws(() => cc.resolveClaude({ binOverride: named }), /this is a launcher/, 'a symlink is judged by its target');
    const viaOther = path.join(root, 'launcher3', 'claude');
    fs.mkdirSync(path.dirname(viaOther), { recursive: true });
    fs.symlinkSync(renamed, viaOther);
    assert.throws(() => cc.resolveClaude({ binOverride: viaOther }), /this is a launcher/, 'a symlink named claude to a file with another name is refused');
    assert.equal(cc.resolveClaude({ binOverride: real }).bin, real);
    assert.equal(cc.resolveClaude({ binOverride: small, minBytes: 1 }).bin, small, 'the size floor can be lowered by the caller');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveClaude has no default location: it needs a binary or a tools directory', () => {
  const env = { BENCH_CLAUDE_BIN: process.env.BENCH_CLAUDE_BIN, BENCH_CLAUDE_TOOLS_DIR: process.env.BENCH_CLAUDE_TOOLS_DIR };
  delete process.env.BENCH_CLAUDE_BIN;
  delete process.env.BENCH_CLAUDE_TOOLS_DIR;
  const root = tmp();
  try {
    assert.throws(() => cc.resolveClaude(), /pass --claude-bin PATH or --claude-tools-dir DIR/);
    const bin = makeFakeClaude(path.join(root, 'tools'), { dir: root });
    process.env.BENCH_CLAUDE_TOOLS_DIR = path.join(root, 'tools');
    assert.equal(cc.resolveClaude().bin, bin, 'BENCH_CLAUDE_TOOLS_DIR is read');
    delete process.env.BENCH_CLAUDE_TOOLS_DIR;
    process.env.BENCH_CLAUDE_BIN = bin;
    assert.equal(cc.resolveClaude().bin, bin, 'BENCH_CLAUDE_BIN is read');
  } finally {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('versionWarning is silent for the validated version and names both versions otherwise', () => {
  assert.equal(cc.versionWarning(cc.VALIDATED_VERSION), null);
  assert.match(cc.versionWarning('2.1.318.1638'), /claude 2\.1\.318\.1638 differs from 2\.1\.316\.1544/);
});

test('binaryContains finds a flag across a chunk boundary', () => {
  const root = tmp();
  try {
    const f = path.join(root, 'bin');
    const chunk = 8 * 1024 * 1024;
    fs.writeFileSync(f, Buffer.concat([Buffer.alloc(chunk - 5, 1), Buffer.from('--include-hook-events'), Buffer.alloc(100, 2)]));
    assert.equal(cc.binaryContains(f, '--include-hook-events'), true);
    assert.equal(cc.binaryContains(f, '--no-such-flag'), false);
    assert.equal(cc.binaryContains(path.join(root, 'missing'), 'x'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildCommand: the verified launch shape, tool list last, no max-turns, budget mapped', () => {
  const ctx = { claude: { bin: '/x/claude', supportsHookEvents: true }, runBudgetUsd: 1.5 };
  const config = { model: MODEL, canonicalModel: CANON };
  const van = cc.buildCommand({ arm: CC_VANILLA, task: { prompt: 'do it' }, config, ctx });
  assert.equal(van.file, '/x/claude');
  assert.deepEqual(van.args, ['-p', 'do it', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--max-budget-usd', '1.5', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Edit', 'Write', 'Read']);
  const kon = cc.buildCommand({ arm: CC_KONDUCTOR, task: { prompt: 'do it' }, config, ctx });
  assert.ok(kon.args.includes('--include-hook-events'));
  assert.deepEqual(kon.args.slice(kon.args.indexOf('--agent'), kon.args.indexOf('--agent') + 2), ['--agent', 'konductor']);
  assert.equal(kon.args.indexOf('--allowedTools'), kon.args.length - 5);
  assert.equal(kon.args.includes('--max-turns'), false);
  const noHooks = cc.buildCommand({ arm: CC_KONDUCTOR, task: { prompt: 'p' }, config, ctx: { claude: { bin: '/x', supportsHookEvents: false } } });
  assert.equal(noHooks.args.includes('--include-hook-events'), false);
  assert.equal(noHooks.args[noHooks.args.indexOf('--max-budget-usd') + 1], String(cc.DEFAULT_RUN_BUDGET_USD));
  assert.throws(() => cc.buildCommand({ arm: CC_VANILLA, task: { prompt: 'p' }, config, ctx, resume: { prompt: 'x' } }), /not supported/);
});

test('env: export-mode credentials only, no profile variables, telemetry off, scratch HOME and config dir', () => {
  const baseEnv = { PATH: '/bin', USER: 'u', AWS_PROFILE: 'p', AWS_CONFIG_FILE: '/c', AWS_SHARED_CREDENTIALS_FILE: '/s', AWS_DEFAULT_PROFILE: 'p', ANTHROPIC_API_KEY: 'k', ...CREDS, GITHUB_TOKEN: 'g', AWS_REGION: 'eu-west-1' };
  const { env, unset, keys } = cc.envSetup({ arm: CC_KONDUCTOR, ctx: {}, home: '/h', tmpdir: '/t', baseEnv });
  assert.equal(env.HOME, '/h');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/h/.claude');
  assert.equal(env.TMPDIR, '/t');
  assert.equal(env.CLAUDE_CODE_TMPDIR, '/t', 'claude\'s task directory root is the run\'s own temp directory');
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, '1');
  assert.equal(env.AWS_REGION, 'us-east-1');
  assert.equal(env.AWS_DEFAULT_REGION, 'us-east-1');
  assert.equal(env.AWS_EC2_METADATA_DISABLED, 'true');
  for (const k of ['DISABLE_TELEMETRY', 'DISABLE_AUTOUPDATER', 'DISABLE_ERROR_REPORTING', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']) assert.equal(env[k], '1', k);
  assert.equal(env.KONDUCTOR_TELEMETRY, 'off');
  for (const k of ['AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_DEFAULT_PROFILE', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN']) assert.equal(k in env, false, k);
  assert.equal(env.AWS_ACCESS_KEY_ID, KEY_ID);
  assert.equal(env.AWS_SESSION_TOKEN, TOKEN);
  assert.deepEqual(unset.sort(), ['AWS_CONFIG_FILE', 'AWS_DEFAULT_PROFILE', 'AWS_PROFILE', 'AWS_SHARED_CREDENTIALS_FILE']);
  assert.ok(keys.includes('CLAUDE_CONFIG_DIR'));
  assert.equal('KONDUCTOR_TELEMETRY' in cc.envSetup({ arm: CC_VANILLA, ctx: {}, home: '/h', baseEnv }).env, false);
});

test('checkCredentials names what is missing and never prints a value', () => {
  assert.throws(() => cc.checkCredentials({}), /missing AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY/);
  assert.throws(() => cc.checkCredentials({ AWS_ACCESS_KEY_ID: 'ASIAXXXXXXXXXXXXXXXX', AWS_SECRET_ACCESS_KEY: SECRET }), /AWS_SESSION_TOKEN is not set/);
  try { cc.checkCredentials({ AWS_ACCESS_KEY_ID: 'ASIAXXXXXXXXXXXXXXXX', AWS_SECRET_ACCESS_KEY: SECRET }); } catch (e) { assert.equal(e.message.includes(SECRET), false); }
  assert.deepEqual(cc.checkCredentials({ ...CREDS, AWS_PROFILE: 'x' }).shadow, ['AWS_PROFILE']);
  assert.deepEqual(cc.credentialNames({ ...CREDS, AWS_PROFILE: 'x' }), ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']);
});

test('the harness is chosen by the arm or the result record', () => {
  assert.equal(harnessFor(CC_VANILLA), cc);
  assert.equal(harnessFor({ harness: 'claude-code' }), cc);
  assert.equal(harnessFor({ harness: 'opencode' }), opencode);
  assert.equal(harnessFor({ harness: 'claude', runtime: 'kiro-cli' }), kiro);
  assert.equal(harnessFor({ harness: 'none' }), kiro);
});

test('installInto: vanilla gets an empty config dir with only the empty rules file', () => {
  const s = setup();
  try {
    const home = path.join(s.root, 'home');
    cc.installInto(home, { arm: CC_VANILLA, prepared: null, ctx: s.ctx, config: s.ctx.config, outDir: null });
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude')), ['rules']);
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'rules')), ['empty.md']);
    assert.equal(fs.statSync(path.join(home, '.claude', 'rules', 'empty.md')).size, 0);
  } finally {
    s.cleanup();
  }
});

test('installInto: a konductor arm gets 11 agents with the dashed pin and the empty rules file', () => {
  const s = setup();
  try {
    const home = path.join(s.root, 'home');
    const meta = cc.installInto(home, { arm: CC_KONDUCTOR, prepared: s.prepared, ctx: s.ctx, config: s.ctx.config, outDir: null });
    assert.equal(meta.installedAgents, 11);
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'rules')), ['empty.md']);
    assert.equal(Object.values(cc.agentPins(path.join(home, '.claude', 'agents'))).every((p) => p === CANON), true);
  } finally {
    s.cleanup();
  }
});

test('installInto refuses a dotted pin, a wrong agent count and a missing entry agent', () => {
  for (const [opts, re] of [
    [{ pin: 'claude-sonnet-5.5' }, /not pinned to model claude-sonnet-5-5.*predates the dashed model pin/],
    [{ names: ['konductor', 'k-tpm', 'k-developer'] }, /expected 11 installed agents, found 3/],
    [{ names: AGENT_NAMES.filter((n) => n !== 'konductor') }, /agent "konductor" is not installed/],
  ]) {
    const s = setup('vanilla-success', {}, opts);
    try {
      assert.throws(() => cc.installInto(path.join(s.root, 'home'), { arm: CC_KONDUCTOR, prepared: s.prepared, ctx: s.ctx, config: s.ctx.config, outDir: null }), re);
    } finally {
      s.cleanup();
    }
  }
});

test('trialInstall proves the arm and removes its throwaway home', () => {
  const s = setup();
  try {
    assert.deepEqual(cc.trialInstall({ ...s.prepared }, s.ctx), []);
  } finally {
    s.cleanup();
  }
});

test('cleanupRun removes only the directory of this run', () => {
  const root = tmp();
  try {
    const cwdA = path.join(root, 'r-a', 'work');
    const cwdB = path.join(root, 'r-b', 'work');
    fs.mkdirSync(cwdA, { recursive: true });
    fs.mkdirSync(cwdB, { recursive: true });
    const uid = 4242;
    const base = path.join(root, 'tmp');
    for (const c of [cwdA, cwdB]) fs.mkdirSync(path.join(base, `claude-${uid}`, cc.slugOf(c), 'tasks'), { recursive: true });
    const removed = cc.cleanupRun({ cwd: cwdA, tmpdir: base, tmpBases: [base], uid });
    assert.equal(removed.length, 1);
    assert.deepEqual(fs.readdirSync(path.join(base, `claude-${uid}`)), [cc.slugOf(cwdB)]);
    cc.cleanupRun({ cwd: cwdB, tmpdir: base, tmpBases: [base], uid });
    assert.equal(fs.existsSync(path.join(base, `claude-${uid}`)), false, 'the empty per-user directory goes too');
    assert.deepEqual(cc.cleanupRun({ cwd: cwdA, tmpdir: base, tmpBases: [base], uid }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cleanupRun does not delete through a link the agent planted in the run temp dir', () => {
  const root = tmp();
  try {
    const cwd = path.join(root, 'r-a', 'work');
    fs.mkdirSync(cwd, { recursive: true });
    const uid = 4242;
    const host = path.join(root, 'host-tmp');
    fs.mkdirSync(path.join(host, cc.slugOf(cwd)), { recursive: true });
    fs.writeFileSync(path.join(host, cc.slugOf(cwd), 'keep.txt'), 'HOST');
    const runTmp = path.join(root, 'r-a', 'tmp');
    fs.mkdirSync(runTmp, { recursive: true });
    fs.symlinkSync(host, path.join(runTmp, `claude-${uid}`));
    assert.deepEqual(cc.cleanupRun({ cwd, tmpdir: runTmp, tmpBases: [], uid }), []);
    assert.equal(fs.readFileSync(path.join(host, cc.slugOf(cwd), 'keep.txt'), 'utf8'), 'HOST');
    const linkedTmp = path.join(root, 'r-a', 'tmp-linked');
    fs.symlinkSync(host, linkedTmp);
    fs.mkdirSync(path.join(host, `claude-${uid}`, cc.slugOf(cwd)), { recursive: true });
    assert.deepEqual(cc.cleanupRun({ cwd, tmpdir: linkedTmp, tmpBases: [], uid }), []);
    assert.equal(fs.existsSync(path.join(host, `claude-${uid}`, cc.slugOf(cwd))), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('vanilla run: result fields, command, environment, rules, cleanup and no credentials on disk', async () => {
  const s = setup('vanilla-success');
  try {
    const r = await run(s);
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.harness, 'claude-code');
    assert.equal(r.installHarness, 'none');
    assert.equal(r.harnessVersion, '9.9.9');
    assert.equal(r.model, MODEL);
    assert.equal(r.credits, null);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.costCensored, false);
    assert.equal(r.costUsd, 0.0437613);
    assert.equal(r.region, 'us-east-1');
    assert.equal(r.finalText, 'hi');
    assert.equal(r.toolCalls, 1);
    assert.equal(r.subagentCalls, 0);
    assert.equal(r.tokens.total, r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite);
    assert.deepEqual(r.estTokens, { value: r.tokens.total, isEstimate: false });
    assert.equal(r.claudeCode.canonicalModel, CANON);
    assert.deepEqual(r.claudeCode.modelsSeen, [CANON]);
    assert.equal(r.claudeCode.costBasis, 'list');
    assert.deepEqual(r.flags, []);
    assert.equal(r.checks[0].passed, true);
    assert.deepEqual(validateResult(r), []);

    const st = started(s);
    assert.match(st.cwd, /scratch\/r-[^/]+\/work$/);
    assert.equal(st.stdinIsTty, false);
    assert.equal(st.args[0], '-p');
    assert.equal(st.args.includes('--agent'), false);
    assert.equal(st.args[st.args.indexOf('--max-budget-usd') + 1], '0.75');
    assert.equal(st.configDir, path.join(st.home, '.claude'));
    assert.deepEqual(st.rules, ['empty.md']);
    assert.deepEqual(st.agents, null, 'no agents are installed for vanilla');
    for (const k of ['AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'GITHUB_TOKEN']) assert.equal(st.envKeys.includes(k), false, k);
    for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'CLAUDE_CODE_USE_BEDROCK']) assert.ok(st.envKeys.includes(k), k);
    assert.match(st.env.TMPDIR, /scratch\/r-[^/]+\/tmp$/);
    assert.equal(st.env.CLAUDE_CODE_TMPDIR, st.env.TMPDIR);

    assert.deepEqual(fs.readdirSync(s.scratchDir), [], 'run root removed');
    assert.deepEqual(fs.readdirSync(s.tmpBase), [], 'the claude-<uid> task directory the fake made is removed');
    assert.deepEqual(r.claudeCode.tmpCleanup, { removed: 1, inRunTmpdir: 0, inDefaultTmp: 1 });
    const hits = scanTree(s.root, { literals: [SECRET, TOKEN, KEY_ID] }).filter((h) => !h.file.includes('/probe/') && !h.file.includes('/tools/'));
    assert.deepEqual(hits, [], 'no credential value in any file the run left');
    assert.equal(fs.readFileSync(path.join(s.outDir, 'command.txt'), 'utf8').includes(SECRET), false);
  } finally {
    s.cleanup();
  }
});

test('konductor run: agent flag, 11 agents, delegation counted, orch metrics from the parent chain, one model', async () => {
  const s = setup('delegation-dashed-pin');
  try {
    const r = await run(s, CC_KONDUCTOR);
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.installHarness, 'claude');
    const st = started(s);
    assert.equal(st.args[st.args.indexOf('--agent') + 1], 'konductor');
    assert.ok(st.args.includes('--include-hook-events'));
    assert.equal(st.agents.length, 11);
    assert.deepEqual(st.rules, ['empty.md']);
    assert.equal(st.env.KONDUCTOR_TELEMETRY, 'off');
    assert.equal(r.subagentCalls, 1);
    assert.equal(r.orch.spawns, 1);
    assert.equal(r.orch.maxSpawnDepth, 1);
    assert.equal(r.claudeCode.spawned, 1);
    assert.equal(r.claudeCode.spawnFailed, 0);
    assert.equal(r.claudeCode.hookEvents, 2);
    assert.deepEqual(r.claudeCode.modelsSeen, [CANON]);
    assert.equal(r.claudeCode.modelUsageKeys.length, 2);
    assert.equal(r.modelNormalized, false);
    assert.ok(r.skillsLoaded.some((x) => x.name === 'delegation-protocol'));
    assert.equal(r.skillsScope, 'all-sessions');
    assert.equal(r.capInvocation.firstDecision.kind, 'skill');
    assert.equal(r.flags.includes('modelMismatch'), false);
    assert.equal(r.costUsd, 0.16910830000000002);
    assert.ok(fs.existsSync(path.join(s.outDir, 'installed-settings.json')));
    assert.match(fs.readFileSync(path.join(s.outDir, 'install.log'), 'utf8'), /agents \(11\)/);
    assert.deepEqual(validateResult(r), []);
  } finally {
    s.cleanup();
  }
});

test('a run on another model is a model mismatch and not a success', async () => {
  const s = setup('opus-fallback');
  try {
    const r = await run(s, CC_KONDUCTOR);
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('modelMismatch'));
    assert.match(r.error, /claude-opus-5-5, expected claude-sonnet-5-5/);
    assert.deepEqual(r.claudeCode.modelsSeen.sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
    assert.equal(typeof r.costUsd, 'number', 'the spend stays recorded');
  } finally {
    s.cleanup();
  }
});

test('a credential error is an infra error and not a model failure', async () => {
  const s = setup('synthetic-credential-error', { exitCode: 1 });
  try {
    const r = await run(s);
    assert.equal(r.status, 'error');
    assert.match(r.infraError, /could not load AWS credentials/);
    assert.equal(r.claudeCode.errorKind, 'credentials');
    assert.equal(r.costUsd, 0);
    assert.equal(r.flags.includes('modelMismatch'), false, 'no model was seen, so there is nothing to mismatch');
  } finally {
    s.cleanup();
  }
});

test('a credential error with no result line (killed or timed out) is still an infra error with a reason', async () => {
  const s = setup('synthetic-credential-error-killed', { exitCode: 143 });
  try {
    const r = await run(s);
    assert.equal(r.status, 'error');
    assert.match(r.infraError, /could not load AWS credentials/);
    assert.equal(r.claudeCode.errorKind, 'credentials');
    assert.equal(r.flags.includes('modelMismatch'), false);
  } finally {
    s.cleanup();
  }
});

test('a result line with no cost and a stream with a broken line are flagged, not silently zero', async () => {
  const s = setup('vanilla-success');
  try {
    const lines = fs.readFileSync(path.join(FX, 'vanilla-success.stream.jsonl'), 'utf8').trim().split('\n').map((l) => {
      const ev = JSON.parse(l);
      if (ev.type === 'result') delete ev.total_cost_usd;
      return JSON.stringify(ev);
    });
    const streamFile = path.join(s.root, 'damaged.stream.jsonl');
    fs.writeFileSync(streamFile, `${lines.join('\n')}\n{"type":"assistant","message":{"id":"cut\n`);
    fs.writeFileSync(path.join(path.dirname(s.bin), 'fake-claude.config.json'), JSON.stringify({ dir: s.probe, streamFile, tmpBases: [s.tmpBase], helloText: 'hello\n' }));
    const r = await run(s);
    assert.ok(r.flags.includes('costMissing'));
    assert.ok(r.flags.includes('streamTruncated'));
    assert.equal(r.claudeCode.badLines, 1);
    assert.equal(r.costUsd, null, 'a missing cost is not recorded as zero');
  } finally {
    s.cleanup();
  }
});

test('an API error with no model seen is an error with its reason, not a model mismatch', async () => {
  const s = setup('model-400', { exitCode: 1 });
  try {
    const r = await run(s);
    assert.equal(r.status, 'error');
    assert.equal(r.flags.includes('modelMismatch'), false);
    assert.match(r.error, /400/);
    assert.equal(r.claudeCode.errorKind, 'api');
    assert.equal(r.infraError, null);
  } finally {
    s.cleanup();
  }
});

test('a denied tool call is flagged and the run is still a success', async () => {
  const s = setup('permission-denied');
  try {
    const r = await run(s);
    assert.equal(r.status, 'success');
    assert.ok(r.flags.includes('permissionDenied'));
    assert.equal(r.claudeCode.permissionDenials, 1);
  } finally {
    s.cleanup();
  }
});

test('a secret the agent prints is scrubbed from every output and the run is flagged', async () => {
  const s = setup('vanilla-success', { leak: true });
  try {
    const r = await run(s);
    assert.ok(r.flags.includes('credsRedacted'));
    assert.deepEqual(scanTree(s.outDir, { literals: [SECRET, TOKEN] }).filter((h) => h.pattern === 'exact secret value'), []);
    assert.equal(fs.readFileSync(path.join(s.outDir, 'stream.jsonl'), 'utf8').includes(SECRET), false);
    assert.equal(JSON.stringify(r).includes(SECRET), false);
  } finally {
    s.cleanup();
  }
});

test('a timed-out run is killed, has no result line and its cost is censored', async () => {
  const s = setup('sigterm', { sleepSec: 30 });
  s.task.timeoutSec = 1;
  try {
    const r = await run(s);
    assert.equal(r.status, 'timeout');
    assert.equal(r.runFinishedStatus, null);
    assert.equal(r.costCensored, true);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.turnDurationMs, null);
    assert.throws(() => process.kill(started(s).pid, 0), /ESRCH/);
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
    assert.deepEqual(fs.readdirSync(s.tmpBase), [], 'the task directory made before the kill is removed');
  } finally {
    s.cleanup();
  }
});

test('a stream cut off after tool use (SIGTERM shape) is censored with a token lower bound', async () => {
  const s = setup('sigterm', { exitCode: 143 });
  try {
    const r = await run(s);
    assert.equal(r.status, 'error');
    assert.equal(r.costCensored, true);
    assert.equal(r.costUsd, null);
    assert.ok(r.tokens.cacheRead > 0);
  } finally {
    s.cleanup();
  }
});

test('turnSummary returns the last answer of a finished run', () => {
  const t = cc.turnSummary(fs.readFileSync(path.join(FX, 'vanilla-success.stream.jsonl'), 'utf8'));
  assert.equal(t.runFinishedStatus, 'success');
  assert.equal(t.finalText, 'hi');
  assert.equal(t.askedUser, false);
});

test('if claude honors TMPDIR (simulated, not verified against the real binary) its task directory goes with the run', async () => {
  const s = setup('vanilla-success', { tmpBases: null });
  try {
    const cfgFile = path.join(path.dirname(s.bin), 'fake-claude.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    delete cfg.tmpBases;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    const r = await run(s);
    assert.equal(r.status, 'success', r.error);
    const made = fs.readdirSync(s.probe).filter((f) => f.startsWith('made-')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(s.probe, f), 'utf8')));
    assert.equal(made.length, 1);
    assert.match(made[0], /scratch\/r-[^/]+\/tmp\/claude-\d+\//);
    assert.equal(fs.existsSync(made[0]), false);
    assert.deepEqual(r.claudeCode.tmpCleanup, { removed: 1, inRunTmpdir: 1, inDefaultTmp: 0 });
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
    assert.deepEqual(fs.readdirSync(s.tmpBase), []);
  } finally {
    s.cleanup();
  }
});

test('two runs at once each remove only their own claude-<uid> directory and leave a foreign one', async () => {
  const a = setup('vanilla-success');
  try {
    const uid = process.getuid();
    const foreign = path.join(a.tmpBase, `claude-${uid}`, '-some-other-session', 'tasks');
    fs.mkdirSync(foreign, { recursive: true });
    const b = { ...a, outDir: path.join(a.root, 'out2', 't1'), scratchDir: path.join(a.root, 'scratch2') };
    fs.mkdirSync(b.scratchDir);
    b.ctx = { ...a.ctx, scratchDir: b.scratchDir };
    const [r1, r2] = await Promise.all([run(a), run(b)]);
    assert.equal(r1.status, 'success', r1.error);
    assert.equal(r2.status, 'success', r2.error);
    assert.deepEqual(fs.readdirSync(path.join(a.tmpBase, `claude-${uid}`)), ['-some-other-session']);
    assert.equal(fs.existsSync(foreign), true);
  } finally {
    a.cleanup();
  }
});
