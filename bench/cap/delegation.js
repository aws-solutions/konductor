// SPDX-License-Identifier: Apache-2.0
'use strict';

// Stage 2's selection test (keep-or-prune of agent files, DEBT D-172): does the orchestrator hand a request to an agent
// when the request needs it, and keep it away when it does not? The stage 2 check measures the agent's effect once it
// has the work; this test says how often it gets the work at all. It mirrors stage 1's skill test (selection.js).
//
//   requests    `<kind>-<name>/delegation.json` beside the unit baseline: { format_version, agent, writtenBy,
//               reviewedBy, requests: [{ id, prompt, expect: delegate | none }] }, at least 3 of each and no prompt
//               naming the agent. A set with no reviewer is a draft: its result says so.
//   delegations read from the agent stream with the runner's own code: parseStream and aggregateStream (stream.js)
//               give `delegatedTo`, the agents each subagent call handed work to.
//   score       the trigger scorer (score.js scoreTrigger): a request counts as delegated when it went to the agent
//               in at least half of its repeats; precision and recall over requests. A request handed to another
//               agent is a miss, and that agent is named in `wrongTargets`.
//
// Phase A has only the stub: it writes one kiro-cli stream per request and repeat and reads it back through the same
// code. Nothing here starts a paid run.

const fs = require('node:fs');
const path = require('node:path');
const { parseStream, aggregateStream } = require('../runner/lib/stream.js');
const { scoreTrigger } = require('./score.js');
const { assertStubRun } = require('./stubprovider.js');
const { UNIT_BASELINES_DIR, listUnits } = require('./units.js');
const { readJsonFile } = require('./checkedjson.js');
const { sha256 } = require('../runner/lib/util.js');
const { textFlag: val, repoRootOf } = require('../runner/lib/flag-values.js');
const { BENCH_DIR } = require('../runner/lib/tasks.js');

const MIN_EACH = 3;
/** The agent the `other` stub hands every delegate request to instead: a wrong pick. */
const OTHER_AGENT = 'k-developer';
/** The stub behaviours: what each run delegates to, given the request and the agent under test. */
const STUB_BEHAVIOURS = Object.freeze({
  always: (r, agent) => agent,
  never: () => null,
  correct: (r, agent) => (r.expect === 'delegate' ? agent : null),
  other: (r) => (r.expect === 'delegate' ? OTHER_AGENT : null),
});

/** Problems of a delegation request set for `agent` (empty when it is usable). */
function requestProblems(set, agent) {
  const p = [];
  if (set?.format_version !== 1) p.push(`format_version ${JSON.stringify(set?.format_version)} is not 1`);
  if (set?.agent !== agent) p.push(`the set is for ${JSON.stringify(set?.agent)}, not ${agent}`);
  const requests = Array.isArray(set?.requests) ? set.requests : [];
  for (const expect of ['delegate', 'none']) if (requests.filter((r) => r.expect === expect).length < MIN_EACH) p.push(`at least ${MIN_EACH} requests that expect ${expect} are needed`);
  const ids = new Set();
  for (const r of requests) {
    if (!['delegate', 'none'].includes(r.expect)) p.push(`${r.id}: expect must be delegate or none`);
    if (typeof r.prompt !== 'string' || !r.prompt.trim()) p.push(`${r.id}: no prompt`);
    else if (r.prompt.toLowerCase().includes(agent.toLowerCase())) p.push(`${r.id} names the agent, so it tests the name, not the routing`);
    if (ids.has(r.id)) p.push(`${r.id} is given twice`);
    ids.add(r.id);
  }
  return p;
}

