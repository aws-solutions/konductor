// SPDX-License-Identifier: Apache-2.0
'use strict';

// The tool calls a run made, for the judge bundle: the main session's own, then those of each child session it started.
// Rubric items such as "the agent ran the tests and reports the result" judge work, and without this block a judge saw only
// the final text. A coordinator then lost points for its child's work, which it could only report second-hand. Every arm gets
// the same block under the same rules, so neither inline nor delegating arms gain evidence the other lacks. Child sessions are
// numbered helper sessions and never name the child agent. Skill lookups and hand-off calls are left out, since they name the
// arm's tooling rather than the work. The bundle's redaction (redact.js) runs over this block too.

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
 * The tool calls of one run: [{ label, calls: [{ text }] }], the main session first (when it made any), then each child
 * session in order of its first call. Empty when the stream has none or its format has no timeline reader.
 */
function toolSessions(runDir, result) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return [];
  const timeline = TIMELINES[descriptorOf(runtimeOf(result)).streamFormat];
  if (!timeline) return [];
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  const order = ['root'];
  const byAgent = new Map([['root', []]]);
  for (const e of timeline(events)) {
    if (e.kind !== 'tool' || armTooling(e)) continue;
    if (!byAgent.has(e.agent)) { byAgent.set(e.agent, []); order.push(e.agent); }
    byAgent.get(e.agent).push({ text: entryText(e) });
  }
  let helper = 0;
  return order.filter((a) => byAgent.get(a).length).map((a) => ({
    label: a === 'root' ? 'Main session' : `Helper session ${++helper} (started by the agent)`,
    calls: byAgent.get(a),
  }));
}

/**
 * The bundle block, at most `room` characters. When the calls do not fit, the first and last calls of each session are kept
 * (where it looks around and where it checks its work) and the count of the rest is stated.
 * Returns { text, calls, shown } or null when the run made no tool call.
 */
function toolBlock(sessions, room) {
  const calls = sessions.reduce((n, s) => n + s.calls.length, 0);
  if (!calls) return null;
  const heading = `## Tool calls the agent made (${calls})`;
  const render = (keep) => sessions.map((s) => {
    const k = Math.min(keep, s.calls.length);
    const head = s.calls.slice(0, Math.ceil(k / 2));
    const tail = s.calls.slice(s.calls.length - Math.floor(k / 2));
    const hidden = s.calls.length - head.length - tail.length;
    const lines = [...head.map((c) => c.text), ...(hidden > 0 ? [`- [${hidden} more call(s) not shown]`] : []), ...tail.map((c) => c.text)];
    return { text: `### ${s.label}, ${s.calls.length} tool call(s)\n${lines.join('\n')}`, shown: head.length + tail.length };
  });
  for (let keep = Math.max(...sessions.map((s) => s.calls.length)); keep >= 0; keep--) {
    const parts = render(keep);
    const text = `${heading}\n${parts.map((p) => p.text).join('\n\n')}`;
    if (text.length <= room) return { text, calls, shown: parts.reduce((n, p) => n + p.shown, 0) };
  }
  return { text: `${heading}\n[not shown: bundle limit reached]`, calls, shown: 0 };
}

module.exports = { toolSessions, toolBlock };
