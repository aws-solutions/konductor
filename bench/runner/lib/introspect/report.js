// SPDX-License-Identifier: Apache-2.0
'use strict';

// The per-run introspection report, <run>/introspect/timeline.md (and timeline.json beside it). It reads only files in
// the run directory: result.json, stream.jsonl, the trace built from them, and the probe files written by index.js.
// Every number is marked with where it came from (otel, dump, stream), and a probe with no data says so instead of
// showing zero. Parsing lives here, apart from skills.js and the harness parsers, so the two can change separately.

const fs = require('node:fs');
const path = require('node:path');
const { buildTrace, renderMarkdown } = require('../trace.js');
const { parseStream, toolNameOf, SUBAGENT_TOOL } = require('../stream.js');
const skills = require('../skills.js');
const { readJsonOrNull: readJson } = require('../util.js');
const { clip, tok } = require('./report-text.js');
const { readOtlp, requestBodies, claudeRequests, attrMap, streamRequests, claudeHooks, claudeHookInjections, claudeTimed } = require('./claude-reader.js');
const { toolNamesInPrompt, hookTextsIn, analyzeClaudeRequest, listedSkills, sectionsOf, textOf } = require('./prompt-blocks.js');
const { analyzeKiroRequest, readKiroDumps, readKiroLog, kiroMarkers, kiroRequests, kiroState, kiroHooks, kiroTimed } = require('./kiro-reader.js');
const { callScopes, skillActivity, detectorLoads, classifyChildSkills, subagentTranscripts, childRecords } = require('./scopes.js');

/** One hook text row as a line: its kind, where it sits, its size and its head. */
const fmtHookText = (x) => `${x.kind === 'hook output' ? `${x.hook} hook ${x.outcome}` : x.kind} at ${x.where}, ${x.chars} chars "${x.head}"`;
/** Milliseconds as seconds with one decimal, or n/a. */
const fmtMs = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
/** A count as text, or n/a. */
const fmtN = (n) => (n == null ? 'n/a' : String(n));

