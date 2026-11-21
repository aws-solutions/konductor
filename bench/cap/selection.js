// SPDX-License-Identifier: Apache-2.0
'use strict';

// Stage 1's selection test (design 20.10, FR-34): does a skill load when a request needs it, and stay out when it does
// not? It is measured apart from the forced-load check, so the keep-prune record's whole-skill gate can open.
//
//   requests  a skill's frozen selection.json (baselineformats.js validateSelection): requests that should load the
//             skill (expect "load") and requests that should not (expect "none"). A draft file can be scored too, but
//             its result says it is not frozen, and the whole-skill gate stays shut.
//   loads     read from the agent stream with the runner's own code: parseStream and aggregateStream (stream.js), then
//             extractSkills and capInvocationOf (skills.js), as result.json is built. A load counts only when the call
//             returned text (skillsLoaded), and a skill loaded twice in one run counts once (trigger.js liveRow). A call
//             that asked for the skill and got no text is a failed load: it is counted apart and is not a load, unlike
//             `cap trigger`, which counts the request itself.
//   score     trigger.js liveRows and score.js scoreTrigger, the code `cap trigger --mode live` uses: a request counts
//             as loading when it loaded in at least half of its repeats; precision and recall over requests. No judge.
//
// Runs come from one of two places. `scoreRun` reads the results of a finished bench run (bench.js run over the tasks
// `writeTasks` makes). Nothing here starts a paid run. `runStub` writes a stub kiro-cli stream per request and repeat,
// then reads it back through the same code, so the whole path runs with no model and no spend. Its behaviour says
// which skill each run loads: always this skill, never, the right answer (an oracle), or a fake model that picks a
// skill from the request and the skill index (fakepicker.js), which can pick the wrong skill.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseStream, aggregateStream } = require('../runner/lib/stream.js');
const { extractSkills, capInvocationOf } = require('../runner/lib/skills.js');
const { liveRows, materializeTasks } = require('./trigger.js');
const { scoreTrigger } = require('./score.js');
const { assertStubRun } = require('./stubprovider.js');

const RUNTIME = 'kiro-cli';
/** The stub behaviours: always load, never load, load exactly when the request expects it. */
const STUB_BEHAVIOURS = Object.freeze({
  always: () => true,
  never: () => false,
  correct: (request) => request.expect === 'load',
});

const { sha256 } = require('../runner/lib/util.js');

/** The requests as trigger queries: [{ id, text, expect }]. `set` is a checked selection.json. */
const queriesOf = (set) => set.requests.map((r) => ({ id: r.id, text: r.prompt, expect: r.expect }));

/**
 * Writes one bench task per request into `dir` (for `bench.js run --extra-tasks`), stopped at the first skill
 * decision like `cap trigger --mode live`. Returns [{ taskId, query }]. Running them is a paid run and needs approval.
 * @param {object} o
 * @param {string} o.name the skill
 * @param {object} o.set its checked selection.json
 * @param {string} o.dir the tasks folder to write
 */
function writeTasks({ name, set, dir }) {
  return materializeTasks({ cap: { id: `skill:${name}`, kind: 'skill', name }, queries: queriesOf(set), dir });
}

/**
 * The skill-load fields of one run, read from its kiro-cli stream text with the runner's code.
 * @param {string} text the stream.jsonl text
 * @returns {{ skillsLoaded: object[], capInvocation: object }}
 */
function readStream(text) {
  const { events } = parseStream(text);
  const extraction = extractSkills(events, RUNTIME);
  return { skillsLoaded: extraction.skillsLoaded, capInvocation: capInvocationOf({ agg: aggregateStream(events), extraction }) };
}

/**
 * A stub kiro-cli stream for one request: a get_skill call that returns the skill's text, then an answer line. `load`
 * is true (load `name`), a skill name (load that skill instead), or false or null (load nothing). `extra` adds calls:
 * 'twice' loads the skill a second time, 'empty' makes the load return no text (a failed load, not a load).
 */
