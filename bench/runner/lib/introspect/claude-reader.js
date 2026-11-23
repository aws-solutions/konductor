// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads Claude Code runs for the introspection report: the OTLP (http/json) logs and the request, hook and timing rows. Split out of report.js (DEBT D-25).

const skills = require('../skills.js');
const { readLines, oneLine, clip, numOrNull } = require('./report-text.js');
const { analyzeClaudeRequest } = require('./prompt-blocks.js');

// ---- OTLP (http/json) ----

/** The plain value of one OTLP attribute value (string, int, double, bool, array or key-value list). */
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

/** An OTLP attribute list ([{key, value}]) as a plain {key: value} object. */
function attrMap(list) {
  const out = {};
  for (const a of list || []) out[a.key] = attrValue(a.value);
  return out;
}

/** An OTLP nanosecond time stamp (string or number) in whole milliseconds, or null. */
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

/** Whether `o` is a model request body: an object with a messages array. */
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

/** One row per Claude Code api_request log in `otel`: time, model, latency, tokens and cost, source otel. */
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

/** Hook records of a Claude Code run: the stream's hook_* system events and the OTLP hook logs, each with its source. */
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

module.exports = { attrMap, readOtlp, requestBodies, claudeRequests, streamRequests, claudeHooks, claudeHookInjections, claudeTimed };