/** Builds the report data of one run directory. */
function buildReport(runDir) {
  const dir = path.join(runDir, 'introspect');
  const result = readJson(path.join(runDir, 'result.json'));
  const probe = readJson(path.join(dir, 'probe.json'));
  let trace = null;
  let traceError = null;
  try { trace = buildTrace(runDir); } catch (e) { traceError = e.message; }
  let events = [];
  try { events = parseStream(fs.readFileSync(path.join(runDir, 'stream.jsonl'), 'utf8')).events; } catch { /* none */ }
  const harness = result?.harness ?? probe?.harness ?? null;
  const entries = trace?.entries ?? [];
  let requests = [];
  let first = null;
  let firstSource = null;
  let hooks = [];
  let timed = [];
  let raw = null;
  let sideRequests = [];
  let hookInjections = [];
  let claudeOtel = null;
  let dumps = [];
  if (harness === 'claude-code') {
    const otel = readOtlp(path.join(dir, 'otlp.jsonl'));
    const bodies = requestBodies(otel.logs);
    raw = { otelLogs: otel.logs.length, spans: otel.spans.length, metricBatches: otel.metricBatches, requestBodies: bodies.length, events: Object.fromEntries(Object.entries(otel.logs.reduce((m, l) => { m[l.name] = (m[l.name] || 0) + 1; return m; }, {})).sort()) };
    requests = claudeRequests(otel);
    if (!requests.length) requests = streamRequests(events);
    hooks = claudeHooks(events, otel);
    const hookOutputs = [...new Set(hooks.filter((h) => h.source === 'stream' && h.output).map((h) => String(h.output)))];
    if (bodies.length) { first = analyzeClaudeRequest(bodies[0].body, { hookOutputs }); firstSource = bodies[0].source; }
    hookInjections = claudeHookInjections(bodies, hookOutputs);
    claudeOtel = otel;
    timed = claudeTimed(otel);
  } else if (harness === 'kiro-cli') {
    dumps = readKiroDumps(dir);
    const log = readKiroLog(dir);
    const markers = kiroMarkers(log);
    raw = { dumps: dumps.length, sessionDumps: dumps.filter((d) => d.kind === 'session').length, subagentDumps: dumps.filter((d) => d.kind === 'subagent').length, logLines: log.length, timelineMarkers: markers.length };
    requests = kiroRequests(dumps, markers);
    sideRequests = dumps.filter((d) => d.kind !== 'session' && d.kind !== 'subagent').map((d) => ({ file: d.file, kind: d.kind, bytes: d.bytes, model: kiroState(d)?.currentMessage?.userInputMessage?.modelId ?? null, head: clip(textOf(kiroState(d)?.currentMessage?.userInputMessage?.content ?? ''), 100) }));
    const firstDump = dumps.find((d) => d.kind === 'session' && kiroState(d));
    if (firstDump) { first = analyzeKiroRequest(firstDump); firstSource = `dump ${firstDump.file}`; }
    hooks = kiroHooks(log, dumps);
    timed = kiroTimed(log, dumps);
  }
  const t0 = [...requests.map((r) => r.timeMs), ...timed.map((t) => t.timeMs)].filter((x) => x != null).sort((a, b) => a - b)[0] ?? null;
  const transcripts = harness === 'claude-code' ? subagentTranscripts(dir) : [];
  const { children, scopeOf } = childRecords({ entries, events, harness, runDir, transcripts, otel: claudeOtel, dumps, result });
  const skillsSeen = skillActivity(entries, { scopeOf, children, rootAgent: result?.agent ?? null, detected: detectorLoads(events, harness) });
  classifyChildSkills(children, skillsSeen.loads);
  const loadedNames = new Set(skillsSeen.loaded.map((x) => x.replace(/ \(.*$/, '')));
  const off = (t) => (t != null && t0 != null ? t - t0 : null);
  return {
    run: { dir: runDir, arm: result?.armId ?? null, task: result?.taskId ?? null, replicate: result?.replicate ?? null, harness, model: result?.model ?? null },
    outcome: {
      status: result?.status ?? null, wallClockMs: result?.wallClockMs ?? null, costUsd: result?.costUsd ?? null, credits: result?.credits ?? null,
      checksPassed: Array.isArray(result?.checks) ? result.checks.filter((c) => c.passed === true || c.pass === true || c.ok === true).length : null, checks: Array.isArray(result?.checks) ? result.checks.length : null,
      flags: result?.flags ?? [], finalText: result?.finalText ?? null,
    },
    probe, raw, traceError,
    requests: requests.map((r) => ({ ...r, offsetMs: off(r.timeMs) })),
    sideRequests,
    timed: timed.map((t) => ({ ...t, offsetMs: off(t.timeMs) })),
    first, firstSource,
    hooks, hookInjections,
    skills: { ...skillsSeen, listedNotLoaded: (first?.skillsListed || []).filter((n) => !loadedNames.has(n)) },
    subagents: children,
    transcripts,
    trace,
  };
}

/** The probe table of the report: for P1 to P5, whether the run has the data and where it came from. */
function probeMatrix(r) {
  const reqTimed = r.requests.filter((q) => q.latencyMs != null).length;
  const reqTokens = r.requests.filter((q) => q.input != null).length;
  const bodies = r.run.harness === 'claude-code' ? r.raw?.requestBodies ?? 0 : r.raw?.sessionDumps ?? 0;
  return [
    ['P1 exact model input', r.first ? 'yes' : 'no', r.first ? `${bodies} full request bodies (${r.firstSource.split(' ')[0]})` : 'no request body captured'],
    ['P2 per-request timing/tokens', r.requests.length ? (reqTokens ? 'yes' : 'timing only') : 'no', `${r.requests.length} requests, ${reqTimed} with latency, ${reqTokens} with tokens (${[...new Set(r.requests.map((q) => q.source))].join(', ') || 'none'})`],
    ['P3 tool calls', r.trace ? 'yes' : 'no', r.trace ? `${r.trace.entries.filter((e) => ['tool', 'skill-load', 'skill-find', 'delegate'].includes(e.kind)).length} calls in the stream; ${r.subagents.length} delegations, ${r.subagents.filter((x) => x.transcript).length} linked to a transcript` : r.traceError],
    ['P4 hook firing', r.hooks.length ? 'yes' : 'none seen', `${r.hooks.length} hook records (${[...new Set(r.hooks.map((h) => h.source.split(' ')[0]))].join(', ') || 'none'})`],
    ['P5 preloaded context', r.first ? 'yes' : 'no', r.first ? `${r.first.blocks.length} prompt blocks, ${r.first.contextFiles.length} context files, ${r.first.skillsListed.length} skills listed, ${r.first.skillBodiesPreloaded.length} skill bodies, ${r.first.tools.length} tools` : 'needs P1'],
  ];
}

/** The report `r` (buildReport) as the Markdown of timeline.md. */
function renderReport(r) {
  const L = [];
  const o = r.outcome;
  const esc = (x) => String(x ?? '').replace(/\|/g, '\\|');
  L.push(`# Introspection: ${r.run.arm ?? '?'} / ${r.run.task ?? '?'} / rep ${r.run.replicate ?? '?'} (${r.run.harness ?? '?'}${r.run.model ? `, ${r.run.model}` : ''})`);
  L.push('');
  L.push(`- outcome: ${o.status ?? 'n/a'}; wall ${fmtMs(o.wallClockMs)}; ${o.costUsd != null ? `cost $${Number(o.costUsd).toFixed(4)}` : `credits ${o.credits != null ? Number(o.credits).toFixed(3) : 'n/a'}`}; checks ${o.checksPassed ?? '?'}/${o.checks ?? '?'} passed`);
  L.push(`- flags: ${o.flags.length ? o.flags.join(', ') : 'none'}`);
  if (r.probe?.collectorWatch) {
    const w = r.probe.collectorWatch;
    L.push(`- host collector: ${w.available ? `${w.samples} socket samples of ports ${w.ports.join(', ')}; ${w.runConnections.length} connections from the run${w.clean ? ' (clean)' : ''}` : w.note}`);
  }
  if (r.probe?.sink?.received) L.push(`- loopback sink ${r.probe.sink.url}: ${r.probe.sink.received.requests} OTLP requests (${Object.entries(r.probe.sink.received.bySignal).map(([k, v]) => `${k} ${v}`).join(', ')}), ${r.probe.sink.received.bytes} bytes`);
  if (r.raw) L.push(`- raw: ${Object.entries(r.raw).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push('');
  L.push('## Probes');
  L.push('');
  L.push('| probe | captured | evidence |');
  L.push('| --- | --- | --- |');
  for (const [p, c, e] of probeMatrix(r)) L.push(`| ${p} | ${c} | ${esc(e)} |`);
  L.push('');

  L.push('## What the agent saw in its first request');
  L.push('');
  if (!r.first) L.push('No request body was captured (see the probe table).');
  else {
    const f = r.first;
    L.push(`Source: ${r.firstSource}. Model ${f.model ?? 'n/a'}. About ${tok(f.totalChars)} tokens (chars / 4): ${f.blocks.length} prompt blocks, ${f.tools.length} tool definitions (${f.toolChars} chars).`);
    L.push('');
    L.push('| block | role | chars | starts with |');
    L.push('| --- | --- | --- | --- |');
    for (const b of f.blocks) L.push(`| ${b.where} | ${b.role} | ${b.chars} | ${esc(b.head)} |`);
    for (const b of f.blocks.filter((x) => x.sections.length)) {
      L.push('');
      L.push(`Sections of ${b.where} (${b.chars} chars): ${b.sections.map((x) => `${x.title} ${x.chars}`).join('; ')}`);
    }
    L.push('');
    L.push(`- context files injected: ${f.contextFiles.length ? f.contextFiles.map((c) => `${c.path}${c.kind ? ` (${c.kind})` : ''}`).join('; ') : 'none found'}`);
    L.push(`- system reminders: ${f.systemReminders.length ? f.systemReminders.map((x) => `${x.chars} chars "${x.head}"`).join('; ') : 'none'}`);
    L.push(`- hook instructions in the request: ${f.hookInstructions.length ? f.hookInstructions.map(fmtHookText).join('; ') : 'none'}`);
    L.push(`- skills listed: ${f.skillsListed.length ? `${f.skillsListed.length}: ${f.skillsListed.join(', ')}` : 'none found'}`);
    L.push(`- skill bodies already in the request: ${f.skillBodiesPreloaded.length ? f.skillBodiesPreloaded.join(', ') : 'none'}`);
    L.push(`- SKILL.md paths mentioned: ${f.skillMdMentioned.length ? f.skillMdMentioned.join(', ') : 'none'}`);
    L.push(`- tools (${f.tools.length}): ${f.tools.map((t) => t.name).join(', ') || 'none'}`);
    const named = f.toolNamesInPrompt ?? [];
    const fmt = (xs) => xs.map((x) => `${x.name} (${x.mentions})`).join(', ') || 'none';
    L.push(`- tool names the prompt mentions (backticked snake_case, tool:: ids), with mention counts: not in the tool list: ${fmt(named.filter((x) => !x.inToolList))}; in the tool list: ${fmt(named.filter((x) => x.inToolList))}`);
    if (f.contextFields) L.push(`- request context fields (chars): ${Object.entries(f.contextFields).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  }
  L.push('');

  L.push('## Model requests');
  L.push('');
  if (!r.requests.length) L.push('No per-request record.');
  else {
    L.push('| # | t+ | agent | latency | ttft | input | output | cache read | cache write | cost | source |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    r.requests.forEach((q, i) => L.push(`| ${i + 1} | ${fmtMs(q.offsetMs)} | ${q.agent ?? 'root'} | ${q.latencyMs != null ? `${q.latencyMs} ms` : 'n/a'} | ${q.ttftMs != null ? `${q.ttftMs} ms` : 'n/a'} | ${fmtN(q.input)} | ${fmtN(q.output)} | ${fmtN(q.cacheRead)} | ${fmtN(q.cacheWrite)} | ${q.costUsd != null ? `$${q.costUsd.toFixed(4)}` : 'n/a'} | ${q.source}${q.requestChars ? `, ${q.requestChars} chars, history ${q.history}` : ''} |`));
    const sum = (k) => r.requests.reduce((acc, q) => acc + (q[k] ?? 0), 0);
    L.push(`| total | | | ${sum('latencyMs')} ms | | ${r.requests.some((q) => q.input != null) ? `${sum('input')} | ${sum('output')} | ${sum('cacheRead')} | ${sum('cacheWrite')}` : 'n/a | n/a | n/a | n/a'} | ${r.requests.some((q) => q.costUsd != null) ? `$${sum('costUsd').toFixed(4)}` : 'n/a'} | |`);
    if (r.run.harness === 'kiro-cli') L.push('', 'kiro-cli reports no tokens per request; credits are per turn in the stream (see the step timeline), and the engine log has a context-size estimate per tool result.');
  }
  if (r.sideRequests.length) {
    L.push('');
    L.push(`Side requests outside the conversation: ${r.sideRequests.map((x) => `${x.kind} ${x.model ?? ''} ${x.bytes} B "${x.head}"`).join('; ')}`);
  }
  L.push('');

  L.push('## Hooks');
  L.push('');
  if (!r.hooks.length) L.push('No hook record.');
  for (const h of r.hookInjections ?? []) L.push(`- injected into the prompt: ${fmtHookText(h)}; first in request body ${h.firstBody}, present in ${h.bodies} of ${h.ofBodies} bodies${h.ofChildBodies ? ` (${h.bodies - h.childBodies} of ${h.ofBodies - h.ofChildBodies} root, ${h.childBodies} of ${h.ofChildBodies} sub-agent)` : ''}`);
  for (const h of r.hooks) L.push(`- ${h.source}${h.timeMs ? ` ${fmtMs(h.timeMs - (r.timed[0]?.timeMs ?? h.timeMs))}` : ''} ${h.phase} ${h.event ?? ''} ${h.name ?? ''}${h.exitCode != null ? ` exit ${h.exitCode}` : ''}${h.outcome ? ` ${h.outcome}` : ''}: ${clip(h.output, 300) || '(no output)'}`);
  L.push('');

  L.push('## Skills');
  L.push('');
  const sk = r.skills;
  const scopeName = (k) => (k === 0 ? 'root' : `child #${k}`);
  L.push(`- loaded: ${sk.loaded.length ? sk.loaded.join(', ') : 'none'}`);
  L.push(`- failed or refused skill calls: ${sk.failed.length ? sk.failed.map((f) => `#${f.n} [${scopeName(f.scope)}] ${f.name ?? '(no name)'}${f.deferred ? ' (refused)' : ''}${f.result ? `: ${f.result}` : ''}`).join('; ') : 'none'}`);
  L.push(`- reads under references/: ${sk.referenceReads.length ? sk.referenceReads.map((x) => `#${x.n} [${scopeName(x.scope)}] ${x.path}`).join('; ') : 'none'}`);
  if (sk.totals) L.push(`- loads by scope: root ${sk.totals.rootLoads}, children ${sk.totals.childLoads} (total ${sk.totals.rootLoads + sk.totals.childLoads}); refused ${sk.totals.refused}, failed ${sk.totals.failed}`);
  for (const b of sk.byScope ?? []) {
    const names = b.loads.map((x) => `${x.name} (#${x.n ?? '?'}${x.via && x.via !== 'get_skill' && x.via !== 'skill-tool' ? `, ${x.via}` : ''})`);
    L.push(`  - ${b.label}${b.scope === 0 ? ` (${b.agent})` : ''}: loaded ${b.loads.length}${names.length ? `: ${names.join(', ')}` : ''}; failed or refused ${b.failed.length}${b.failed.length ? `: ${b.failed.map((f) => `#${f.n}${f.deferred ? ' refused' : ' failed'}`).join(', ')}` : ''}; references/ reads ${b.referenceReads.length}`);
  }
  L.push(`- find_skills calls: ${sk.finds}`);
  L.push(`- listed in the first request but not loaded: ${sk.listedNotLoaded.length ? `${sk.listedNotLoaded.length} of ${r.first.skillsListed.length}` : r.first ? 'none' : 'unknown (no first request)'}`);
  L.push('');

  L.push('## Sub-agents');
  L.push('');
  if (!r.subagents.length) L.push('No delegation.');
  for (const d of r.subagents) {
    L.push(`- child #${d.index ?? '?'}: step #${d.n} ${d.parent} -> ${d.target} (${d.status ?? 'n/a'}), brief ${d.briefChars} chars, transcript: ${d.transcript ? `${d.transcript} (${d.transcriptLines} lines, linked by ${d.linkedBy})` : 'not matched'}${d.key && r.run.harness === 'kiro-cli' ? `, subtask ${d.key}` : ''}${d.agentId ? `, agent id ${d.agentId}` : ''}`);
    if (d.preloads) {
      const exp = d.preloads.expected;
      const seen = d.preloads.seen;
      const bytes = (xs) => xs.reduce((n, x) => n + (x.bytes ?? 0), 0);
      L.push(`  - preloaded skills (frontmatter, from result.json): ${exp ? `${exp.length}, ${bytes(exp)} bytes${exp.length ? `: ${exp.map((x) => `${x.name} ${x.bytes ?? '?'} B`).join(', ')}` : ''}` : 'unknown (no skillsPreloaded in result.json)'}`);
      if (seen) {
        const missing = (exp ?? []).filter((x) => !seen.some((y) => y.name === x.name)).map((x) => x.name);
        const extra = seen.filter((y) => !(exp ?? []).some((x) => x.name === y.name)).map((x) => x.name);
        L.push(`  - preloaded skill bodies seen in the transcript: ${seen.length}, ${bytes(seen)} bytes of message text${missing.length ? `; expected but not seen: ${missing.join(', ')}` : ''}${extra.length ? `; seen but not expected: ${extra.join(', ')}` : ''}`);
      } else L.push('  - preloaded skill bodies seen in the transcript: no transcript');
    }
    if (d.firstRequest) {
      const q = d.firstRequest;
      L.push(`  - first request (${q.source})${q.requests ? ` of ${q.requests} dumped` : ''}: ${q.tokens != null ? `${q.tokens} tokens (input ${q.input}, cache read ${q.cacheRead}, cache write ${q.cacheWrite})` : 'tokens n/a'}${q.chars != null ? `, ${q.chars} chars (about ${tok(q.chars)} tokens)` : ''}${q.skillBodies ? `, ${q.skillBodies.length} skill bodies in it` : ''}${q.skillsListed != null ? `, ${q.skillsListed} skills listed` : ''}`);
    } else if (r.run.harness === 'claude-code' || r.run.harness === 'kiro-cli') L.push('  - first request: not found in the probe files');
    if (d.skillUse) {
      const u = d.skillUse;
      const list = (xs) => (xs.length ? `${xs.length} (${xs.join(', ')})` : '0');
      L.push(`  - skills: preloaded only ${list(u.preloadedOnly)}; loaded on demand only ${list(u.onDemandOnly)}; both ${list(u.both)}${u.preloadSource ? ` [preloads from ${u.preloadSource}]` : r.run.harness === 'kiro-cli' ? ' [no preload record for kiro-cli]' : ''}`);
    }
  }
  if (r.transcripts.length) L.push(`- transcripts saved: ${r.transcripts.map((t) => `${t.file} (${t.lines} lines${t.sidechain ? ', sub-agent' : ''})`).join('; ')}`);
  L.push('');

  L.push('## Timed events');
  L.push('');
  if (!r.timed.length) L.push('No timestamped probe events.');
  for (const t of r.timed) L.push(`- ${fmtMs(t.offsetMs).padStart(7)}  ${t.text}`);
  L.push('');

  L.push('## Outcome');
  L.push('');
  L.push(clip(o.finalText ?? '(no final text)', 1500));
  L.push('');
  L.push('## Step timeline (stream order)');
  L.push('');
  if (r.trace) L.push(renderMarkdown(r.trace).split('\n## Timeline\n')[1] ?? '(empty)');
  else L.push(`Trace unavailable: ${r.traceError}`);
  return `${L.join('\n')}\n`;
}

/** Writes timeline.md and timeline.json to <run>/introspect, or to `outDir`. Returns the report data. */
function writeReport(runDir, { outDir = null } = {}) {
  const dir = outDir ?? path.join(runDir, 'introspect');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const r = buildReport(runDir);
  const { trace, ...rest } = r;
  fs.writeFileSync(path.join(dir, 'timeline.md'), renderReport(r), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'timeline.json'), `${JSON.stringify({ ...rest, timelineEntries: trace?.entries?.length ?? 0 }, null, 2)}\n`, { mode: 0o600 });
  return r;
}

module.exports = { toolNamesInPrompt, hookTextsIn, callScopes, skillActivity, buildReport, renderReport, writeReport, readOtlp, requestBodies, analyzeClaudeRequest, analyzeKiroRequest, readKiroDumps, readKiroLog, kiroMarkers, kiroRequests, claudeRequests, listedSkills, sectionsOf, probeMatrix, attrMap };
