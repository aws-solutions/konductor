#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The harness plugin kit: four checks of a plugin folder, with no model call (FW-16).
//   contract    plugin.json read the way the bench does (core/registry.js), the descriptor, the module's members
//               against runner/lib/harness/CONTRACT.md, and what turnSummary and parseResult fill from the recorded
//               stream test/conformance.js names
//   fake-run    the harness's own command path with replay-agent.js in place of its binary: the prompt reaches the
//               agent, no host variable leaks through env(), and the result.json built from the run validates
//   plant-kind  a descriptor with plant arms names a known mount and pin, and the plant reader finds the stream's calls
//   golden      what parseResult reads from the recorded stream equals test/golden.json (--record writes it)
// harness-contract.test.js runs the contract check over every harness, built-in or plugin; kit-plugin.test.js runs all
// four. A new plugin starts from bench/kit/plugin-template.
//
//   node bench/kit/plugin/check.js [--record] bench/plugins/<name> [more plugin dirs]   one line per check; exit 1 on any

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readPlugin } = require('../../core/registry.js');

const BENCH = path.resolve(__dirname, '..', '..');
const CONTRACT = fs.readFileSync(path.join(BENCH, 'runner', 'lib', 'harness', 'CONTRACT.md'), 'utf8');
const COST_UNITS = ['credits', 'usd'];

