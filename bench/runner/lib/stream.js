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

// Engine v3 sends no toolName, only a display title. These are the titles whose tool name the engine confirms in the
// turn summary's usedTools; any other title stays unknown.
const V3_TITLE_TOOLS = {
  'Read File': 'read_file',
  'List Directory': 'list_directory',
  'Write File': 'fs_write',
  'Replace in File': 'str_replace',
  'Run Command': 'execute_bash',
  'Grep Search': 'grep_search',
  'Append to File': 'fs_append',
  'Load Resource': 'load_resource',
  'Tool Call': 'tool_call',
  'get_skill': 'get_skill',
  '@konductor-skills/get_skill': 'get_skill',
};
const V3_SUBAGENT_TITLE = /^Sub-agent:/;

// Engine v2 puts the name in update._meta.kiro.toolName and it always wins. Engine v3 is read from the title.
function toolNameOf(update) {
  const named = update?._meta?.kiro?.toolName;
  if (named != null) return named;
  const title = update?.title;
  if (typeof title === 'string') {
    if (V3_SUBAGENT_TITLE.test(title)) return SUBAGENT_TOOL;
    if (Object.hasOwn(V3_TITLE_TOOLS, title)) return V3_TITLE_TOOLS[title];
  }
  // A shell command carries the model's own description as its title.
  return update?.kind === 'execute' ? V3_TITLE_TOOLS['Run Command'] : null;
}

// True for a call that came from engine v3, which names its sub-agent target in rawInput.name.
const isV3Call = (update) => update?._meta?.kiro?.toolName == null;

// Engine v3 titles a call to a loaded MCP tool "@<server>/<tool>". A call made before the tool was loaded is either
// wrapped ("Tool Call" with the tool id in rawInput.tool_id) or titled with the bare tool name; both come back failed.
const MCP_TITLE = /^@([^/\s]+)\/(\S+)$/;
const MCP_TOOL_ID = /^tool::([^:]+)::(\S+)$/;

// { server, tool } of a v3 call to an MCP tool, else null. v2 names the tool itself and is never read here.
function mcpCallOf(update) {
  if (!isV3Call(update) || typeof update?.title !== 'string') return null;
  const t = MCP_TITLE.exec(update.title);
  if (t) return { server: t[1], tool: t[2], deferred: false };
  const id = update.title === 'Tool Call' && typeof update.rawInput?.tool_id === 'string' ? MCP_TOOL_ID.exec(update.rawInput.tool_id) : null;
  return id ? { server: id[1], tool: id[2], deferred: true } : null;
}

const mcpToolNameOf = (update) => mcpCallOf(update)?.tool ?? null;

/**
 * A call to the skills server, from either engine: { tool: 'get_skill'|'find_skills', deferred }, else null.
 * v2 gives the tool and server in _meta.kiro. For v3, `deferred` marks a call made before the tool was loaded:
 * the engine refuses it, so it names a skill at most and never loads one.
 */
function skillsCallOf(update) {
  const kiro = update?._meta?.kiro;
  if (kiro?.toolName != null) return SKILL_TOOLS.has(kiro.toolName) && kiro.mcpServerName === SKILLS_SERVER ? { tool: kiro.toolName, deferred: false } : null;
  const mcp = mcpCallOf(update);
  if (mcp) return mcp.server === SKILLS_SERVER && SKILL_TOOLS.has(mcp.tool) ? { tool: mcp.tool, deferred: mcp.deferred } : null;
  return typeof update?.title === 'string' && SKILL_TOOLS.has(update.title) ? { tool: update.title, deferred: true } : null;
}

// The arguments of an MCP tool call. v3 nests them under rawInput.arguments next to the tool id; v2 sends them flat.
function mcpInputOf(rawInput) {
  if (!rawInput || typeof rawInput !== 'object' || typeof rawInput.tool_id !== 'string') return rawInput;
  return rawInput.arguments && typeof rawInput.arguments === 'object' ? rawInput.arguments : {};
}

function mcpOutputIsError(update) {
  const items = update?.rawOutput?.items;
  return Array.isArray(items) && items.some((i) => i?.Json?.isError === true);
}

