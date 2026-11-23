// SPDX-License-Identifier: Apache-2.0
'use strict';

// The opencode stream readers (harness/streams.js, FW-17). The stream is `opencode run --format json` events. opencode
// has no plant arms and no trace, so it has no plantCalls or timeline.

const { aggregateEvents } = require('./parse.js');

// opencode's capability tools: `skill` loads a skill, `task` hands work to a subagent.
const CAPABILITY = Object.freeze({ skill: 'load', task: 'delegate' });

/** One opencode event as a stop-watch event (stop-watch.js): end, call, or null. A tool_use event is complete. */
function stopEvent(ev) {
  if (ev?.type === 'step_finish' && ev.part?.reason && ev.part.reason !== 'tool-calls') return { kind: 'end' };
  if (ev?.type !== 'tool_use') return null;
  const p = ev.part ?? {};
  return { kind: 'call', id: p.callID, capability: CAPABILITY[p.tool] ?? null, detail: p.tool, input: p.state?.input ?? {}, moreInput: null, done: true };
}

// opencode loads a skill through its `skill` tool; the stream emits one tool_use per finished call. Each call is
// { tool: 'skill', input, text, status } (skills.js extractSkills reads text answers, `skillAnswer: 'text'`).
function skillCalls(events) {
  const seen = new Set();
  const calls = [];
  for (const ev of events ?? []) {
    const p = ev?.type === 'tool_use' ? ev.part : null;
    if (p?.tool !== 'skill') continue;
    if (p.callID) { if (seen.has(p.callID)) continue; seen.add(p.callID); }
    const st = p.state ?? {};
    const out = typeof st.output === 'string' ? st.output : null;
    calls.push({ tool: 'skill', input: st.input ?? {}, text: out, status: st.status ?? null });
  }
  return calls;
}

/** The first capability call of a run: the skill or task tool. { kind: 'skill'|'subagent'|'none', name }. */
function firstDecision(events) {
  for (const ev of events ?? []) {
    const p = ev?.type === 'tool_use' ? ev.part : null;
    if (p?.tool === 'skill') return { kind: 'skill', name: p.state?.input?.name ?? p.state?.input?.skill_name ?? null };
    if (p?.tool === 'task') return { kind: 'subagent', name: p.state?.input?.subagent_type ?? null };
  }
  return { kind: 'none', name: null };
}

module.exports = {
  // The last assistant text of the parent session.
  finalText: (events) => aggregateEvents(events).lastText,
  stopEvent,
  skillCalls,
  skillAnswer: 'text',
  firstDecision,
};
