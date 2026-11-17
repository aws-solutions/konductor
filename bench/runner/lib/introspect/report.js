// SPDX-License-Identifier: Apache-2.0
'use strict';

// The per-run introspection report, <run>/introspect/timeline.md (and timeline.json beside it). It reads only files in
// the run directory: result.json, stream.jsonl, the trace built from them, and the probe files written by index.js.
// Every number is marked with where it came from (otel, dump, stream), and a probe with no data says so instead of
// showing zero. Parsing lives here, apart from skills.js and the harness parsers, so the two can change separately.

const fs = require('node:fs');
const path = require('node:path');
const { buildTrace, renderMarkdown } = require('../trace.js');
const { parseStream } = require('../stream.js');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readLines = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
const numOrNull = (v) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : n; };
const tok = (n) => Math.round(n / 4);

// ---- OTLP (http/json) ----

function attrValue(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(attrValue);
  if ('kvlistValue' in v) return attrMap(v.kvlistValue.values);
  return null;
}

function attrMap(list) {
  const out = {};
  for (const a of list || []) out[a.key] = attrValue(a.value);
  return out;
}

const nanosToMs = (n) => (n == null ? null : Math.floor(Number(BigInt(String(n)) / 1000000n)));

/** The OTLP file as { logs: [{ timeMs, name, attrs, body }], spans: [{ name, startMs, endMs, attrs }], metricBatches }. */
function readOtlp(file) {
  const logs = [];
  const spans = [];
  let metricBatches = 0;
  for (const line of readLines(file)) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const b = rec.body;
    if (!b || typeof b !== 'object') continue;
    if (rec.signal === 'metrics') { metricBatches++; continue; }
    for (const rl of b.resourceLogs || []) {
      for (const sl of rl.scopeLogs || []) {
        for (const lr of sl.logRecords || []) {
          const attrs = attrMap(lr.attributes);
          const body = attrValue(lr.body);
          const name = String(attrs['event.name'] ?? body ?? '').replace(/^claude_code\./, '');
          const ts = attrs['event.timestamp'] ? Date.parse(attrs['event.timestamp']) : nanosToMs(lr.timeUnixNano ?? lr.observedTimeUnixNano);
          logs.push({ timeMs: Number.isFinite(ts) ? ts : null, name, attrs, body });
        }
      }
    }
    for (const rs of b.resourceSpans || []) {
      for (const ss of rs.scopeSpans || []) {
        for (const sp of ss.spans || []) spans.push({ name: sp.name, startMs: nanosToMs(sp.startTimeUnixNano), endMs: nanosToMs(sp.endTimeUnixNano), attrs: attrMap(sp.attributes), spanId: sp.spanId, parentSpanId: sp.parentSpanId || null });
      }
    }
  }
  logs.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
  spans.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  return { logs, spans, metricBatches };
}

const looksLikeRequest = (o) => o && typeof o === 'object' && Array.isArray(o.messages);

