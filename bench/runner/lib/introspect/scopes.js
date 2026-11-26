// SPDX-License-Identifier: Apache-2.0
'use strict';

// Assembly of the introspection report: which call belongs to the root or a sub-agent, and the skill activity of each. Split out of report.js (DEBT D-25).

const fs = require('node:fs');
const path = require('node:path');
const { parseStream, toolNameOf, SUBAGENT_TOOL } = require('../stream.js');
const { streamsOf } = require('../harness/streams.js');
const skills = require('../skills.js');
const { readJsonOrNull: readJson } = require('../util.js');
const { readLines, oneLine, clip, numOrNull } = require('./report-text.js');
const { requestBodies } = require('./claude-reader.js');
const { textOf, analyzeClaudeRequest } = require('./prompt-blocks.js');
const { walkFiles, kiroState, analyzeKiroRequest } = require('./kiro-reader.js');
// The harness's probe kind (its descriptor's introspect.probe) also names its stream: OTLP is Claude Code's, DUMP kiro-cli's.
const { OTLP, DUMP, probeOf } = require('./index.js');

// ---- assembly ----

// The events of one tool call, for a stream with many: a kiro-cli update carries its call id; a Claude Code message is
// cut down to the one block of that call.
function eventsByCall(events, harness) {
  const by = new Map();
  const add = (id, ev) => { if (!by.has(id)) by.set(id, []); by.get(id).push(ev); };
  const kind = probeOf(harness);
  for (const ev of events) {
    if (kind === OTLP) {
      if (ev.type !== 'assistant' && ev.type !== 'user') continue;
      const content = Array.isArray(ev.message?.content) ? ev.message.content : [];
      for (const b of content) {
        const id = b.type === 'tool_use' ? b.id : b.type === 'tool_result' ? b.tool_use_id : null;
        if (id) add(id, { ...ev, message: { ...ev.message, content: [b] } });
      }
    } else if (ev.type === 'sessionUpdate' && ev.data?.update?.toolCallId) add(ev.data.update.toolCallId, ev);
  }
  return by;
}

/**
 * The skill loads the bench detector (skills.extractSkills) counts, one row per call with its id, so each can be given
 * a scope. Running the detector on one call at a time keeps the report's totals equal to result.json skillsLoaded.
 */
function detectorLoads(events, harness) {
  if (!probeOf(harness)) return null;
  const out = [];
  for (const [id, evs] of eventsByCall(events, harness)) {
    let x;
    try { x = skills.extractSkills(evs, harness); } catch { continue; }
    for (const l of x.skillsLoaded) for (let i = 0; i < l.count; i++) out.push({ id, name: l.name, via: l.via });
  }
  return out;
}

/** The label of a call scope: root, or child #N and its target agent. */
const scopeLabel = (c) => (c ? `child #${c.index} ${c.target}` : 'root');

/**
 * Skill use of a run. Every load, failed or refused call and references/ read carries its scope: 0 for the root, else
 * the index of the child that made it. `byScope` has one row for the root and one per child.
 */