/** First-column member names of the table under the "## <title>" heading of CONTRACT.md. */
function contractMembers(title) {
  const start = CONTRACT.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`CONTRACT.md has no "${title}" section`);
  const rest = CONTRACT.slice(start + 1);
  const end = rest.indexOf('\n## ', 3);
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/^\| `([A-Za-z]+)/gm)].map((m) => m[1]);
}
const REQUIRED = contractMembers('Required members');
const OPTIONAL = contractMembers('Optional members');

/** Problems with `harness.streams` (CONTRACT.md, `streams`): finalText always, timeline and stopEvent when the descriptor supports them. */
function streamsProblems(harness) {
  const s = harness.streams;
  if (!s || typeof s !== 'object') return ['streams must be an object with finalText (CONTRACT.md, "streams")'];
  const out = [];
  if (typeof s.finalText !== 'function') out.push('streams.finalText must be a function');
  if (harness.meta?.supports?.trace && typeof s.timeline !== 'function') out.push('streams.timeline must be a function when meta.supports.trace');
  if (harness.meta?.supports?.stopOn && typeof s.stopEvent !== 'function') out.push('streams.stopEvent must be a function when meta.supports.stopOn');
  return out;
}

/** Problems with `harness`'s members against the contract tables; `id` is the name it must carry. */
function memberProblems(id, harness) {
  const out = [];
  if (harness.id !== id) out.push(`id must be "${id}", got ${JSON.stringify(harness.id)}`);
  for (const name of REQUIRED.filter((n) => n !== 'id')) if (typeof harness[name] !== 'function') out.push(`${name} must be a function`);
  for (const name of OPTIONAL) {
    const v = harness[name];
    if (v === undefined) continue;
    if (name === 'streams') continue;
    const list = name === 'requiredPaths' || name === 'credentialEnv';
    if (list ? !(Array.isArray(v) && v.every((p) => typeof p === 'string')) : typeof v !== 'function') out.push(`${name} must be ${list ? 'a string array' : 'a function'} when present`);
  }
  if (harness.cleanupRun && typeof harness.describeCleanup !== 'function') out.push('describeCleanup is required when cleanupRun is defined');
  out.push(...streamsProblems(harness));
  return out;
}

/** Problems with a descriptor's fields a plugin most often gets wrong (the full field list is registry.test.js's). */
function descriptorProblems(meta) {
  const out = [];
  if (!Object.isFrozen(meta)) out.push('meta must be frozen');
  for (const k of ['label', 'proseName', 'streamFormat']) if (typeof meta[k] !== 'string' || !meta[k]) out.push(`meta.${k} must be a non-empty string`);
  if (typeof meta.armPrefix !== 'string' || !/^[a-z]+-$/.test(meta.armPrefix)) out.push('meta.armPrefix must be letters and a hyphen (only the built-in kiro-cli has none)');
  if (!COST_UNITS.includes(meta.costUnit)) out.push(`meta.costUnit must be one of ${COST_UNITS.join(', ')}`);
  if (!meta.report || typeof meta.report !== 'object') out.push('meta.report must be an object (CONTRACT.md, "Descriptor")');
  return out;
}

/** The vanilla arm of runtime `id` the kit runs with (its arm prefix, or the bare id for a harness without one). */
const kitArm = (id, meta) => ({ id: `${meta?.armPrefix || `${id}-`}vanilla`, label: 'vanilla', runtime: id, vanilla: true, ref: null, commitSha: null, harness: 'none', agent: null });

/**
 * What `harness` reads from the recorded run `streamText`: `turn` from turnSummary and `acc` from parseResult, run
 * in `root/out` with `root/home` and `root/tmp`. The contract and golden checks both read this.
 */
function readRecorded({ harness, streamText, ctx, config, root, id, outDir = path.join(root, 'out'), home = path.join(root, 'home') }) {
  const turn = harness.turnSummary(streamText);
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(tmpdir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stream.jsonl'), streamText);
  const acc = { agg: null, session: null, checks: [], transcript: null, meta: { flags: [] } };
  harness.parseResult(outDir, { home, tmpdir, acc, arm: kitArm(id, harness.meta), ctx: { envKeep: [], skillInfo: new Map(), ...ctx }, config });
  return { turn, acc };
}

/**
 * Problems found when `harness` reads one recorded single-turn run: `streamText` (one tool call, one final answer),
 * `ctx` (what parseResult reads besides the stream), `config` (the run's model config), `isUsd` (a USD runtime) and
 * `freeModel` (the run cost nothing). `root` is a scratch dir the caller removes.
 */
function streamProblems({ harness, streamText, ctx, config, isUsd, freeModel, root, id }) {
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  const { turn, acc } = readRecorded({ harness, streamText, ctx, config, root, id });
  need(typeof turn.sessionId === 'string', 'turnSummary must return a sessionId');
  need(turn.runFinishedStatus === 'success', 'turnSummary must read runFinishedStatus "success"');
  need(Boolean(turn.finalText), 'turnSummary must return the final answer');
  const a = acc.agg;
  if (!a) return [...out, 'parseResult must set acc.agg'];
  need(typeof a.sessionId === 'string' && Array.isArray(a.sessionIds) && a.sessionIds.includes(a.sessionId), 'acc.agg.sessionId must be a string listed in sessionIds');
  need(a.runFinishedStatus === 'success', 'acc.agg.runFinishedStatus must be "success"');
  need(a.stopReason === null || typeof a.stopReason === 'string', 'acc.agg.stopReason must be a string or null');
  need(typeof a.finalText === 'string' && a.finalText.length > 0 && a.finalText.length <= 20000, 'acc.agg.finalText must be 1 to 20000 characters');
  need(typeof a.finalTextTruncated === 'boolean', 'acc.agg.finalTextTruncated must be a boolean');
  need(Number.isInteger(a.toolCalls) && a.toolCalls >= 1, 'acc.agg.toolCalls must count the fixture\'s tool call');
  need(a.toolNames && typeof a.toolNames === 'object' && Object.keys(a.toolNames).length >= 1, 'acc.agg.toolNames must name the tool');
  need(a.subagentCalls === 0 && a.workToolCalls === a.toolCalls - a.subagentCalls, 'acc.agg.subagentCalls must be 0 and workToolCalls the rest');
  need(typeof a.delegatedTo === 'object', 'acc.agg.delegatedTo must be an object');
  need(typeof a.credits === 'number' && typeof a.meteringEntries === 'number' && Array.isArray(a.nonCreditUnits), 'acc.agg credits, meteringEntries and nonCreditUnits must be set');
  for (const k of ['skillsMcpOk', 'askedUser']) need(a[k] === null || typeof a[k] === 'boolean', `acc.agg.${k} must be a boolean or null`);
  for (const k of ['turnDurationMs', 'contextUsagePercentage']) need(a[k] === null || typeof a[k] === 'number', `acc.agg.${k} must be a number or null`);
  need(acc.session && typeof acc.session.model === 'string' && Number.isInteger(acc.session.totalRequestCount) && acc.session.totalRequestCount >= 1, 'acc.session must name the model and count at least one request');
  const t = acc.transcript;
  need(t && t.bytes > 0 && t.chars > 0 && typeof t.partial === 'boolean', 'acc.transcript must be { bytes, chars, partial }');
  need(Boolean(acc.skills), 'acc.skills must be set');
  need(Array.isArray(acc.meta.flags) && !acc.meta.flags.includes('usageUnavailable'), 'the usage source must be readable (no usageUnavailable flag)');
  if (isUsd) {
    need(a.credits === 0 && a.meteringEntries === 0, 'a USD runtime reports 0 credits and 0 metering entries');
    const u = acc.usage;
    if (!u) return [...out, 'a USD runtime must set acc.usage'];
    for (const k of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total']) need(typeof u.tokens?.[k] === 'number', `acc.usage.tokens.${k} must be a number`);
    need(typeof u.costUsd === 'number' && (freeModel ? u.costUsd === 0 : u.costUsd > 0), freeModel ? 'a free model run costs 0 USD' : 'acc.usage.costUsd must be above 0');
    need(Number.isInteger(u.modelCalls) && Number.isInteger(u.sessions) && Array.isArray(u.variants), 'acc.usage modelCalls, sessions and variants must be set');
  } else {
    need(a.credits > 0 && a.meteringEntries > 0, 'a credit runtime must report credits');
    need(acc.usage === undefined, 'a credit runtime leaves acc.usage unset');
  }
  return out;
}

// A marker the fake-run check puts in the task prompt and a host-only variable it sets while env() runs.
const PROMPT_MARK = 'KIT-PROMPT-7f3a';
const CANARY = 'kit-host-canary-7f3a';
const REPLAY = path.join(__dirname, 'replay-agent.js');

/**
 * Problems found when the harness's own command path runs one task with the replay agent (replay-agent.js) in place
 * of its binary: installInto, buildCommand (the prompt must reach the agent), env through the core rules (no host
 * variable may leak), the run itself, parseResult, collectArtifacts and removeCredentials, and a result.json that
 * validates against the result schema. `newCtx()` returns a fresh run ctx; `fixture` is the recorded stream file.
 */
function fakeRunProblems({ id, harness, conf, newCtx, fixture, root }) {
  const { agentEnv } = require('../../runner/lib/env.js');
  const { buildResult } = require('../../runner/lib/result.js');
  const { validate, loadSchema } = require('../../runner/lib/schema.js');
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  const [home, tmpdir, cwd, outDir] = ['home', 'tmp', 'work/repo', 'out'].map((d) => path.join(root, d));
  for (const d of [home, tmpdir, cwd, outDir]) fs.mkdirSync(d, { recursive: true });
  const arm = kitArm(id, harness.meta);
  const task = { id: 'kit-task', class: 'simple', prompt: `${PROMPT_MARK} reply with one word`, checks: [], rubric: [] };
  const config = conf.config ?? {};
  const ctx = { envKeep: [], skillInfo: new Map(), ...newCtx() };
  const meta = { flags: [], isolation: 'none', agentStarted: true, ...(harness.installInto(home, { arm, prepared: conf.prepared ?? {}, ctx, config, outDir }) ?? {}) };
  const cmd = harness.buildCommand({ arm, task, config, ctx, cwd, resume: null, home });
  need(typeof cmd?.file === 'string' && cmd.file.length > 0, 'buildCommand must return a file');
  need(Array.isArray(cmd?.args) && cmd.args.every((a) => typeof a === 'string'), 'buildCommand must return args as strings');
  need(typeof cmd?.display === 'string', 'buildCommand must return a display string');
  if (out.length) return out;
  const inArgs = cmd.args.some((a) => a.includes(PROMPT_MARK));
  need(inArgs || (typeof cmd.stdin === 'string' && cmd.stdin.includes(PROMPT_MARK)), 'the prompt must reach the agent, in args or in stdin');
  const keys = ['KIT_HOST_ONLY', 'AWS_SECRET_ACCESS_KEY'];
  const saved = keys.map((k) => process.env[k]);
  keys.forEach((k) => { process.env[k] = CANARY; });
  let env;
  try {
    ({ env } = agentEnv(harness, { arm, config, ctx, home, tmpdir }));
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
  need(!Object.values(env).includes(CANARY), 'a host variable reached the agent env: env() must build an allowlist, not copy process.env');
  need(env.HOME === home, "env().HOME must be the run's scratch HOME");
  const log = path.join(root, 'replay.json');
  const r = spawnSync(process.execPath, [REPLAY, fixture, log, cmd.file, ...cmd.args], { cwd, env, input: cmd.stdin ?? '', encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return [...out, `the replay agent failed (exit ${r.status}): ${(r.stderr || r.error?.message || '').trim().split('\n').at(-1)}`];
  const seen = JSON.parse(fs.readFileSync(log, 'utf8'));
  need(seen.argv[0] === cmd.file && [...seen.argv.slice(1), seen.stdin].some((a) => a.includes(PROMPT_MARK)), 'the agent process must get the command line and prompt buildCommand returned');
  fs.writeFileSync(path.join(outDir, 'stream.jsonl'), r.stdout);
  const acc = { agg: null, session: null, checks: [], transcript: null, meta };
  harness.parseResult(outDir, { home, tmpdir, acc, arm, ctx, config });
  harness.collectArtifacts(home, outDir, { arm });
  harness.removeCredentials(home);
  harness.removeCredentials(home);
  const paths = harness.keepPaths(ctx);
  need(Array.isArray(paths) && paths.every((p) => typeof p === 'string' && path.isAbsolute(p)), 'keepPaths must return absolute paths');
  if (!acc.agg) return [...out, 'parseResult set no acc.agg on the replayed run'];
  const result = buildResult({ arm, task, replicate: 1, config, exec: { timedOut: false, exitCode: 0, wallClockMs: 1 }, agg: acc.agg, session: acc.session, usage: acc.usage ?? null, skills: acc.skills ?? null, checks: [], transcript: acc.transcript, env: {}, meta: acc.meta });
  need(result.status === 'success', `the replayed run must read as a success, got ${result.status}${result.error ? ` (${result.error})` : ''}`);
  for (const e of validate(loadSchema('result'), result)) out.push(`result.json: ${e}`);
  return out;
}

/**
 * Problems with the plant side of a descriptor. `meta.plant` null means no plant arms and passes. Otherwise the mount
 * must be one the runner knows, the pin key a name, the stream format must have a plant reader, and that reader must
 * find the recorded stream's plant calls (`conf.plantCalls`, default 1).
 */
function plantProblems({ meta, conf, streamText }) {
  if (meta.plant === null) return [];
  const { PLANT_MOUNTS } = require('../../runner/lib/plant/lifecycle.js');
  const { hasPlantReader, streamCallsOf } = require('../../runner/lib/plant/stream-match.js');
  const { parseStream } = require('../../runner/lib/stream.js');
  const out = [];
  const p = meta.plant;
  if (!p || typeof p !== 'object') return ['meta.plant must be null or { mount, pinKey }'];
  if (!PLANT_MOUNTS.includes(p.mount)) out.push(`meta.plant.mount "${p.mount}" is not one of ${PLANT_MOUNTS.join(', ')}`);
  if (typeof p.pinKey !== 'string' || !p.pinKey) out.push('meta.plant.pinKey must name the release pin of the agent');
  if (!hasPlantReader(meta.streamFormat)) return [...out, `no plant stream reader for ${meta.streamFormat}: plant/stream-match.js must read its plant calls`];
  const want = conf.plantCalls ?? 1;
  const { calls } = streamCallsOf(meta.streamFormat, parseStream(streamText).events);
  if (calls.length !== want) out.push(`the plant reader found ${calls.length} plant call(s) in the recorded stream, conformance.js expects ${want}`);
  return out;
}

const GOLDEN = 'golden.json';

/** What the harness reads from the recorded stream, with the scratch root written as <root> so it compares. */
function goldenView(args) {
  const { turn, acc } = readRecorded(args);
  const view = { turn, agg: acc.agg, session: acc.session, usage: acc.usage ?? null, transcript: acc.transcript, skills: acc.skills ?? null, flags: acc.meta.flags };
  return JSON.parse(JSON.stringify(view).split(args.root).join('<root>'));
}

/** "a.b.c" -> JSON value of every leaf of `o`. */
function leaves(o, prefix = '', out = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length) {
    for (const [k, v] of Object.entries(o)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = JSON.stringify(o);
  return out;
}

/** Problems when `view` differs from the plugin's test/golden.json: one line per changed field, at most 10. */
function goldenProblems(testDir, view) {
  const file = path.join(testDir, GOLDEN);
  if (!fs.existsSync(file)) return [`test/${GOLDEN} is missing: write it with node bench/kit/plugin/check.js --record <plugin dir>`];
  const want = leaves(JSON.parse(fs.readFileSync(file, 'utf8')));
  const got = leaves(view);
  const diffs = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter((k) => want[k] !== got[k])
    .map((k) => `${k}: golden ${want[k] ?? '(none)'}, now ${got[k] ?? '(none)'}`);
  return diffs.length > 10 ? [...diffs.slice(0, 10), `and ${diffs.length - 10} more changed fields`] : diffs;
}

const CHECKS = Object.freeze(['contract', 'fake-run', 'plant-kind', 'golden']);

/**
 * The four kit checks of the harness plugin in `dir`, each a list of problems ([] passes). The contract check runs
 * first; when it fails the other three are not run and read `null`. `record: true` writes test/golden.json from the
 * current reading instead of comparing.
 */
function checksOf(dir, { record = false } = {}) {
  const r = readPlugin(path.resolve(dir));
  const skipped = { 'fake-run': null, 'plant-kind': null, golden: null };
  if (r.refused) return { contract: [`plugin.json: ${r.refused.why}`], ...skipped };
  const { name, meta, entry } = r.plugin;
  const harness = require(entry);
  const contract = [...descriptorProblems(meta), ...memberProblems(name, harness)];
  if (harness.meta !== meta) contract.push('the module must export the same meta object its plugin.json names (meta: require(\'./meta.js\'))');
  const testDir = path.join(r.plugin.dir, 'test');
  const confFile = path.join(testDir, 'conformance.js');
  if (!fs.existsSync(confFile)) return { contract: [...contract, 'test/conformance.js is missing: it names the recorded stream, the config and the ctx'], ...skipped };
  const conf = require(confFile);
  const fixture = path.join(testDir, conf.fixture ?? '');
  if (!conf.fixture || !fs.existsSync(fixture)) return { contract: [...contract, `the recorded stream ${conf.fixture} is missing under test/`], ...skipped };
  const streamText = fs.readFileSync(fixture, 'utf8');
  const config = conf.config ?? {};
  // Each check gets its own scratch root and a fresh ctx, so one cannot pass on what another left behind.
  const inRoot = (fn) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-check-'));
    try { return fn(root, () => (conf.setup ? conf.setup({ root, home: path.join(root, 'home') }) : {})); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  };
  const caught = (fn) => { try { return fn(); } catch (e) { return [`threw: ${e.message}`]; } };
  const out = { contract: [...contract, ...inRoot((root, newCtx) => caught(() => streamProblems({ id: name, harness, streamText, ctx: newCtx(), config, isUsd: meta.costUnit === 'usd', freeModel: Boolean(conf.freeModel), root })))] };
  if (out.contract.length) return { ...out, ...skipped };
  out['fake-run'] = inRoot((root, newCtx) => caught(() => fakeRunProblems({ id: name, harness, conf, newCtx, fixture, root })));
  out['plant-kind'] = caught(() => plantProblems({ meta, conf, streamText }));
  out.golden = inRoot((root, newCtx) => caught(() => {
    const view = goldenView({ harness, streamText, ctx: newCtx(), config, root, id: name });
    if (!record) return goldenProblems(testDir, view);
    fs.writeFileSync(path.join(testDir, GOLDEN), `${JSON.stringify(view, null, 2)}\n`);
    return [];
  }));
  return out;
}

/** Every problem of the harness plugin in `dir`, each prefixed with its check's name. [] passes all four checks. */
function checkHarnessPlugin(dir) {
  const checks = checksOf(dir);
  return CHECKS.flatMap((c) => (checks[c] ?? []).map((p) => (c === 'contract' ? p : `${c}: ${p}`)));
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const record = argv.includes('--record');
  const dirs = argv.filter((a) => a !== '--record');
  if (!dirs.length) { process.stderr.write('usage: node bench/kit/plugin/check.js [--record] <plugin dir>...\n'); process.exit(2); }
  let bad = 0;
  for (const d of dirs) {
    const checks = checksOf(d, { record });
    const failed = CHECKS.filter((c) => checks[c] === null || checks[c].length);
    bad += failed.length;
    const lines = CHECKS.map((c) => (checks[c] === null ? `  SKIP ${c} (the contract check failed)\n` : checks[c].length ? `  FAIL ${c}\n${checks[c].map((p) => `    - ${p}\n`).join('')}` : `  PASS ${c}\n`));
    process.stdout.write(`${failed.length ? 'FAIL' : 'PASS'} ${d}\n${lines.join('')}`);
    if (record && !failed.length) process.stdout.write(`  wrote ${path.join(d, 'test', GOLDEN)}\n`);
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { checkHarnessPlugin, checksOf, CHECKS, goldenView, memberProblems, descriptorProblems, streamProblems, fakeRunProblems, plantProblems, goldenProblems, contractMembers };
