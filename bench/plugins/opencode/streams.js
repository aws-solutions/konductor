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

module.exports = {
  // The last assistant text of the parent session.
  finalText: (events) => aggregateEvents(events).lastText,
  stopEvent,
};
