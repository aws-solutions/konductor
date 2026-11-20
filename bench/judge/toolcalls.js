// SPDX-License-Identifier: Apache-2.0
'use strict';

// The tool calls a run made, for the judge bundle: one list in stream order, the main session's calls and those of any
// child session it started together. Rubric items such as "the agent ran the tests and reports the result" judge work, and
// without this block a judge saw only the final text. Every arm gets the same block under the same rules. The list carries no
// session labels and no per-session counts, so a judge cannot tell a delegating arm from an inline one by the block's shape
// (independent review 2026-11-20). It is a work log, not a deliverable: an expert: criterion may not quote it (bundle.js
// expertText, views.js). Skill lookups and hand-off calls are left out, since they name the arm's tooling rather than the
// work. The bundle's redaction (redact.js) runs over this block too.

const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../runner/lib/stream.js');
const { runtimeOf, descriptorOf } = require('../runner/lib/harness/runtime.js');
const { kiroTimeline, claudeTimeline } = require('../runner/lib/trace.js');

const TIMELINES = { 'kiro-acp': kiroTimeline, 'claude-stream-json': claudeTimeline };
const INPUT_CHARS = 300;
// Test output puts its summary at the end, so a long result keeps more of its tail than its head.
const RESULT_HEAD = 200;
const RESULT_TAIL = 400;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// The scratch workspace of a run is r-XXXX/work; paths inside it print relative, and other paths under the run's scratch root
// print from <scratch>, so no host directory reaches a judge.
const shortPath = (s) => String(s ?? '').replace(/[^\s"'`]*\/r-[A-Za-z0-9]+\/work\/?/g, './').replace(/[^\s"'`]*\/r-[A-Za-z0-9]+\//g, '<scratch>/');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

function inputOf(input) {
  if (!input || typeof input !== 'object') return '';
  const key = ['command', 'path', 'file_path', 'pattern', 'query', 'url'].find((k) => typeof input[k] === 'string');
  const text = key ? `${key}=${shortPath(input[key])}` : shortPath(JSON.stringify(input));
  return clip(oneLine(text), INPUT_CHARS);
}

function resultOf(result) {
  const text = shortPath(String(result ?? '')).trim();
  if (text.length <= RESULT_HEAD + RESULT_TAIL) return text;
  return `${text.slice(0, RESULT_HEAD)}\n[... ${text.length - RESULT_HEAD - RESULT_TAIL} chars not shown ...]\n${text.slice(-RESULT_TAIL)}`;
}

// A call that reads or lists the arm's own installed tooling (agents, steering, context, skills, memory, settings, anything
// in the run's scratch HOME) shows which arm ran and is no part of the task, so it is left out, as the bundle leaves those
// directories out of the changed files. `.kiro/specs` is a deliverable and stays.
const TOOLING = /\.kiro(?:\/(?!specs(?:[/"'\s]|$))|["'\s]|$)|\.(?:konductor|claude|opencode)(?:[/\s"']|$)|SKILL\.md|skill::|\/r-[A-Za-z0-9]+\/home(?:\/|["'\s]|$)/i;
const TOOLING_TOOLS = new Set(['load_resource']);
const armTooling = (e) => TOOLING_TOOLS.has(e.tool) || TOOLING.test(JSON.stringify(e.input ?? {}));

function entryText(e) {
  const status = e.failed ? 'failed' : e.status === 'completed' ? 'completed' : e.status ?? 'no result recorded';
  const res = e.result == null ? '' : resultOf(e.result);
  return `- ${e.tool}: ${inputOf(e.input)} (${status})${res ? `\n${res.split('\n').map((l) => `    ${l}`).join('\n')}` : ''}`;
}

/**
 * The tool calls of one run: [{ calls: [{ text }] }], one entry holding every call in stream order whichever session made
 * it, or [] when the stream has none or its format has no timeline reader.
 */
function toolSessions(runDir, result) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return [];
  const timeline = TIMELINES[descriptorOf(runtimeOf(result)).streamFormat];
  if (!timeline) return [];
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  const calls = timeline(events).filter((e) => e.kind === 'tool' && !armTooling(e)).map((e) => ({ text: entryText(e) }));
  return calls.length ? [{ calls }] : [];
}

/**
 * The bundle block, at most `room` characters. When the calls do not fit, the first and last calls are kept
 * (where it looks around and where it checks its work) and the count of the rest is stated.
 * Returns { text, calls, shown } or null when the run made no tool call.
 */
function toolBlock(sessions, room) {
  const calls = sessions.reduce((n, s) => n + s.calls.length, 0);
  if (!calls) return null;
  const heading = `## Work log: tool calls the agent made (${calls})\nThis log shows how the work was done. It is not a deliverable: never quote it for an expert: criterion.`;
  const render = (keep) => sessions.map((s) => {
    const k = Math.min(keep, s.calls.length);
    const head = s.calls.slice(0, Math.ceil(k / 2));
    const tail = s.calls.slice(s.calls.length - Math.floor(k / 2));
    const hidden = s.calls.length - head.length - tail.length;
    const lines = [...head.map((c) => c.text), ...(hidden > 0 ? [`- [${hidden} more call(s) not shown]`] : []), ...tail.map((c) => c.text)];
    return { text: lines.join('\n'), shown: head.length + tail.length };
  });
  for (let keep = Math.max(...sessions.map((s) => s.calls.length)); keep >= 0; keep--) {
    const parts = render(keep);
    const text = `${heading}\n${parts.map((p) => p.text).join('\n\n')}`;
    if (text.length <= room) return { text, calls, shown: parts.reduce((n, p) => n + p.shown, 0) };
  }
  return { text: `${heading}\n[not shown: bundle limit reached]`, calls, shown: 0 };
}

module.exports = { toolSessions, toolBlock };
