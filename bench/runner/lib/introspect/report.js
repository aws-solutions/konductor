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
const { SUBAGENT_TOOLS: CC_SUBAGENT_TOOLS } = require('../harness/claude-code-parse.js');
const skills = require('../skills.js');

const { readJsonOrNull: readJson } = require('../util.js');
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
      if (looksLikeRequest(o)) { out.push({ timeMs: l.timeMs, body: o, source: `otel ${l.name}`, agentId: l.attrs?.agent_id ?? null }); break; }
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

/**
 * Hook text Claude Code put into the request bodies: one row per distinct text, with the block it was first seen in and
 * how many bodies carry it (later bodies repeat the conversation, so a SessionStart text recurs in each).
 */
function claudeHookInjections(bodies, hookOutputs) {
  const rows = new Map();
  bodies.forEach((b, i) => {
    for (const h of analyzeClaudeRequest(b.body, { hookOutputs }).hookInstructions) {
      const k = `${h.hook}\u0000${h.head}`;
      const cur = rows.get(k) ?? { ...h, firstBody: i + 1, bodies: 0, childBodies: 0 };
      cur.bodies++;
      if (b.agentId) cur.childBodies++;
      rows.set(k, cur);
    }
  });
  return [...rows.values()].map((r) => ({ ...r, ofBodies: bodies.length, ofChildBodies: bodies.filter((b) => b.agentId).length }));
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

// Claude Code prepends a hook's stdout to a prompt block as "<Event>:<matcher> hook <outcome>: <text>".
const HOOK_OUTPUT = /(?:^|\n)([A-Z][A-Za-z]+(?::[^\s:]+)?) hook ([a-z]+(?: [a-z]+)?): /g;

/**
 * Hook text injected into the prompt blocks, with the block it sits in: <HOOK_INSTRUCTION> tags (kiro-cli) and Claude
 * Code hook output lines. `known` are hook outputs from the stream; a known text found verbatim gives the exact length,
 * otherwise the text runs to the next blank line.
 */
function hookTextsIn(blocks, known = []) {
  const out = [];
  for (const b of blocks) {
    for (const m of b.text.matchAll(HOOK_INSTRUCTION)) out.push({ where: b.where, kind: 'HOOK_INSTRUCTION', hook: null, chars: m[1].length, head: clip(m[1], 200) });
    for (const m of b.text.matchAll(HOOK_OUTPUT)) {
      const start = m.index + m[0].length;
      const rest = b.text.slice(start);
      const k = known.find((t) => t && rest.startsWith(t));
      const text = k ?? rest.split(/\n\n/)[0];
      out.push({ where: b.where, kind: 'hook output', hook: m[1], outcome: m[2], chars: text.length, head: clip(text, 200), matchedStream: Boolean(k) });
    }
  }
  return out;
}

function analyzeBlocks({ model, blocks, tools, hookOutputs = [] }) {
  const all = blocks.map((b) => b.text).join('\n');
  const toolChars = tools.reduce((s, t) => s + t.descChars, 0);
  return {
    model,
    blocks: summarizeBlocks(blocks),
    tools,
    toolChars,
    contextFiles: contextFilesOf(all),
    systemReminders: [...all.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)].map((m) => ({ chars: m[1].length, head: clip(m[1], 140) })),
    hookInstructions: hookTextsIn(blocks, hookOutputs),
    skillsListed: listedSkills(all),
    skillBodiesPreloaded: [...new Set([...all.matchAll(SKILL_BODY)].map((m) => path.basename(m[1])))],
    skillMdMentioned: [...new Set([...all.matchAll(SKILL_MD_PATH)].map((m) => m[1]))],
    toolNamesInPrompt: toolNamesInPrompt(all, tools),
    totalChars: all.length + toolChars,
  };
}

