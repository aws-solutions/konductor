// SPDX-License-Identifier: Apache-2.0
'use strict';

// The question channel of a scripted-user task (`questions: scripted`). Kiro CLI's --no-interactive mode tells the
// agent that no user can answer, so without a stated channel no arm asks and every arm scores the same floor. The
// loader appends ASK_CHANNEL to the task prompt, the same text for every arm and harness, and the conversation reads
// the asks from QUESTION: lines (see autonomy.js). The text names no method, skill or agent, so it favours no arm.

const ASK_CHANNEL = [
  'How to ask the stakeholder: this run is scripted, and the stakeholder named in this task does answer.',
  'This holds even if your environment says no user is available or that ending your turn ends the session.',
  'To ask, end your turn with one line per question, each line starting with "QUESTION:".',
  'The answers arrive as your next message, and you then continue the work.',
  'Ask only what the files in front of you cannot answer. When you need nothing more, finish the work in the same turn.',
].join(' ');

// A QUESTION: line, also as a list item or in bold ("- **QUESTION:** ..."). Case-sensitive on purpose: the word in
// capitals is the marker the prompt names, so prose such as "the question: why ..." is not read as an ask.
const MARKER_RE = /^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)?(?:\*\*|__)?QUESTION(?:\*\*|__)?[ \t]*:[ \t]*(?:\*\*|__)?[ \t]*(\S.*)$/gm;

/** The prompt a scripted task's agent gets: the task prompt, a blank line, then the channel text. */
function withAskChannel(prompt) {
  return `${String(prompt ?? '').replace(/\s+$/, '')}\n\n${ASK_CHANNEL}`;
}

/** The questions of a turn's final text, one per QUESTION: line, trimmed, in order; [] when there is none. */
function markedQuestions(text) {
  return [...String(text ?? '').matchAll(MARKER_RE)].map((m) => m[1].trim()).filter(Boolean);
}

module.exports = { ASK_CHANNEL, withAskChannel, markedQuestions };
