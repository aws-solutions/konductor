// SPDX-License-Identifier: Apache-2.0
'use strict';

// The question channel of a scripted-user task (`questions: scripted`). Kiro CLI's --no-interactive mode tells the
// agent that no user can answer, so without a stated channel no arm asks and every arm scores the same floor. The
// loader appends ASK_CHANNEL to the task prompt, the same text for every arm and harness, and the conversation reads
// the asks with one extractor for every harness (questionsOf). The text names no method, skill or agent, so it favours no arm.
//
// Independent review 2026-11-20: whether an arm was answered used to rest on the QUESTION: marker or on each harness's own
// stream parser (`askedUser`: a stop reason on Kiro CLI, an ask tool on Claude Code, nothing on Strands). Now the final text
// alone decides, the same way for every harness, and a QUESTION: line counts exactly as the same question in plain prose:
// the marker is stripped before the text is read and is kept only as a diagnostic count.

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

// A QUESTION: line as the same line in plain prose: the marker removed, a question mark added when it has none.
function plainProse(text) {
  return String(text ?? '').replace(MARKER_RE, (_m, q) => {
    const t = q.trim();
    return /\?\s*(?:\*\*|__)?$/.test(t) ? t : `${t}?`;
  });
}

/**
 * The asks of one turn's final text, read the same way for every harness: { asked, text, count, markerLines }.
 * `text` is the part that asks (stream.js extractQuestion), `count` its question marks (at least 1 when asked).
 * `markerLines` is diagnostics only: it never changes `asked`, `text` or `count`.
 */
function questionsOf(finalText) {
  const { detectAskedUser, extractQuestion } = require('./stream.js');
  const prose = plainProse(finalText);
  const markerLines = markedQuestions(finalText).length;
  const asked = detectAskedUser({ finalText: prose, stopReason: null, runFinishedStatus: 'success' }) === true;
  const text = asked ? extractQuestion({ finalText: prose }) : '';
  return { asked, text, count: asked ? Math.max(1, (text.match(/\?/g) || []).length) : 0, markerLines };
}

module.exports = { ASK_CHANNEL, withAskChannel, markedQuestions, questionsOf, plainProse };
