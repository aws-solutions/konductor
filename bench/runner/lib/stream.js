// SPDX-License-Identifier: Apache-2.0
'use strict';

// Parser and aggregator for `kiro-cli chat --output-format stream-json` output.

function parseStream(text) {
  const events = [];
  let badLines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      badLines++;
    }
  }
  return { events, badLines };
}

const SUBAGENT_TOOL = 'subagent';
// Pseudo-tool a subagent uses to hand its result back; neither is work done on the task.
const OVERHEAD_TOOLS = new Set([SUBAGENT_TOOL, 'summary']);
const SKILLS_SERVER = 'konductor-skills';
const SKILL_TOOLS = new Set(['find_skills', 'get_skill']);

// toolName lives in update._meta.kiro.toolName; titles are a last-resort fallback.
function toolNameOf(update) {
  return update?._meta?.kiro?.toolName ?? null;
}

function mcpOutputIsError(update) {
  const items = update?.rawOutput?.items;
  return Array.isArray(items) && items.some((i) => i?.Json?.isError === true);
}

// The agents a subagent call hands work to: the role of each pipeline stage, else a single role/agent field.
// A call that names none is counted as (unnamed) so delegatedTo adds up to subagentCalls.
function subagentTargets(input) {
  const names = [];
  const pick = (o) => [o?.role, o?.agent, o?.agent_name, o?.agentName].find((v) => typeof v === 'string' && v.trim());
  if (input && typeof input === 'object') {
    if (Array.isArray(input.stages)) for (const st of input.stages) { const n = pick(st); if (n) names.push(n.trim()); }
    if (!names.length) { const n = pick(input); if (n) names.push(n.trim()); }
  }
  return names.length ? names : ['(unnamed)'];
}

const APPROVAL_PHRASE = /\b(shall i|should i|would you like|do you want|want me to|please confirm|please let me know (which|whether|if)|before i proceed|awaiting your)\b/i;
// A lead-in such as "A few questions before I start:" makes the list under it an ask.
const ANNOUNCES_ASK = /\b(questions?|clarif\w+|need to know|need your input|please (confirm|tell me|let me know|specify|choose|pick))\b[^?]*:\s*$/i;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;

// Code is not prose: a `?` in a ternary or an optional chain must not read as a question.
function stripCode(text) {
  return String(text || '').replace(/```[\s\S]*?(?:```|$)/g, '\n\n').replace(/`[^`\n]*`/g, ' ');
}

const paragraphsOf = (text) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

function asksIn(s) {
  const tail = String(s).trim().replace(/[\s*_`"')\]]+$/, '');
  return tail.endsWith('?') || APPROVAL_PHRASE.test(s);
}

// For a final paragraph that ends in a list: the text that introduces the list, and the last item.
function listParts(paras) {
  const last = paras.at(-1);
  const lines = last.split('\n');
  if (!LIST_ITEM.test(lines.at(-1)) && !/^\s+/.test(lines.at(-1))) return null;
  let start = lines.length;
  while (start > 0 && (LIST_ITEM.test(lines[start - 1]) || /^\s+\S/.test(lines[start - 1]))) start--;
  const lead = start > 0 ? lines.slice(0, start).join(' ') : paras.at(-2) ?? '';
  return { lead, item: lines.at(-1) };
}

// True when the run ended waiting on the user: wrong stop reason, a trailing question,
// an approval request in the last paragraph, or a list under a question. Null when there is no final message to judge.
function detectAskedUser({ finalText, stopReason, runFinishedStatus }) {
  if (runFinishedStatus == null) return null;
  if (stopReason && stopReason !== 'end_turn') return true;
  const paras = paragraphsOf(stripCode(finalText));
  if (!paras.length) return false;
  const list = listParts(paras);
  if (list) return asksIn(list.item) || asksIn(list.lead) || ANNOUNCES_ASK.test(list.lead.trim());
  return asksIn(paras.at(-1));
}