/** A stub kiro-cli stream for one request: a subagent call handing the brief to `target`, or none when it is null. */
function stubStream({ target }) {
  const sid = 'stub-session';
  const events = [{ type: 'runStarted', data: { payloadSchema: 'acp', acpProtocolVersion: 1, engine: 'v2' } }];
  if (target) events.push({ type: 'sessionUpdate', data: { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: 'd1', rawInput: { stages: [{ role: target, prompt_template: 'stub brief' }] }, _meta: { kiro: { toolName: 'subagent' } } } } });
  events.push({ type: 'sessionUpdate', data: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'stub answer' } } } });
  return `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
}

/** The agents a run's kiro-cli stream text handed work to, with counts (stream.js delegatedTo). */
const readStream = (text) => aggregateStream(parseStream(text).events).delegatedTo;

/**
 * Runs the delegation test on the stub: one stream per request and repeat, written under `dir` and read back.
 * `behaviour` is always, never, correct, other, or (request, agent, rep) => the agent a run hands the work to (or null).
 * Returns rows [{ queryId, expect, rep, delegatedTo }].
 */
function runStub({ agent, set, runId, dir, reps = 3, behaviour = 'correct' }) {
  assertStubRun(runId);
  const decide = typeof behaviour === 'function' ? behaviour : STUB_BEHAVIOURS[behaviour];
  if (!decide) throw new Error(`stub behaviour must be ${Object.keys(STUB_BEHAVIOURS).join(', ')} (got ${JSON.stringify(behaviour)})`);
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  for (const r of set.requests) {
    for (let rep = 0; rep < reps; rep++) {
      const file = path.join(dir, `${r.id}.${rep}.stream.jsonl`);
      fs.writeFileSync(file, stubStream({ target: decide(r, agent, rep) }));
      rows.push({ queryId: r.id, expect: r.expect, rep, delegatedTo: readStream(fs.readFileSync(file, 'utf8')) });
    }
  }
  return rows;
}

/** Scores rows for `agent`: { score (scoreTrigger), wrongTargets: { agent: runs } on requests that expect delegate }. */
function scoreDelegation(rows, agent) {
  const wrongTargets = {};
  const trigger = rows.map((r) => {
    const others = Object.keys(r.delegatedTo).filter((a) => a !== agent);
    if (r.expect === 'delegate' && !r.delegatedTo[agent]) for (const a of others) wrongTargets[a] = (wrongTargets[a] ?? 0) + 1;
    return { queryId: r.queryId, expect: r.expect === 'delegate' ? 'load' : 'none', hit: Boolean(r.delegatedTo[agent]), fired: others };
  });
  return { score: scoreTrigger(trigger), runs: rows.length, wrongTargets };
}

/** The record's `delegation` field from a scored run. `frozen` is true for a reviewed request set. */
function delegationResult({ scored, set, setSha256, unitSha256, source, measuredAt = new Date().toISOString().slice(0, 10) }) {
  return {
    precision: scored.score.precision.value, recall: scored.score.recall.value, runs: scored.runs,
    requests: { delegate: set.requests.filter((r) => r.expect === 'delegate').length, none: set.requests.filter((r) => r.expect === 'none').length },
    wrongTargets: scored.wrongTargets, frozen: Boolean(set.reviewedBy), requestsSha256: setSha256, unitSha256, source, measuredAt,
  };
}

const isRate = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const HEX64 = /^[0-9a-f]{64}$/;

/** Problems of a delegation result (empty when it is valid). */
function delegationProblems(d) {
  const p = [];
  if (!(d.precision === null || isRate(d.precision))) p.push('precision must be a rate from 0 to 1, or null');
  if (!isRate(d.recall)) p.push('recall must be a rate from 0 to 1');
  if (!Number.isInteger(d.runs) || d.runs < 1) p.push('runs must be a whole number of 1 or more');
  if (!(d.requests?.delegate >= MIN_EACH && d.requests?.none >= MIN_EACH)) p.push(`requests must hold at least ${MIN_EACH} of each kind`);
  if (typeof d.frozen !== 'boolean') p.push('frozen must be true or false');
  if (!HEX64.test(d.requestsSha256 ?? '') || !HEX64.test(d.unitSha256 ?? '')) p.push('requestsSha256 and unitSha256 must be SHA-256 hashes');
  if (typeof d.source !== 'string' || !d.source) p.push('source must name the run');
  return p;
}

/**
 * The delegation test of one agent on the stub, written to `<outDir>/<runId>/delegation/<agent>.json`.
 * Refuses an entry agent (no orchestrator delegates to it), an unreachable one, a run id that is not stub, and a
 * request set with problems. Returns { result, file }.
 */
function runDelegation({ repo, agent, runId, outDir, reps = 3, behaviour = 'correct', requestsFile = null, baselinesDir = UNIT_BASELINES_DIR }) {
  assertStubRun(runId);
  const unit = listUnits({ repo, kind: 'agent', baselinesDir }).find((u) => u.name === agent);
  if (!unit) throw new Error(`no agent named ${agent} in ${repo}`);
  if (unit.entry || /^unreachable/.test(unit.status)) throw new Error(`${agent}: ${unit.status}`);
  const file = requestsFile ?? path.join(baselinesDir, `agent-${agent}`, 'delegation.json');
  if (!fs.existsSync(file)) throw new Error(`no delegation requests for ${agent}: a person writes ${file} (at least ${MIN_EACH} requests that should go to it and ${MIN_EACH} that should not)`);
  const set = readJsonFile(file);
  const problems = requestProblems(set, agent);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  const dir = path.join(outDir, runId, 'delegation', agent);
  const scored = scoreDelegation(runStub({ agent, set, runId, dir, reps, behaviour }), agent);
  const result = delegationResult({ scored, set, setSha256: sha256(fs.readFileSync(file)), unitSha256: unit.sha256, source: runId });
  const out = path.join(outDir, runId, 'delegation', `${agent}.json`);
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  return { result, file: out };
}

/** The command: runs the stub delegation test of one agent and prints its precision and recall (or the result with --json). */
function cmdDelegation(opts) {
  const agent = val(opts.agent);
  if (!agent) throw new Error('--agent NAME is required');
  const reps = val(opts.reps) === undefined ? 3 : Number(val(opts.reps));
  if (!Number.isInteger(reps) || reps < 1) throw new Error('--reps takes a whole number of 1 or more');
  const { result, file } = runDelegation({
    repo: repoRootOf(opts), agent, runId: val(opts.run) ?? '', outDir: path.resolve(val(opts.out) ?? path.join(BENCH_DIR, 'out', 'unit-stage')),
    reps, behaviour: val(opts['stub-behaviour']) ?? 'correct', requestsFile: val(opts.requests) ? path.resolve(val(opts.requests)) : null,
  });
  if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`${agent}: delegation precision ${result.precision ?? 'n/a (never delegated)'}, recall ${result.recall}, over ${result.runs} stub runs; ${result.frozen ? 'reviewed' : 'draft'} requests. Wrote ${file} (stub data: never a measurement)`);
}

module.exports = { cmdDelegation, STUB_BEHAVIOURS, OTHER_AGENT, requestProblems, stubStream, readStream, runStub, scoreDelegation, delegationResult, delegationProblems, runDelegation };
