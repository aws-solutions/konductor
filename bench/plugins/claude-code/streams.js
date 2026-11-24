// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Claude Code stream readers (harness/streams.js, FW-17). The stream is `claude -p --output-format stream-json`.
// Claude Code arms take no --stop-on, so there is no stopEvent. trace.js is required at call time.

const parse = require('./parse.js');

// File-writing tools; shortcut: a file written by a shell command is not seen (load-check.js).
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SKILL_FILE = /(?:^|\/)([^/]+)\/SKILL\.md$/;

/** One event for load-check.js loadOrderOf: the Skill tool, a SKILL.md read, a subagent tool, a file write, a failed result. */
function loadOrderEvent(ev, at, { add, fail, write }) {
  const blocks = Array.isArray(ev?.message?.content) ? ev.message.content : [];
  for (const b of blocks) {
    if (ev.type === 'assistant' && b?.type === 'tool_use') {
      if (b.name === 'Skill') add(b.id, b.input?.skill ?? b.input?.name, 'skill', at);
      else if (b.name === 'Read' && SKILL_FILE.test(String(b.input?.file_path ?? ''))) add(b.id, SKILL_FILE.exec(b.input.file_path)[1], 'skill', at);
      else if (parse.SUBAGENT_TOOLS.has(b.name)) add(b.id, b.input?.subagent_type, 'agent', at);
      else if (WRITE_TOOLS.has(b.name)) write(at);
    } else if (ev.type === 'user' && b?.type === 'tool_result' && b.is_error) fail(b.tool_use_id);
  }
}

const blank = (t) => typeof t !== 'string' || !t.trim();

module.exports = {
  // The last result line's text, else (also when that text is blank) the last assistant text of the main session.
  finalText(events) {
    const a = parse.aggregateEvents(events);
    if (!blank(a.finalText)) return a.finalText;
    return blank(a.lastText) ? a.finalText ?? a.lastText : a.lastText;
  },
  timeline: (events) => require('../../runner/lib/trace.js').claudeTimeline(events),
  // The Skill tool calls, with their text answers (skills.js extractSkills, `skillAnswer: 'text'`).
  skillCalls: parse.skillCalls,
  skillAnswer: 'text',
  loadOrderEvent,
  /** The first capability call of a run: the Skill tool or a subagent tool. { kind: 'skill'|'subagent'|'none', name }. */
  firstDecision(events) {
    for (const ev of events ?? []) {
      for (const b of ev?.type === 'assistant' && Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (b?.type !== 'tool_use') continue;
        if (b.name === 'Skill') return { kind: 'skill', name: b.input?.skill ?? b.input?.name ?? null };
        if (parse.SUBAGENT_TOOLS.has(b.name)) return { kind: 'subagent', name: b.input?.subagent_type ?? null };
      }
    }
    return { kind: 'none', name: null };
  },
};
