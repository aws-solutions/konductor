#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The harness plugin kit: checks a plugin folder against the harness contract (runner/lib/harness/CONTRACT.md) with no
// model call. It reads plugin.json the way the bench does (core/registry.js), checks the descriptor and the module's
// members, then feeds the plugin's recorded stream (test/conformance.js names it) to turnSummary and parseResult and
// checks what they fill. harness-contract.test.js runs the same checks over every harness, built-in or plugin.
//
//   node bench/kit/plugin/check.js bench/plugins/<name> [more plugin dirs]   prints PASS or each problem; exit 1 on any

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

/**
 * Problems found when `harness` reads one recorded single-turn run: `streamText` (one tool call, one final answer),
 * `ctx` (what parseResult reads besides the stream), `config` (the run's model config), `isUsd` (a USD runtime) and
 * `freeModel` (the run cost nothing). `root` is a scratch dir the caller removes.
 */
function streamProblems({ harness, streamText, ctx, config, isUsd, freeModel, root, id }) {
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  const turn = harness.turnSummary(streamText);
  need(typeof turn.sessionId === 'string', 'turnSummary must return a sessionId');
  need(turn.runFinishedStatus === 'success', 'turnSummary must read runFinishedStatus "success"');
  need(Boolean(turn.finalText), 'turnSummary must return the final answer');
  const home = path.join(root, 'home');
  const outDir = path.join(root, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stream.jsonl'), streamText);
  const acc = { agg: null, session: null, checks: [], transcript: null, meta: { flags: [] } };
  harness.parseResult(outDir, { home, tmpdir: path.join(root, 'tmp'), acc, arm: { id: `${id}-vanilla`, vanilla: true, runtime: id }, ctx: { envKeep: [], skillInfo: new Map(), ...ctx }, config });
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

/** Every problem of the harness plugin in `dir`: manifest, descriptor, members and its recorded stream. [] passes. */
function checkHarnessPlugin(dir) {
  const r = readPlugin(path.resolve(dir));
  if (r.refused) return [`plugin.json: ${r.refused.why}`];
  const { name, meta, entry } = r.plugin;
  const harness = require(entry);
  const out = [...descriptorProblems(meta), ...memberProblems(name, harness)];
  if (harness.meta !== meta) out.push('the module must export the same meta object its plugin.json names (meta: require(\'./meta.js\'))');
  const confFile = path.join(r.plugin.dir, 'test', 'conformance.js');
  if (!fs.existsSync(confFile)) return [...out, 'test/conformance.js is missing: it names the recorded stream, the config and the ctx'];
  const conf = require(confFile);
  const fixture = path.join(r.plugin.dir, 'test', conf.fixture ?? '');
  if (!conf.fixture || !fs.existsSync(fixture)) return [...out, `the recorded stream ${conf.fixture} is missing under test/`];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-check-'));
  try {
    const ctx = conf.setup ? conf.setup({ root, home: path.join(root, 'home') }) : {};
    return [...out, ...streamProblems({ id: name, harness, streamText: fs.readFileSync(fixture, 'utf8'), ctx, config: conf.config ?? {}, isUsd: meta.costUnit === 'usd', freeModel: Boolean(conf.freeModel), root })];
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { process.stderr.write('usage: node bench/kit/plugin/check.js <plugin dir>...\n'); process.exit(2); }
  let bad = 0;
  for (const d of dirs) {
    const problems = checkHarnessPlugin(d);
    bad += problems.length;
    process.stdout.write(problems.length ? `FAIL ${d}\n${problems.map((p) => `  - ${p}\n`).join('')}` : `PASS ${d}\n`);
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { checkHarnessPlugin, memberProblems, descriptorProblems, streamProblems, contractMembers };
