// SPDX-License-Identifier: Apache-2.0
'use strict';

// The kiro-cli stream readers (harness/streams.js, FW-17). The stream is kiro-cli's ACP updates (`sessionUpdate`
// events and a closing `runFinished`). trace.js is required at call time: it loads modules that load the harnesses.

const { aggregateStream, SUBAGENT_TOOL, toolNameOf, skillsCallOf, mcpInputOf, isV3Call, skillResourceCallOf, skillActivationOf, skillFileReadOf, subagentTargets } = require('../../runner/lib/stream.js');

const hasInput = (input) => input && typeof input === 'object' && Object.keys(input).length > 0;

/**
 * A capability call's kind for the stop watch: a subagent call is 'delegate', a skills-server get_skill 'load', any
 * other skills-server call 'search'. A skills call the v3 engine refused before the tool was loaded (deferred) is none.
 */
function capabilityOf(u) {
  if (toolNameOf(u) === SUBAGENT_TOOL) return { capability: 'delegate', detail: SUBAGENT_TOOL };
  const sc = skillsCallOf(u);
  if (!sc || sc.deferred) return { capability: null, detail: null };
  return { capability: sc.tool === 'get_skill' ? 'load' : 'search', detail: sc.tool };
}

/** One kiro-cli event as a stop-watch event (stop-watch.js): end, call, update, or null. */
function stopEvent(ev) {
  if (ev?.type === 'runFinished') return { kind: 'end' };
  const u = ev?.type === 'sessionUpdate' ? ev.data?.update : null;
  if (!u) return null;
  if (u.sessionUpdate === 'tool_call_update') {
    return { kind: 'update', id: u.toolCallId, input: hasInput(u.rawInput) ? mcpInputOf(u.rawInput) : null, done: u.rawOutput !== undefined || u.status === 'completed' || u.status === 'failed' };
  }
  if (u.sessionUpdate !== 'tool_call') return null;
  const { capability, detail } = capabilityOf(u);
  return {
    kind: 'call', id: u.toolCallId, capability, detail,
    input: u.rawInput && typeof u.rawInput === 'object' ? { ...mcpInputOf(u.rawInput) } : {},
    // A repeated tool_call carries more of the input; the watch merges it into the capability call.
    moreInput: hasInput(u.rawInput) ? mcpInputOf(u.rawInput) : null,
    done: capability === 'delegate',
  };
}

// File-writing tools (load-check.js).
const WRITE_TOOLS = new Set(['fs_write', 'str_replace', 'fs_append', 'write']);

/**
 * One event for load-check.js loadOrderOf: a skill file read, a v3 load_resource or SOP activation, a get_skill, a
 * subagent call, a file write, a failed update. v2 may name a get_skill target only in an update.
 */
function loadOrderEvent(ev, at, { add, fail, write, calls }) {
  const u = ev?.type === 'sessionUpdate' ? ev.data?.update : null;
  if (!u) return;
  if (u.sessionUpdate === 'tool_call_update') {
    if (u.status === 'failed') fail(u.toolCallId);
    const pending = (calls.get(u.toolCallId) ?? []).find((c) => c.name === '(get_skill)');
    const n = mcpInputOf(u.rawInput ?? {})?.name;
    if (pending && typeof n === 'string' && n.trim()) pending.name = n.trim();
    return;
  }
  if (u.sessionUpdate !== 'tool_call' || (u.toolCallId && calls.has(u.toolCallId))) return;
  const tool = toolNameOf(u);
  const named = skillFileReadOf(u) ?? skillResourceCallOf(u) ?? skillActivationOf(u);
  if (named) { add(u.toolCallId, named.name, /sop-md$/.test(named.via ?? '') ? 'sop' : 'skill', at); return; }
  const sc = skillsCallOf(u);
  if (sc?.tool === 'get_skill') { const n = mcpInputOf(u.rawInput ?? {})?.name; add(u.toolCallId, typeof n === 'string' && n.trim() ? n.trim() : '(get_skill)', 'skill', at); return; }
  if (tool === SUBAGENT_TOOL) { for (const t of subagentTargets(u.rawInput ?? {}, { nameIsAgent: isV3Call(u) })) if (t !== '(unnamed)') add(u.toolCallId, t, 'agent', at); return; }
  if (WRITE_TOOLS.has(tool)) write(at);
}

// shortcut: the skills-server readers stay in runner/lib/skills.js (kiroCalls, kiroFirstDecision) because they share
// its helpers with the answer parsing; move them here with those helpers when skills.js is split.
const skills = () => require('../../runner/lib/skills.js');

module.exports = {
  finalText: (events) => aggregateStream(events).finalText,
  timeline: (events) => require('../../runner/lib/trace.js').kiroTimeline(events),
  stopEvent,
  // Skills-server calls with their raw answers (skills.js extractSkills, `skillAnswer: 'server'`).
  skillCalls: (events) => skills().kiroCalls(events),
  skillAnswer: 'server',
  loadOrderEvent,
  firstDecision: (events) => skills().kiroFirstDecision(events),
};
