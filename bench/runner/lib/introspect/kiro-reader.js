// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads Kiro CLI runs for the introspection report: the request dumps and the engine log. Split out of report.js (DEBT D-25).

const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrNull: readJson } = require('../util.js');
const { readLines, clip } = require('./report-text.js');
const { textOf, HOOK_INSTRUCTION, analyzeBlocks } = require('./prompt-blocks.js');

// ---- kiro-cli: request dump and engine log ----

/** Every file under `root` (sorted, depth first) whose path passes `test`. */
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

/** The Kiro CLI request dumps under `<dir>/kiro/requests`, each with its kind, conversation, time, size and parsed body. */
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

/** The conversationState of a Kiro request dump, or null. */
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

/** The KIRO_TIMELINE markers of the engine `log`, parsed; a line that does not parse is skipped. */
function kiroMarkers(log) {
  const out = [];
  for (const l of log) {
    if (!l.message.startsWith('KIRO_TIMELINE ')) continue;
    try { out.push(JSON.parse(l.message.slice('KIRO_TIMELINE '.length))); } catch { /* skip */ }
  }
  return out;
}

/** One row per Kiro model request: a timeline model_start matched to its model_end and its session dump, plus dumps no marker matched. */
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

/** What the first Kiro request held (P5): its prompt blocks, tools and hook texts, from one session dump. */
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

/** Hook records of a Kiro run: hooks.* lines of the engine log and HOOK_INSTRUCTION blocks in the request dumps. */
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

/** The timed lines of a Kiro run for the timeline: timeline markers, hook and context lines of the log, and each dump. */
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

module.exports = { walkFiles, readKiroDumps, kiroState, readKiroLog, kiroMarkers, kiroRequests, analyzeKiroRequest, kiroHooks, kiroTimed };
