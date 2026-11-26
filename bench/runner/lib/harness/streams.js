// SPDX-License-Identifier: Apache-2.0
'use strict';

// The stream readers of a run's harness (FW-17). Each harness module exports `streams`, the readers of its own agent
// stream, so core code that reads a stream asks the harness instead of keeping a table keyed by stream format:
//   finalText(events)          the agent's final answer text, or null
//   timeline(events)           [{kind: 'tool'|..., tool, input, ...}] for trace and the judge's tool block (optional)
//   stopEvent(ev)              one raw stream event as a stop-watch event (optional, see stop-watch.js)
//   skillReachable(kind, target, startup)  whether the arm's startup record lets the agent reach a target skill or SOP
//                              (optional; skills.js targetOutcome falls back to the skills-server filter)
//   skillExtras(events, startup)  result fields of the harness's own (optional; Claude Code's CLAUDE_SKILL_FIELDS)
//   skillsScope                which sessions' skill loads the stream shows (optional; default 'all-sessions')
//   subagentTools              Set of the tool names that start a sub-agent (optional; Claude Code's Agent and Task)
// The plant readers are not here: they feed the safety scorer, so they stay core in plant/stream-match.js (plan section
// 3, SR-8). harness/index.js loads the harness modules, which load much of the runner, so it is required at call time.

const { DESCRIPTORS } = require('./descriptors.js');

const harnesses = () => require('./index.js');

/** The `streams` of the harness of an arm or result (`runtime` or `harness` field; none is the default runtime). */
const streamsOf = (armOrResult) => harnesses().harnessFor(armOrResult)?.streams ?? {};

/** The `streams` of the harness whose descriptor has stream format `format`, or {} when no harness has it. */
function streamsOfFormat(format) {
  const d = DESCRIPTORS.find((x) => x.streamFormat === format);
  return d ? harnesses().HARNESSES[d.id]?.streams ?? {} : {};
}

module.exports = { streamsOf, streamsOfFormat };
