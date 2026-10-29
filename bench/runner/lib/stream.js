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

const APPROVAL_PHRASE = /\b(shall i|should i|would you like|do you want|want me to|please confirm|please let me know (which|whether|if)|before i proceed|awaiting your)\b/i;

// True when the run ended waiting on the user: wrong stop reason, a trailing question,
// or an approval request in the last paragraph. Null when there is no final message to judge.
function detectAskedUser({ finalText, stopReason, runFinishedStatus }) {
  if (runFinishedStatus == null) return null;
  if (stopReason && stopReason !== 'end_turn') return true;
  const text = (finalText || '').trim();
  if (!text) return false;
  const last = text.split(/\n\s*\n/).pop().trim();
  const tail = last.replace(/[\s*_`"')\]]+$/, '');
  return tail.endsWith('?') || APPROVAL_PHRASE.test(last);
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
          if (skillCallIds.has(u.toolCallId) && (u.status === 'failed' || mcpOutputIsError(u))) skillErrorIds.add(u.toolCallId);
          break;
        }
        if (u.sessionUpdate !== 'tool_call') break;
        if (u.toolCallId && seenToolCalls.has(u.toolCallId)) break;
        if (u.toolCallId) seenToolCalls.add(u.toolCallId);
        const name = toolNameOf(u);
        out.toolCalls++;
        out.toolNames[name ?? 'unknown'] = (out.toolNames[name ?? 'unknown'] || 0) + 1;
        if (name === SUBAGENT_TOOL) out.subagentCalls++;
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
  out.skillsMcp.errors = skillErrorIds.size;
  if (out.skillsMcp.calls > 0) out.skillsMcpOk = out.skillsMcp.errors < out.skillsMcp.calls;
  out.askedUser = detectAskedUser(out);
  return out;
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

module.exports = { parseStream, aggregateStream, summarizeSessionJson, detectAskedUser, SUBAGENT_TOOL, SKILLS_SERVER, SKILL_TOOLS };