function analyzeClaudeRequest(body, { hookOutputs = [] } = {}) {
  const blocks = [];
  (Array.isArray(body.system) ? body.system : body.system ? [body.system] : []).forEach((b, i) => blocks.push({ where: `system[${i}]`, role: 'system', text: textOf(b) }));
  (body.messages || []).forEach((m, i) => blocks.push({ where: `messages[${i}]`, role: m.role, text: textOf(m.content) }));
  const tools = (body.tools || []).map((t) => ({ name: t.name ?? '?', descChars: JSON.stringify(t).length }));
  return analyzeBlocks({ model: body.model ?? null, blocks, tools, hookOutputs });
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
    const body = readJson(f.path);
    // A sub-agent's requests sit in a directory of their own, named by chat, with the agent and its subtask id in `invocation`.
    const special = group[0] === 'infra-safety' || group[0] === 'requirements-analysis' ? group[0] : null;
    const sub = !special && !group[0].startsWith('sess_') && body?.invocation?.agentName && body?.invocation?.executionId;
    return { file: path.relative(dir, f.path), seq: m ? Number(m[1]) : null, timeMs: m ? Number(m[2]) : f.mtimeMs, kind: special ?? (group[0].startsWith('sess_') ? 'session' : sub ? 'subagent' : 'side'), conversation: group.at(-1), body, bytes: f.size };
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

// The events of one tool call, for a stream with many: a kiro-cli update carries its call id; a Claude Code message is
// cut down to the one block of that call.
function eventsByCall(events, harness) {
  const by = new Map();
  const add = (id, ev) => { if (!by.has(id)) by.set(id, []); by.get(id).push(ev); };
  for (const ev of events) {
    if (harness === 'claude-code') {
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
  if (harness !== 'claude-code' && harness !== 'kiro-cli') return null;
  const out = [];
  for (const [id, evs] of eventsByCall(events, harness)) {
    let x;
    try { x = skills.extractSkills(evs, harness); } catch { continue; }
    for (const l of x.skillsLoaded) for (let i = 0; i < l.count; i++) out.push({ id, name: l.name, via: l.via });
  }
  return out;
}

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
  for (const ev of events) {
    if (harness === 'claude-code') {
      if (ev.type !== 'assistant') continue;
      for (const b of ev.message?.content || []) {
        if (b.type !== 'tool_use' || !b.id || scopeOfCall.has(b.id)) continue;
        scopeOfCall.set(b.id, ev.parent_tool_use_id ?? null);
        if (CC_SUBAGENT_TOOLS.has(b.name)) childOfCall.set(b.id, b.id);
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
  const subExec = harness === 'kiro-cli' ? kiroSubExecutions(runDir) : new Map();
  const children = entries.filter((e) => e.kind === 'delegate').map((d, i) => {
    const brief = oneLine(d.input?.prompt ?? d.input?.task ?? d.input?.description ?? '');
    const key = childOfCall.get(d.id) ?? null;
    let transcript = null;
    let tx = null;
    if (harness === 'kiro-cli') {
      tx = key ? subExec.get(key) ?? null : null;
      transcript = tx?.file ?? null;
    } else {
      const head = brief.slice(0, 120);
      tx = transcripts.find((t) => t.toolUseId && t.toolUseId === d.id) ?? (head ? transcripts.find((t) => t.sidechain && !t.toolUseId && oneLine(t.firstPrompt).startsWith(head)) : null) ?? null;
      transcript = tx?.file ?? null;
    }
    const child = {
      index: i + 1, n: d.n, id: d.id ?? null, key, parent: d.agent, target: d.target, status: d.status, briefChars: brief.length,
      transcript, transcriptLines: tx?.lines ?? null, agentId: tx?.agentId ?? null, linkedBy: !transcript ? null : harness === 'kiro-cli' ? 'subtask id' : tx.toolUseId ? 'tool use id' : 'brief prefix',
      preloads: null, firstRequest: null,
    };
    if (harness === 'claude-code') {
      const expected = Array.isArray(result?.skillsPreloaded) ? result.skillsPreloaded.filter((s) => (s.agents || []).includes(d.target)).map((s) => ({ name: s.name, bytes: s.bytes ?? null })) : null;
      child.preloads = { expected, seen: tx ? tx.preloads : null };
      child.firstRequest = otel ? claudeChildFirst(otel, child.agentId) : null;
    } else if (harness === 'kiro-cli' && key) {
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

const fmtHookText = (x) => `${x.kind === 'hook output' ? `${x.hook} hook ${x.outcome}` : x.kind} at ${x.where}, ${x.chars} chars "${x.head}"`;
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