// The part of the final text that carries the ask, for matching an answer to it: from the first of the last
// four paragraphs that asks something to the end, code removed.
function extractQuestion({ finalText, stopReason }) {
  const paras = paragraphsOf(stripCode(finalText));
  if (!paras.length) return stopReason && stopReason !== 'end_turn' ? `(no final text; stop reason ${stopReason})` : '';
  const from = Math.max(0, paras.length - 4);
  let start = paras.length - 1;
  for (let i = from; i < paras.length; i++) {
    if (paras[i].includes('?') || APPROVAL_PHRASE.test(paras[i]) || ANNOUNCES_ASK.test(paras[i].split('\n')[0])) { start = i; break; }
  }
  return paras.slice(start).join('\n\n');
}

function aggregateStream(events) {
  const out = {
    sessionId: null,
    sessionIds: [],
    runFinishedStatus: null,
    stopReason: null,
    credits: 0,
    meteringEntries: 0,
    nonCreditUnits: [],
    turnDurationMs: null,
    contextUsagePercentage: null,
    toolCalls: 0,
    workToolCalls: 0,
    subagentCalls: 0,
    delegatedTo: {},
    toolNames: {},
    skillsMcp: { calls: 0, errors: 0 },
    skillsMcpOk: null,
    engine: null,
    finalText: null,
    finalTextTruncated: null,
    askedUser: null,
  };
  const seenToolCalls = new Set();
  const skillCallIds = new Set();
  const skillErrorIds = new Set();
  const subagentInputs = new Map();
  const addInput = (id, input) => {
    if (id && subagentInputs.has(id) && input && typeof input === 'object') subagentInputs.set(id, { ...subagentInputs.get(id), ...input });
  };
  let lastTurnDurationMs = null;
  for (const ev of events) {
    const d = ev.data || {};
    if (d.sessionId && !out.sessionIds.includes(d.sessionId)) out.sessionIds.push(d.sessionId);
    switch (ev.type) {
      case 'runStarted':
        out.engine = d.engine ?? null;
        break;
      case 'metadata':
        if (typeof d.contextUsagePercentage === 'number') out.contextUsagePercentage = d.contextUsagePercentage;
        // Subagent turns nest inside the parent turn, so the last value (the parent's) is the whole turn.
        if (typeof d.turnDurationMs === 'number') lastTurnDurationMs = d.turnDurationMs;
        for (const m of d.meteringUsage || []) {
          if (m.unit !== 'credit') {
            if (!out.nonCreditUnits.includes(m.unit)) out.nonCreditUnits.push(m.unit);
            continue;
          }
          out.credits += Number(m.value) || 0;
          out.meteringEntries++;
        }
        break;
      case 'sessionUpdate': {
        const u = d.update || {};
        if (u.sessionUpdate === 'tool_call_update') {
          addInput(u.toolCallId, u.rawInput);
          if (skillCallIds.has(u.toolCallId) && (u.status === 'failed' || mcpOutputIsError(u))) skillErrorIds.add(u.toolCallId);
          break;
        }
        if (u.sessionUpdate !== 'tool_call') break;
        if (u.toolCallId && seenToolCalls.has(u.toolCallId)) { addInput(u.toolCallId, u.rawInput); break; }
        if (u.toolCallId) seenToolCalls.add(u.toolCallId);
        const name = toolNameOf(u);
        out.toolCalls++;
        out.toolNames[name ?? 'unknown'] = (out.toolNames[name ?? 'unknown'] || 0) + 1;
        if (name === SUBAGENT_TOOL) {
          out.subagentCalls++;
          subagentInputs.set(u.toolCallId ?? `anon-${out.subagentCalls}`, u.rawInput && typeof u.rawInput === 'object' ? { ...u.rawInput } : {});
        }
        if (!OVERHEAD_TOOLS.has(name)) out.workToolCalls++;
        if (SKILL_TOOLS.has(name) && u._meta?.kiro?.mcpServerName === SKILLS_SERVER) {
          out.skillsMcp.calls++;
          if (u.toolCallId) skillCallIds.add(u.toolCallId);
        }
        break;
      }
      case 'runFinished':
        out.runFinishedStatus = d.status ?? null;
        out.stopReason = d.stopReason ?? null;
        out.finalText = d.finalText ?? null;
        out.finalTextTruncated = typeof d.finalTextTruncated === 'boolean' ? d.finalTextTruncated : null;
        break;
      default:
    }
  }
  out.sessionId = out.sessionIds[0] ?? null;
  out.turnDurationMs = out.runFinishedStatus === null ? null : lastTurnDurationMs;
  for (const input of subagentInputs.values()) for (const n of subagentTargets(input)) out.delegatedTo[n] = (out.delegatedTo[n] || 0) + 1;
  out.skillsMcp.errors = skillErrorIds.size;
  if (out.skillsMcp.calls > 0) out.skillsMcpOk = out.skillsMcp.errors < out.skillsMcp.calls;
  out.askedUser = detectAskedUser(out);
  return out;
}

