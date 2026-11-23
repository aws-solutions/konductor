// SPDX-License-Identifier: Apache-2.0
'use strict';

// The kiro-cli stream readers (harness/streams.js, FW-17). The stream is kiro-cli's ACP updates (`sessionUpdate`
// events and a closing `runFinished`). trace.js is required at call time: it loads modules that load the harnesses.

const { aggregateStream, SUBAGENT_TOOL, toolNameOf, skillsCallOf, mcpInputOf } = require('../../runner/lib/stream.js');

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
  firstDecision: (events) => skills().kiroFirstDecision(events),
};