/** The JSON-encoded API request bodies found in log attributes or bodies, in time order: [{ timeMs, body, source }]. */
function requestBodies(logs) {
  const out = [];
  for (const l of logs) {
    const candidates = [l.body, ...Object.entries(l.attrs).map(([k, v]) => (/body|request|payload/i.test(k) ? v : null))];
    for (const c of candidates) {
      let o = c;
      if (typeof c === 'string' && c.length > 50 && /^\s*\{/.test(c)) { try { o = JSON.parse(c); } catch { o = null; } }
      if (looksLikeRequest(o)) { out.push({ timeMs: l.timeMs, body: o, source: `otel ${l.name}` }); break; }
    }
  }
  return out;
}

// ---- Claude Code request rows ----

function claudeRequests(otel) {
  return otel.logs.filter((l) => /(^|\.)api_request$/.test(l.name)).map((l) => {
    const latencyMs = numOrNull(l.attrs.duration_ms);
    return {
      timeMs: l.timeMs != null && latencyMs != null ? l.timeMs - latencyMs : l.timeMs, endMs: l.timeMs, source: 'otel',
      model: l.attrs.model ?? null, latencyMs, ttftMs: numOrNull(l.attrs.ttft_ms),
      input: numOrNull(l.attrs.input_tokens), output: numOrNull(l.attrs.output_tokens),
      cacheRead: numOrNull(l.attrs.cache_read_tokens), cacheWrite: numOrNull(l.attrs.cache_creation_tokens),
      costUsd: numOrNull(l.attrs.cost_usd),
      agent: l.attrs.agent_id ?? l.attrs['agent.id'] ?? l.attrs.query_source ?? null,
      requestId: l.attrs.request_id ?? null,
    };
  }).sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
}

// Without OTEL rows, the stream still has usage per assistant message (no timestamps, no latency).
function streamRequests(events) {
  const byId = new Map();
  for (const ev of events) {
    if (ev.type !== 'assistant' || !ev.message?.id) continue;
    const u = ev.message.usage || {};
    const cur = byId.get(ev.message.id) ?? { timeMs: null, source: 'stream', model: ev.message.model ?? null, latencyMs: null, ttftMs: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: null, agent: ev.parent_tool_use_id ? `sub:${ev.parent_tool_use_id.slice(-8)}` : 'root' };
    cur.input = Math.max(cur.input, u.input_tokens ?? 0);
    cur.output = Math.max(cur.output, u.output_tokens ?? 0);
    cur.cacheRead = Math.max(cur.cacheRead, u.cache_read_input_tokens ?? 0);
    cur.cacheWrite = Math.max(cur.cacheWrite, u.cache_creation_input_tokens ?? 0);
    byId.set(ev.message.id, cur);
  }
  return [...byId.values()];
}

const HOOK_DETAIL = ['total_duration_ms', 'num_hooks', 'num_success', 'num_blocking', 'stdout_chars', 'additional_context_chars', 'system_message_chars', 'initial_user_message_chars'];

function claudeHooks(events, otel) {
  const out = [];
  for (const ev of events) {
    if (ev.type !== 'system' || !/^hook_/.test(ev.subtype ?? '')) continue;
    out.push({ source: 'stream', phase: ev.subtype, event: ev.hook_event ?? null, name: ev.hook_name ?? null, exitCode: ev.exit_code ?? null, outcome: ev.outcome ?? null, output: ev.output ?? ev.stdout ?? '', stderr: ev.stderr ?? '' });
  }
  for (const l of otel.logs) {
    if (!/hook/.test(l.name)) continue;
    const detail = HOOK_DETAIL.filter((k) => l.attrs[k] !== undefined).map((k) => `${k}=${l.attrs[k]}`).join(' ');
    out.push({ source: 'otel', timeMs: l.timeMs, phase: l.name, event: l.attrs.hook_event ?? l.attrs.hook_event_name ?? null, name: l.attrs.hook_name ?? null, exitCode: l.attrs.exit_code ?? null, outcome: l.attrs.outcome ?? null, output: l.attrs.output ?? l.attrs.additional_context ?? detail });
  }
  return out;
}

// Every timestamped OTEL event worth a line, in time order: prompts, requests, tool runs and decisions, hooks, skills, plugins.
function claudeTimed(otel) {
  const out = [];
  for (const l of otel.logs) {
    const a = l.attrs;
    let text = null;
    if (l.name === 'api_request') text = `model request done ${a.duration_ms} ms (ttft ${a.ttft_ms ?? 'n/a'} ms), in ${a.input_tokens} out ${a.output_tokens} cache r/w ${a.cache_read_tokens}/${a.cache_creation_tokens}, $${Number(a.cost_usd ?? 0).toFixed(4)}, ${a.query_source ?? ''}`;
    else if (l.name === 'api_request_body') text = `request body sent, ${a.body_length ?? String(a.body ?? '').length} chars`;
    else if (l.name === 'api_error') text = `API error ${a.status_code ?? ''} ${clip(a.error ?? '', 160)}`;
    else if (l.name === 'tool_result') text = `tool ${a.tool_name} ${a.success === 'true' || a.success === true ? 'ok' : 'FAILED'} ${a.duration_ms} ms, input ${a.tool_input_size_bytes ?? '?'} B, result ${a.tool_result_size_bytes ?? '?'} B: ${clip(a.tool_input ?? '', 140)}`;
    else if (l.name === 'tool_decision') text = `tool ${a.tool_name} ${a.decision} (${a.source})`;
    else if (l.name === 'user_prompt') text = `user prompt, ${a.prompt_length} chars`;
    else if (/hook/.test(l.name)) text = `${l.name} ${a.hook_event ?? ''} ${a.hook_name ?? ''} ${HOOK_DETAIL.filter((k) => a[k] !== undefined).map((k) => `${k}=${a[k]}`).join(' ')}`;
    else if (/skill/.test(l.name)) text = `${l.name} ${a.skill_name ?? a.name ?? ''}`;
    else if (l.name === 'plugin_loaded') text = `plugin ${a['plugin.name']} (${a['plugin.scope'] ?? ''}, hooks ${a.has_hooks}, skills ${a.skill_path_count ?? 0})`;
    else if (l.name === 'assistant_response') text = `assistant text, ${a.response_length} chars`;
    if (text) out.push({ timeMs: l.timeMs, text: oneLine(text) });
  }
  return out;
}

// ---- What the first request held (P5) ----

const textOf = (c) => {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(textOf).join('\n');
  if (typeof c === 'object') return typeof c.text === 'string' ? c.text : textOf(c.content ?? '');
  return String(c);
};

// Claude Code labels each injected file "Contents of <path> (<kind>):".
const CONTENTS_OF = /Contents of (\S+?)(?: \(([^)]*)\))?:/g;
const SKILL_BODY = /Base directory for this skill: (\S+)/g;
const SKILL_MD_PATH = /([\w.-]+)\/SKILL\.md/g;
const HOOK_INSTRUCTION = /<HOOK_INSTRUCTION[^>]*>([\s\S]*?)<\/HOOK_INSTRUCTION>/g;
// Tool names a prompt tells the model to call: a backticked snake_case word, or the name part of a tool::<server>::<name> id.
const TOOL_NAME_MENTION = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`|\btool::[\w.-]+::([A-Za-z][\w-]*)/g;

/**
 * The tool names the prompt mentions, each with its mention count and whether a tool of that name is in the request's
 * tool list (exactly, or as the last part of a namespaced name such as server___name or @server/name).
 */
function toolNamesInPrompt(text, tools) {
  const counts = new Map();
  for (const m of String(text).matchAll(TOOL_NAME_MENTION)) {
    const name = m[1] ?? m[2];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const offered = tools.map((t) => String(t.name));
  const inList = (n) => offered.some((t) => t === n || t.endsWith(`/${n}`) || t.endsWith(`__${n}`) || t.endsWith(`::${n}`));
  return [...counts].map(([name, mentions]) => ({ name, mentions, inToolList: inList(name) }))
    .sort((a, b) => (a.inToolList - b.inToolList) || (b.mentions - a.mentions) || a.name.localeCompare(b.name));
}

function contextFilesOf(text) {
  const out = [];
  for (const m of text.matchAll(CONTENTS_OF)) out.push({ path: m[1], kind: m[2] ?? null });
  return out;
}

/** Skill names listed for the model: "- name: description" lines after a skills header. */
function listedSkills(text) {
  const names = new Set();
  let inList = false;
  for (const line of String(text).split('\n')) {
    if (/skills? (are )?available|available skills|following skills|^#+ .*\bskills\b/i.test(line)) { inList = true; continue; }
    if (!inList) continue;
    const m = /^\s*[-*]\s+`?([A-Za-z0-9][\w:.-]{1,80})`?\s*:/.exec(line);
    if (m) names.add(m[1]);
    else if (/^#/.test(line)) inList = false;
  }
  return [...names];
}

/** Top-level sections of a prompt block: markdown H1/H2 headings and column-0 XML-style tags, with their sizes. */
function sectionsOf(text) {
  const marks = [];
  const re = /^(#{1,2} .+|<([a-zA-Z_-]+)(?: [^>]*)?>|Available agent types.*|The following skills are available.*|When you launch multiple agents.*)\s*$/gm;
  for (const m of String(text).matchAll(re)) marks.push({ at: m.index, title: clip(m[1], 80) });
  return marks.map((m, i) => ({ title: m.title, chars: (marks[i + 1]?.at ?? text.length) - m.at }));
}

function summarizeBlocks(blocks) {
  return blocks.map((b) => ({ where: b.where, role: b.role, chars: b.text.length, head: clip(b.text, 100), sections: b.text.length > 1500 ? sectionsOf(b.text) : [] }));
}

function analyzeBlocks({ model, blocks, tools }) {
  const all = blocks.map((b) => b.text).join('\n');
  const toolChars = tools.reduce((s, t) => s + t.descChars, 0);
  return {
    model,
    blocks: summarizeBlocks(blocks),
    tools,
    toolChars,
    contextFiles: contextFilesOf(all),
    systemReminders: [...all.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)].map((m) => ({ chars: m[1].length, head: clip(m[1], 140) })),
    hookInstructions: [...all.matchAll(HOOK_INSTRUCTION)].map((m) => ({ chars: m[1].length, head: clip(m[1], 200) })),
    skillsListed: listedSkills(all),
    skillBodiesPreloaded: [...new Set([...all.matchAll(SKILL_BODY)].map((m) => path.basename(m[1])))],
    skillMdMentioned: [...new Set([...all.matchAll(SKILL_MD_PATH)].map((m) => m[1]))],
    toolNamesInPrompt: toolNamesInPrompt(all, tools),
    totalChars: all.length + toolChars,
  };
}

function analyzeClaudeRequest(body) {
  const blocks = [];
  (Array.isArray(body.system) ? body.system : body.system ? [body.system] : []).forEach((b, i) => blocks.push({ where: `system[${i}]`, role: 'system', text: textOf(b) }));
  (body.messages || []).forEach((m, i) => blocks.push({ where: `messages[${i}]`, role: m.role, text: textOf(m.content) }));
  const tools = (body.tools || []).map((t) => ({ name: t.name ?? '?', descChars: JSON.stringify(t).length }));
  return analyzeBlocks({ model: body.model ?? null, blocks, tools });
}

// ---- kiro-cli: request dump and engine log ----

function walkFiles(root, test) {
  const out = [];
  const walk = (d) => {
    let names;
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      const p = path.join(d, n);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && test(n, p)) out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(root);
  return out;
}

function readKiroDumps(dir) {
  const root = path.join(dir, 'kiro', 'requests');
  return walkFiles(root, (n) => n.endsWith('.json')).map((f) => {
    const n = path.basename(f.path);
    const m = /^(\d+)-(\d+)\.json$/.exec(n);
    const group = path.relative(root, path.dirname(f.path)).split(path.sep);
    return { file: path.relative(dir, f.path), seq: m ? Number(m[1]) : null, timeMs: m ? Number(m[2]) : f.mtimeMs, kind: group[0] === 'infra-safety' || group[0] === 'requirements-analysis' ? group[0] : group[0].startsWith('sess_') ? 'session' : 'side', conversation: group.at(-1), body: readJson(f.path), bytes: f.size };
  }).sort((a, b) => a.timeMs - b.timeMs);
}

const kiroState = (dump) => dump.body?.request?.conversationState ?? null;

/** The engine log lines of a kiro-cli run: [{ timeMs, level, message, data }]. kiro.log is preferred; kiro-chat.log holds the same lines. */
function readKiroLog(dir) {
  const files = walkFiles(path.join(dir, 'home-logs'), (n) => n === 'kiro.log');
  const fallback = files.length ? [] : walkFiles(path.join(dir, 'tmp-logs'), (n) => n === 'kiro-chat.log');
  const out = [];
  for (const f of [...files, ...fallback]) {
    for (const line of readLines(f.path)) {
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      out.push({ timeMs: Date.parse(j.timestamp), level: j.level, message: String(j.message ?? ''), raw: j });
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

function kiroMarkers(log) {
  const out = [];
  for (const l of log) {
    if (!l.message.startsWith('KIRO_TIMELINE ')) continue;
    try { out.push(JSON.parse(l.message.slice('KIRO_TIMELINE '.length))); } catch { /* skip */ }
  }
  return out;
}

function kiroRequests(dumps, markers) {
  const agentOfExec = new Map();
  for (const d of dumps) if (d.body?.invocation?.executionId) agentOfExec.set(d.body.invocation.executionId, d.body.invocation.agentName ?? 'root');
  const sessionDumps = dumps.filter((d) => d.kind === 'session' && kiroState(d));
  const used = new Set();
  const rows = [];
  const starts = markers.filter((m) => m.kind === 'model_start');
  for (const s of starts) {
    const end = markers.find((m) => m.kind === 'model_end' && m.actionId === s.actionId);
    const dump = sessionDumps.find((d) => !used.has(d.file) && d.body?.invocation?.executionId === s.executionId && d.timeMs >= s.ts - 50);
    if (dump) used.add(dump.file);
    const st = dump ? kiroState(dump) : null;
    rows.push({
      timeMs: s.ts, endMs: end?.ts ?? null, source: dump ? 'timeline+dump' : 'timeline', model: st?.currentMessage?.userInputMessage?.modelId ?? null,
      latencyMs: end?.durationMs ?? null, ttftMs: null, status: end?.status ?? null,
      input: null, output: null, cacheRead: null, cacheWrite: null, costUsd: null,
      agent: agentOfExec.get(s.executionId) ?? (s.executionId ? `exec:${s.executionId.slice(0, 8)}` : 'root'),
      requestChars: st ? JSON.stringify(st).length : null, history: st ? (st.history || []).length : null, file: dump?.file ?? null,
    });
  }
  for (const d of sessionDumps) {
    if (used.has(d.file)) continue;
    const st = kiroState(d);
    rows.push({ timeMs: d.timeMs, endMs: null, source: 'dump', model: st.currentMessage?.userInputMessage?.modelId ?? null, latencyMs: null, ttftMs: null, input: null, output: null, cacheRead: null, cacheWrite: null, costUsd: null, agent: d.body?.invocation?.agentName ?? 'root', requestChars: JSON.stringify(st).length, history: (st.history || []).length, file: d.file });
  }
  return rows.sort((a, b) => a.timeMs - b.timeMs);
}

function analyzeKiroRequest(dump) {
  const st = kiroState(dump);
  const cur = st?.currentMessage?.userInputMessage ?? {};
  const ctxObj = cur.userInputMessageContext ?? {};
  const blocks = [];
  (st?.history || []).forEach((h, i) => {
    const role = h.userInputMessage ? 'user' : h.assistantResponseMessage ? 'assistant' : Object.keys(h)[0];
    blocks.push({ where: `history[${i}]`, role, text: textOf((h.userInputMessage ?? h.assistantResponseMessage ?? {}).content ?? '') });
  });
  blocks.push({ where: 'currentMessage', role: 'user', text: textOf(cur.content) });
  const tools = (ctxObj.tools || []).map((t) => ({ name: t.toolSpecification?.name ?? t.name ?? '?', descChars: JSON.stringify(t).length }));
  const out = analyzeBlocks({ model: cur.modelId ?? null, blocks, tools });
  out.contextFields = Object.fromEntries(Object.entries(ctxObj).map(([k, v]) => [k, JSON.stringify(v ?? null).length]));
  out.agent = dump.body?.invocation?.agentName ?? 'root';
  return out;
}

function kiroHooks(log, dumps) {
  const out = [];
  for (const l of log) {
    if (!/^hooks?\./.test(l.message)) continue;
    const name = l.message.split(' ')[0];
    out.push({ source: 'kiro.log', timeMs: l.timeMs, phase: name, event: (/^hooks\.([a-zA-Z]+)\./.exec(name) || [])[1] ?? null, name: null, output: clip(l.message.slice(name.length), 300) });
  }
  for (const d of dumps.filter((x) => x.kind === 'session')) {
    const st = kiroState(d);
    if (!st) continue;
    const text = textOf(st.currentMessage?.userInputMessage?.content ?? '');
    for (const m of text.matchAll(HOOK_INSTRUCTION)) out.push({ source: `dump ${d.file}`, timeMs: d.timeMs, phase: 'HOOK_INSTRUCTION in the request', event: null, name: null, output: clip(m[1], 300) });
  }
  return out;
}

function kiroTimed(log, dumps) {
  const out = [];
  for (const m of kiroMarkers(log)) {
    let text = m.kind;
    if (m.kind === 'model_end') text = `model request done ${m.durationMs} ms (${m.status})`;
    else if (m.kind === 'model_start') text = 'model request start';
    else if (m.kind === 'tool_start') text = `tool ${m.tool} start`;
    else if (m.kind === 'tool_end') text = `tool ${m.tool} ${m.status} ${m.durationMs} ms`;
    else if (m.kind === 'turn_end') text = `turn end (${m.status}, ${m.stopReason ?? ''})`;
    out.push({ timeMs: m.ts, text: `${text}${m.executionId ? ` [exec ${m.executionId.slice(0, 8)}]` : ''}` });
  }
  for (const l of log) {
    if (/^hooks?\./.test(l.message) && !/Reload|agentProfile/.test(l.message)) out.push({ timeMs: l.timeMs, text: clip(l.message, 200) });
    else if (/^\[ContextProjection\]/.test(l.message)) out.push({ timeMs: l.timeMs, text: clip(l.message, 160) });
  }
  for (const d of dumps) out.push({ timeMs: d.timeMs, text: `request dumped (${d.kind}${d.kind === 'session' ? '' : ` ${d.conversation}`}), ${d.bytes} B: ${d.file}` });
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

// ---- assembly ----

function skillActivity(entries) {
  const loads = entries.filter((e) => e.kind === 'skill-load');
  const reads = entries.filter((e) => e.kind === 'tool' && /^(Read|fs_read|read)$/.test(e.tool) && /\/skills\//.test(JSON.stringify(e.input ?? {})));
  const refReads = reads.filter((e) => /\/references\//.test(JSON.stringify(e.input ?? {})));
  return {
    loaded: [...new Set(loads.filter((e) => !e.failed && !e.deferred).map((e) => `${e.input?.name}${e.via ? ' (Read SKILL.md)' : ''}`))],
    failed: loads.filter((e) => e.failed || e.deferred).map((e) => ({ n: e.n, agent: e.agent, name: e.input?.name ?? null, deferred: Boolean(e.deferred), result: clip(e.result ?? '', 200) })),
    referenceReads: refReads.map((e) => ({ n: e.n, agent: e.agent, path: e.input?.file_path ?? e.input?.path ?? null })),
    finds: entries.filter((e) => e.kind === 'skill-find').length,
  };
}

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
        for (const l of lines) { try { const j = JSON.parse(l); if (j.type === 'user') { firstUser = textOf(j.message?.content); break; } } catch { /* skip */ } }
        out.push({ file: path.relative(dir, p), lines: lines.length, sidechain: /subagents?\//.test(p) || /agent-/.test(n), firstPrompt: firstUser });
      }
    }
  };
  walk(root);
  return out;
}

function linkSubagents(entries, transcripts) {
  return entries.filter((e) => e.kind === 'delegate').map((d) => {
    const brief = oneLine(d.input?.prompt ?? d.input?.task ?? d.input?.description ?? '');
    const head = brief.slice(0, 120);
    const match = head ? transcripts.find((t) => t.sidechain && oneLine(t.firstPrompt).startsWith(head)) : null;
    return { n: d.n, parent: d.agent, target: d.target, status: d.status, briefChars: brief.length, transcript: match?.file ?? null };
  });
}

const fmtMs = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
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
  if (harness === 'claude-code') {
    const otel = readOtlp(path.join(dir, 'otlp.jsonl'));
    const bodies = requestBodies(otel.logs);
    raw = { otelLogs: otel.logs.length, spans: otel.spans.length, metricBatches: otel.metricBatches, requestBodies: bodies.length, events: Object.fromEntries(Object.entries(otel.logs.reduce((m, l) => { m[l.name] = (m[l.name] || 0) + 1; return m; }, {})).sort()) };
    requests = claudeRequests(otel);
    if (!requests.length) requests = streamRequests(events);
    if (bodies.length) { first = analyzeClaudeRequest(bodies[0].body); firstSource = bodies[0].source; }
    hooks = claudeHooks(events, otel);
    timed = claudeTimed(otel);
  } else if (harness === 'kiro-cli') {
    const dumps = readKiroDumps(dir);
    const log = readKiroLog(dir);
    const markers = kiroMarkers(log);
    raw = { dumps: dumps.length, sessionDumps: dumps.filter((d) => d.kind === 'session').length, logLines: log.length, timelineMarkers: markers.length };
    requests = kiroRequests(dumps, markers);
    sideRequests = dumps.filter((d) => d.kind !== 'session').map((d) => ({ file: d.file, kind: d.kind, bytes: d.bytes, model: kiroState(d)?.currentMessage?.userInputMessage?.modelId ?? null, head: clip(textOf(kiroState(d)?.currentMessage?.userInputMessage?.content ?? ''), 100) }));
    const firstDump = dumps.find((d) => d.kind === 'session' && kiroState(d));
    if (firstDump) { first = analyzeKiroRequest(firstDump); firstSource = `dump ${firstDump.file}`; }
    hooks = kiroHooks(log, dumps);
    timed = kiroTimed(log, dumps);
  }
  const t0 = [...requests.map((r) => r.timeMs), ...timed.map((t) => t.timeMs)].filter((x) => x != null).sort((a, b) => a - b)[0] ?? null;
  const skillsSeen = skillActivity(entries);
  const loadedNames = new Set(skillsSeen.loaded.map((x) => x.replace(/ \(.*$/, '')));
  const transcripts = harness === 'claude-code' ? subagentTranscripts(dir) : [];
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
    hooks,
    skills: { ...skillsSeen, listedNotLoaded: (first?.skillsListed || []).filter((n) => !loadedNames.has(n)) },
    subagents: linkSubagents(entries, transcripts),
    transcripts,
    trace,
  };
}

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
    L.push(`- hook instructions in the request: ${f.hookInstructions.length ? f.hookInstructions.map((x) => `${x.chars} chars "${x.head}"`).join('; ') : 'none'}`);
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
  for (const h of r.hooks) L.push(`- ${h.source}${h.timeMs ? ` ${fmtMs(h.timeMs - (r.timed[0]?.timeMs ?? h.timeMs))}` : ''} ${h.phase} ${h.event ?? ''} ${h.name ?? ''}${h.exitCode != null ? ` exit ${h.exitCode}` : ''}${h.outcome ? ` ${h.outcome}` : ''}: ${clip(h.output, 300) || '(no output)'}`);
  L.push('');

  L.push('## Skills');
  L.push('');
  const sk = r.skills;
  L.push(`- loaded: ${sk.loaded.length ? sk.loaded.join(', ') : 'none'}`);
  L.push(`- failed or refused skill calls: ${sk.failed.length ? sk.failed.map((f) => `#${f.n} ${f.name ?? '(no name)'}${f.deferred ? ' (refused)' : ''}${f.result ? `: ${f.result}` : ''}`).join('; ') : 'none'}`);
  L.push(`- reads under references/: ${sk.referenceReads.length ? sk.referenceReads.map((x) => `#${x.n} ${x.path}`).join('; ') : 'none'}`);
  L.push(`- find_skills calls: ${sk.finds}`);
  L.push(`- listed in the first request but not loaded: ${sk.listedNotLoaded.length ? `${sk.listedNotLoaded.length} of ${r.first.skillsListed.length}` : r.first ? 'none' : 'unknown (no first request)'}`);
  L.push('');

  L.push('## Sub-agents');
  L.push('');
  if (!r.subagents.length) L.push('No delegation.');
  for (const d of r.subagents) L.push(`- #${d.n} ${d.parent} -> ${d.target} (${d.status ?? 'n/a'}), brief ${d.briefChars} chars, transcript: ${d.transcript ?? 'not matched'}`);
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

/** Writes <run>/introspect/timeline.md and timeline.json. Returns the report data. */
function writeReport(runDir) {
  const dir = path.join(runDir, 'introspect');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const r = buildReport(runDir);
  const { trace, ...rest } = r;
  fs.writeFileSync(path.join(dir, 'timeline.md'), renderReport(r), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'timeline.json'), `${JSON.stringify({ ...rest, timelineEntries: trace?.entries?.length ?? 0 }, null, 2)}\n`, { mode: 0o600 });
  return r;
}

module.exports = { toolNamesInPrompt, buildReport, renderReport, writeReport, readOtlp, requestBodies, analyzeClaudeRequest, analyzeKiroRequest, readKiroDumps, readKiroLog, kiroMarkers, kiroRequests, claudeRequests, listedSkills, sectionsOf, probeMatrix, attrMap };