const sumOf = (aggs, key) => aggs.reduce((n, a) => n + (a[key] || 0), 0);

// One aggregate over the turns of a resumed conversation. Spend and call counts are summed (a tool call id
// can repeat across turns, so the turns are never aggregated as one stream); what the run ended with comes from the last turn.
function mergeAggregates(aggs) {
  if (aggs.length === 1) return aggs[0];
  const last = aggs.at(-1);
  const toolNames = {};
  for (const a of aggs) for (const [k, v] of Object.entries(a.toolNames)) toolNames[k] = (toolNames[k] || 0) + v;
  const delegatedTo = {};
  for (const a of aggs) for (const [k, v] of Object.entries(a.delegatedTo || {})) delegatedTo[k] = (delegatedTo[k] || 0) + v;
  const sessionIds = [...new Set(aggs.flatMap((a) => a.sessionIds))];
  const durations = aggs.map((a) => a.turnDurationMs).filter((v) => typeof v === 'number');
  const skillsMcp = { calls: aggs.reduce((n, a) => n + a.skillsMcp.calls, 0), errors: aggs.reduce((n, a) => n + a.skillsMcp.errors, 0) };
  return {
    ...last,
    sessionId: sessionIds[0] ?? null,
    sessionIds,
    credits: sumOf(aggs, 'credits'),
    meteringEntries: sumOf(aggs, 'meteringEntries'),
    nonCreditUnits: [...new Set(aggs.flatMap((a) => a.nonCreditUnits))],
    turnDurationMs: last.runFinishedStatus === null || !durations.length ? null : durations.reduce((a, b) => a + b, 0),
    contextUsagePercentage: [...aggs].reverse().map((a) => a.contextUsagePercentage).find((v) => typeof v === 'number') ?? null,
    toolCalls: sumOf(aggs, 'toolCalls'),
    workToolCalls: sumOf(aggs, 'workToolCalls'),
    subagentCalls: sumOf(aggs, 'subagentCalls'),
    delegatedTo,
    toolNames,
    skillsMcp,
    skillsMcpOk: skillsMcp.calls > 0 ? skillsMcp.errors < skillsMcp.calls : null,
    engine: aggs[0].engine,
  };
}

// Reads the per-turn metadata in a kiro-cli session .json (total_request_count, model, builtin_tool_uses).
function summarizeSessionJson(session) {
  const turns = session?.session_state?.conversation_metadata?.user_turn_metadatas || [];
  const sum = (key) => turns.reduce((s, t) => s + (Number(t[key]) || 0), 0);
  return {
    turns: turns.length,
    totalRequestCount: turns.length ? sum('total_request_count') : null,
    builtinToolUses: turns.length ? sum('builtin_tool_uses') : null,
    model: turns.length ? turns[turns.length - 1].model ?? null : null,
    meteringTotal: turns.reduce(
      (s, t) => s + (t.metering_usage || []).reduce((a, m) => a + (Number(m.value) || 0), 0),
      0,
    ),
  };
}

// The model of every user turn recorded in a kiro-cli session .json, oldest first.
function sessionModels(session) {
  return (session?.session_state?.conversation_metadata?.user_turn_metadatas || []).map((t) => t.model ?? null);
}

module.exports = { subagentTargets, sessionModels, parseStream, aggregateStream, mergeAggregates, summarizeSessionJson, detectAskedUser, extractQuestion, SUBAGENT_TOOL, SKILLS_SERVER, SKILL_TOOLS };