function skillActivity(entries, { scopeOf = () => 0, children = [], rootAgent = null, detected = null } = {}) {
  const loads = entries.filter((e) => e.kind === 'skill-load');
  const reads = entries.filter((e) => e.kind === 'tool' && /^(Read|fs_read|read)$/.test(e.tool) && /\/skills\//.test(JSON.stringify(e.input ?? {})));
  const refReads = reads.filter((e) => /\/references\//.test(JSON.stringify(e.input ?? {})));
  const ok = loads.filter((e) => !e.failed && !e.deferred);
  const out = {
    loaded: [...new Set([...ok.map((e) => `${e.input?.name}${e.via ? ' (Read SKILL.md)' : ''}`), ...(detected ?? []).filter((d) => !ok.some((e) => e.id === d.id)).map((d) => `${d.name} (${d.via})`)])],
    loads: detected
      ? detected.map((d) => { const e = entries.find((x) => x.id === d.id); return { n: e?.n ?? null, scope: scopeOf(e ?? { id: d.id }), agent: e?.agent ?? null, name: d.name, via: d.via }; })
      : ok.map((e) => ({ n: e.n, scope: scopeOf(e), agent: e.agent, name: e.input?.name ?? null, via: e.via ?? null })),
    loadsSource: detected ? 'bench detector, per call' : 'trace',
    failed: loads.filter((e) => e.failed || e.deferred).map((e) => ({ n: e.n, scope: scopeOf(e), agent: e.agent, name: e.input?.name ?? null, deferred: Boolean(e.deferred), result: clip(e.result ?? '', 200) })),
    referenceReads: refReads.map((e) => ({ n: e.n, scope: scopeOf(e), agent: e.agent, path: e.input?.file_path ?? e.input?.path ?? null })),
    finds: entries.filter((e) => e.kind === 'skill-find').length,
  };
  out.byScope = [null, ...children].map((c) => {
    const k = c ? c.index : 0;
    return { scope: k, label: scopeLabel(c), agent: c ? c.target : rootAgent ?? 'root', loads: out.loads.filter((x) => x.scope === k), failed: out.failed.filter((x) => x.scope === k), referenceReads: out.referenceReads.filter((x) => x.scope === k) };
  });
  out.totals = {
    rootLoads: out.loads.filter((x) => x.scope === 0).length, childLoads: out.loads.filter((x) => x.scope !== 0).length,
    refused: out.failed.filter((x) => x.deferred).length, failed: out.failed.filter((x) => !x.deferred).length,
    rootRefusedOrFailed: out.failed.filter((x) => x.scope === 0).length, childRefusedOrFailed: out.failed.filter((x) => x.scope !== 0).length,
    referenceReads: out.referenceReads.length,
  };
  return out;
}

/** Per child: which skills it had preloaded, which it loaded on demand, and which both. Preloads are Claude Code only. */
function classifyChildSkills(children, loads) {
  for (const c of children) {
    const onDemand = [...new Set(loads.filter((x) => x.scope === c.index).map((x) => x.name))];
    const seen = c.preloads?.seen?.length ? c.preloads.seen : null;
    const pre = [...new Set((seen ?? c.preloads?.expected ?? []).map((x) => x.name))];
    c.skillUse = {
      preloadSource: seen ? 'transcript' : c.preloads?.expected ? 'result.json skillsPreloaded' : null,
      preloadedOnly: pre.filter((n) => !onDemand.includes(n)), onDemandOnly: onDemand.filter((n) => !pre.includes(n)), both: pre.filter((n) => onDemand.includes(n)),
    };
  }
}

// Claude Code puts each frontmatter skill of a sub-agent into its transcript as a meta user message carrying the body.
const PRELOAD_NAME = /<command-name>([^<]+)<\/command-name>/;
const SKILL_BODY_ONE = /Base directory for this skill: /;

/** Every Claude Code transcript under `<dir>/claude-projects`: its size, first prompt, agent id, the Agent call that started it and the skills preloaded into it. */
function subagentTranscripts(dir) {
  const out = [];
  const root = path.join(dir, 'claude-projects');
  const walk = (d) => {
    let names;
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (n.endsWith('.jsonl')) {
        const lines = readLines(p);
        let firstUser = null;
        const preloads = [];
        for (const l of lines) {
          let j;
          try { j = JSON.parse(l); } catch { continue; }
          if (j.type !== 'user') continue;
          const text = textOf(j.message?.content);
          if (firstUser === null) firstUser = text;
          const m = j.isMeta ? PRELOAD_NAME.exec(text) : null;
          if (m && SKILL_BODY_ONE.test(text)) preloads.push({ name: m[1].trim(), bytes: Buffer.byteLength(text) });
        }
        const meta = /^agent-.*\.jsonl$/.test(n) ? readJson(p.replace(/\.jsonl$/, '.meta.json')) : null;
        out.push({
          file: path.relative(dir, p), lines: lines.length, sidechain: /subagents?\//.test(p) || /agent-/.test(n), firstPrompt: firstUser,
          agentId: (/^agent-(.+)\.jsonl$/.exec(n) || [])[1] ?? null, toolUseId: meta?.toolUseId ?? null, agentType: meta?.agentType ?? null, preloads,
        });
      }
    }
  };
  walk(root);
  return out;
}
// Where each tool call ran. A Claude Code event names the Agent call it belongs to in parent_tool_use_id; a kiro-cli v3
// event carries the subtask id of the child that made it, and a spawn call carries the id of the child it starts.
function callScopes(events, harness) {
  const scopeOfCall = new Map();
  const childOfCall = new Map();
  const kind = probeOf(harness);
  const subagentTools = streamsOf({ runtime: harness }).subagentTools ?? new Set();
  for (const ev of events) {
    if (kind === OTLP) {
      if (ev.type !== 'assistant') continue;
      for (const b of ev.message?.content || []) {
        if (b.type !== 'tool_use' || !b.id || scopeOfCall.has(b.id)) continue;
        scopeOfCall.set(b.id, ev.parent_tool_use_id ?? null);
        if (subagentTools.has(b.name)) childOfCall.set(b.id, b.id);
      }
    } else if (ev.type === 'sessionUpdate') {
      const u = ev.data?.update || {};
      if (u.sessionUpdate !== 'tool_call' || !u.toolCallId || scopeOfCall.has(u.toolCallId) || childOfCall.has(u.toolCallId)) continue;
      const sub = u._meta?.kiro?.agentSubtaskId ?? null;
      if (toolNameOf(u) === SUBAGENT_TOOL) { if (sub) childOfCall.set(u.toolCallId, sub); } else scopeOfCall.set(u.toolCallId, sub);
    }
  }
  return { scopeOfCall, childOfCall };
}

// kiro-cli v3 keeps one transcript per child, session/<sid>/sub-executions/<subtask id>.jsonl.
function kiroSubExecutions(runDir) {
  const out = new Map();
  const root = path.join(runDir, 'session');
  for (const sid of (() => { try { return fs.readdirSync(root).sort(); } catch { return []; } })()) {
    const sub = path.join(root, sid, 'sub-executions');
    for (const f of walkFiles(sub, (n) => n.endsWith('.jsonl'))) out.set(path.basename(f.path, '.jsonl'), { file: path.relative(runDir, f.path), lines: readLines(f.path).length });
  }
  return out;
}

// The first request a Claude Code child sent: tokens from its api_request record, the body from api_request_body.
function claudeChildFirst(otel, agentId) {
  if (!agentId) return null;
  const req = otel.logs.find((l) => l.name === 'api_request' && l.attrs.agent_id === agentId);
  const bodyLog = otel.logs.find((l) => l.name === 'api_request_body' && l.attrs.agent_id === agentId);
  let analysis = null;
  if (bodyLog) {
    const [b] = requestBodies([bodyLog]);
    if (b) analysis = analyzeClaudeRequest(b.body);
  }
  if (!req && !analysis) return null;
  const tokens = req ? ['input_tokens', 'cache_read_tokens', 'cache_creation_tokens'].reduce((s, k) => s + (numOrNull(req.attrs[k]) ?? 0), 0) : null;
  return {
    source: [req ? 'otel api_request' : null, analysis ? 'otel api_request_body' : null].filter(Boolean).join(' + '),
    tokens, input: req ? numOrNull(req.attrs.input_tokens) : null, cacheRead: req ? numOrNull(req.attrs.cache_read_tokens) : null, cacheWrite: req ? numOrNull(req.attrs.cache_creation_tokens) : null,
    chars: analysis?.totalChars ?? null, skillBodies: analysis?.skillBodiesPreloaded ?? null, skillsListed: analysis?.skillsListed?.length ?? null,
  };
}

// The first request a kiro-cli child sent, from the request dump; kiro-cli records no tokens per request.
function kiroChildFirst(dumps, subtask) {
  const mine = dumps.filter((x) => x.kind === 'subagent' && x.body?.invocation?.executionId === subtask && kiroState(x));
  if (!mine.length) return null;
  const a = analyzeKiroRequest(mine[0]);
  return { source: `dump ${mine[0].file}`, requests: mine.length, tokens: null, chars: a.totalChars, skillBodies: a.skillBodiesPreloaded, skillsListed: a.skillsListed.length };
}

/**
 * One record per delegation, numbered child #1.. in stream order, with its transcript, what it had preloaded (Claude
 * Code frontmatter skills), its first request and the skills it used on demand.
 */
function childRecords({ entries, events, harness, runDir, transcripts, otel, dumps, result }) {
  const { scopeOfCall, childOfCall } = callScopes(events, harness);
  const kind = probeOf(harness);
  const subExec = kind === DUMP ? kiroSubExecutions(runDir) : new Map();
  const children = entries.filter((e) => e.kind === 'delegate').map((d, i) => {
    const brief = oneLine(d.input?.prompt ?? d.input?.task ?? d.input?.description ?? '');
    const key = childOfCall.get(d.id) ?? null;
    let transcript = null;
    let tx = null;
    if (kind === DUMP) {
      tx = key ? subExec.get(key) ?? null : null;
      transcript = tx?.file ?? null;
    } else {
      const head = brief.slice(0, 120);
      tx = transcripts.find((t) => t.toolUseId && t.toolUseId === d.id) ?? (head ? transcripts.find((t) => t.sidechain && !t.toolUseId && oneLine(t.firstPrompt).startsWith(head)) : null) ?? null;
      transcript = tx?.file ?? null;
    }
    const child = {
      index: i + 1, n: d.n, id: d.id ?? null, key, parent: d.agent, target: d.target, status: d.status, briefChars: brief.length,
      transcript, transcriptLines: tx?.lines ?? null, agentId: tx?.agentId ?? null, linkedBy: !transcript ? null : kind === DUMP ? 'subtask id' : tx.toolUseId ? 'tool use id' : 'brief prefix',
      preloads: null, firstRequest: null,
    };
    if (kind === OTLP) {
      const expected = Array.isArray(result?.skillsPreloaded) ? result.skillsPreloaded.filter((s) => (s.agents || []).includes(d.target)).map((s) => ({ name: s.name, bytes: s.bytes ?? null })) : null;
      child.preloads = { expected, seen: tx ? tx.preloads : null };
      child.firstRequest = otel ? claudeChildFirst(otel, child.agentId) : null;
    } else if (kind === DUMP && key) {
      child.firstRequest = kiroChildFirst(dumps, key);
    }
    return child;
  });
  const byKey = new Map(children.filter((c) => c.key).map((c) => [c.key, c]));
  // 0 is the root; otherwise the child index. A call whose scope names no known child stays with the root.
  const scopeOf = (e) => {
    const s = e.id != null ? scopeOfCall.get(e.id) : null;
    return s && byKey.has(s) ? byKey.get(s).index : 0;
  };
  return { children, scopeOf };
}

module.exports = { detectorLoads, skillActivity, classifyChildSkills, subagentTranscripts, callScopes, childRecords };