function stubStream({ name: subject, load, extra = null }) {
  const name = load === true ? subject : typeof load === 'string' ? load : null;
  const sid = 'stub-session';
  const call = (id, skill) => ({ type: 'sessionUpdate', data: { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: { name: skill }, _meta: { kiro: { toolName: 'get_skill', mcpServerName: 'konductor-skills' } } } } });
  const body = (skill, text) => ({ items: [{ Json: { content: [{ type: 'text', text: JSON.stringify({ name: skill, content: text, path: `/s/${skill}/SKILL.md`, size_bytes: text.length }) }], isError: false } }] });
  const done = (id, rawOutput) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput } } });
  const events = [{ type: 'runStarted', data: { payloadSchema: 'acp', acpProtocolVersion: 1, engine: 'v2' } }];
  if (name) {
    const text = extra === 'empty' ? '' : `# ${name}\nstub skill text\n`;
    events.push(call('c1', name), done('c1', extra === 'empty' ? { items: [] } : body(name, text)));
    if (extra === 'twice') events.push(call('c2', name), done('c2', body(name, text)));
  }
  events.push({ type: 'sessionUpdate', data: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'stub answer' } } } });
  return `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
}

/**
 * Runs the selection test on the stub: one stream per request and repeat, written under `dir` and read back.
 * @param {object} o
 * @param {string} o.name the skill
 * @param {object} o.set its checked selection.json
 * @param {string} o.runId must be stub or stub-<name>
 * @param {string} o.dir where the streams go
 * @param {number} [o.reps] repeats per request
 * @param {string|function} [o.behaviour] always, never, correct, or (request, rep) => true, false, or the name of the
 *   skill that run loads (a fake model's pick)
 * @param {string|null} [o.extra] passed to stubStream for every loading run ('twice' or 'empty')
 * @returns {object[]} result.json-shaped rows: { status, triggerQuery, skillsLoaded, capInvocation, flags }
 */
function runStub({ name, set, runId, dir, reps = 3, behaviour = 'correct', extra = null }) {
  assertStubRun(runId);
  const decide = typeof behaviour === 'function' ? behaviour : STUB_BEHAVIOURS[behaviour];
  if (!decide) throw new Error(`stub behaviour must be ${Object.keys(STUB_BEHAVIOURS).join(', ')} (got ${JSON.stringify(behaviour)})`);
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const request of set.requests) {
    for (let rep = 0; rep < reps; rep++) {
      const file = path.join(dir, `${request.id}.${rep}.stream.jsonl`);
      fs.writeFileSync(file, stubStream({ name, load: decide(request, rep), extra }));
      const read = readStream(fs.readFileSync(file, 'utf8'));
      results.push({ status: 'success', triggerQuery: { queryId: request.id, expect: request.expect, rep }, flags: [], ...read });
    }
  }
  return results;
}

/**
 * Scores result.json rows of a selection run for one skill: { score, rows, dropped, failedLoads } (score.js
 * scoreTrigger). `failedLoads` counts runs that asked for the skill and got no text.
 * @param {object[]} results result.json objects (a finished bench run's, or runStub's)
 * @param {string} name the skill
 */
function scoreRun(results, name) {
  const key = name.toLowerCase();
  const loadedIn = (r) => (r.skillsLoaded ?? []).some((x) => String(x.name).toLowerCase() === key);
  const askedIn = (r) => (r.capInvocation?.requested ?? []).some((x) => String(x).toLowerCase() === key);
  // liveRow counts a request as a hit; here only a load that returned text does, so requests are left out.
  const loadsOnly = results.map((r) => (r.capInvocation ? { ...r, capInvocation: { ...r.capInvocation, requested: [] } } : r));
  const { rows, dropped } = liveRows(loadsOnly, { id: `skill:${name}`, kind: 'skill', name });
  if (!rows.length) throw new Error(`no selection run of ${name} could be read (${JSON.stringify(dropped)})`);
  const failedLoads = results.filter((r) => r.triggerQuery && askedIn(r) && !loadedIn(r)).length;
  return { score: scoreTrigger(rows), rows, dropped, failedLoads };
}

/**
 * The record's `selection` field from a scored run.
 * @param {object} o
 * @param {object} o.scored scoreRun's result
 * @param {object} o.set the selection.json it ran
 * @param {string} o.setSha256 the sha256 of that file's bytes
 * @param {boolean} o.frozen whether the file is the one frozen in the baselines manifest
 * @param {string} o.unitSha256 the skill's subject manifest hash when it ran
 * @param {string} o.source the run id or folder it came from
 * @param {string} [o.measuredAt] the date (YYYY-MM-DD)
 * @returns {object} { triggerPrecision, triggerRecall, observedUseRate, requests, runs, failedLoads, frozen, requestsSha256,
 *   unitSha256, source, measuredAt }. Precision is null when no request loaded the skill (nothing to be precise
 *   about). observedUseRate is the share of the selection runs, both kinds of request, that loaded the skill; it is
 *   never use in real sessions. `sessionUse` ({ rate, runs, loaded, source } from usage.js sessionUseOf over past real
 *   runs, or null) is that, kept in its own field so the two are never mixed (DEBT K-6).
 */
function selectionResult({ scored, set, setSha256, frozen, unitSha256, source, measuredAt = new Date().toISOString().slice(0, 10), sessionUse = null }) {
  const { score, rows } = scored;
  return {
    triggerPrecision: score.precision.value, triggerRecall: score.recall.value,
    observedUseRate: rows.filter((r) => r.hit).length / rows.length,
    requests: { load: set.requests.filter((r) => r.expect === 'load').length, none: set.requests.filter((r) => r.expect === 'none').length },
    runs: rows.length, failedLoads: scored.failedLoads, frozen, requestsSha256: setSha256, unitSha256, source, measuredAt,
    sessionUse,
  };
}

module.exports = { STUB_BEHAVIOURS, queriesOf, writeTasks, readStream, stubStream, runStub, scoreRun, selectionResult, sha256 };