// The agents a subagent call hands work to: the role of each pipeline stage, else a single role/agent field.
// A call that names none is counted as (unnamed) so delegatedTo adds up to subagentCalls.
// nameIsAgent is for an engine v3 call, whose top-level `name` is the agent; in v2 a `name` is a stage label.
function subagentTargets(input, { nameIsAgent = false } = {}) {
  const names = [];
  const pick = (o) => [o?.role, o?.agent, o?.agent_name, o?.agentName].find((v) => typeof v === 'string' && v.trim());
  if (input && typeof input === 'object') {
    if (Array.isArray(input.stages)) for (const st of input.stages) { const n = pick(st); if (n) names.push(n.trim()); }
    if (!names.length) { const n = pick(input); if (n) names.push(n.trim()); }
    if (!names.length && nameIsAgent && typeof input.name === 'string' && input.name.trim()) names.push(input.name.trim());
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

// A sentence after a question that waits on the answer ("Once you pick one, I'll ..."). A plain "let me know
// if you need more" is not one, so a rhetorical question followed by a polite closer stays an answer.
const AWAITS_ANSWER = /\b(once|when|after|as soon as) you\b|\byou (pick|choose|confirm|decide|answer|reply|tell|say|prefer)\b|\byour (answer|choice|pick|reply|call|preference|confirmation|decision)\b|\btell me\b|\blet me know (which|what|whether|how)\b|\b(awaiting|waiting (for|on))\b/i;

// Quoted text, URLs and quote blocks hold no ask of ours.
function plainSentences(text) {
  const clean = String(text)
    .replace(/^>.*$/gm, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g, ' ');
  return clean.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}

const endsAsking = (s) => s.replace(/[\s*_`"')\]]+$/, '').endsWith('?');

// A question that is not the last sentence: in the last paragraph with a closing sentence after it,
// or ending the paragraph before a short closing paragraph.
function questionBeforeClosing(paras) {
  const own = plainSentences(paras.at(-1));
  for (let i = Math.max(0, own.length - 3); i < own.length - 1; i++) {
    if (endsAsking(own[i]) && own.length - 1 - i <= 2 && AWAITS_ANSWER.test(own.slice(i + 1).join(' '))) return true;
  }
  if (paras.length < 2 || own.length > 2 || !AWAITS_ANSWER.test(own.join(' '))) return false;
  const before = plainSentences(paras.at(-2));
  return before.length > 0 && endsAsking(before.at(-1));
}

// True when the run ended waiting on the user: wrong stop reason, a trailing question,
// an approval request in the last paragraph, a list under a question, or a question followed by a closing sentence. Null when there is no final message to judge.
function detectAskedUser({ finalText, stopReason, runFinishedStatus }) {
  if (runFinishedStatus == null) return null;
  if (stopReason && stopReason !== 'end_turn') return true;
  const paras = paragraphsOf(stripCode(finalText));
  if (!paras.length) return false;
  const list = listParts(paras);
  if (list) return asksIn(list.item) || asksIn(list.lead) || ANNOUNCES_ASK.test(list.lead.trim());
  return asksIn(paras.at(-1)) || questionBeforeClosing(paras);
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
  const countedTurns = new Set();
  const subagentInputs = new Map();
  const v3SubagentIds = new Set();
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
        if (u.sessionUpdate === 'session_info_update') {
          // Engine v3 reports spend once per turn here instead of in `metadata` events.
          const k = u._meta?.kiro;
          if (k?.kind !== 'turn_completion') break;
          const turnKey = k.executionId ?? k.turnId;
          if (turnKey && countedTurns.has(turnKey)) break;
          if (turnKey) countedTurns.add(turnKey);
          if (typeof k.elapsedTime === 'number') lastTurnDurationMs = k.elapsedTime;
          for (const m of k.promptTurnSummaries || []) {
            if (m.unit !== 'credit') {
              if (!out.nonCreditUnits.includes(m.unit)) out.nonCreditUnits.push(m.unit);
              continue;
            }
            out.credits += Number(m.usage) || 0;
            out.meteringEntries++;
          }
          break;
        }
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
          const callId = u.toolCallId ?? `anon-${out.subagentCalls}`;
          subagentInputs.set(callId, u.rawInput && typeof u.rawInput === 'object' ? { ...u.rawInput } : {});
          if (isV3Call(u)) v3SubagentIds.add(callId);
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
  for (const [id, input] of subagentInputs) for (const n of subagentTargets(input, { nameIsAgent: v3SubagentIds.has(id) })) out.delegatedTo[n] = (out.delegatedTo[n] || 0) + 1;
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

module.exports = { toolNameOf, isV3Call, mcpToolNameOf, skillsCallOf, mcpInputOf, subagentTargets, sessionModels, parseStream, aggregateStream, mergeAggregates, summarizeSessionJson, detectAskedUser, extractQuestion, SUBAGENT_TOOL, SKILLS_SERVER, SKILL_TOOLS };
