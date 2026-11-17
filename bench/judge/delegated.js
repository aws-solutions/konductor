// SPDX-License-Identifier: Apache-2.0
'use strict';

// The tool calls a run's child sessions made, for the judge bundle. A coordinator that hands the work to a child reports it
// in its final text, often as "the child ran the tests", so a rubric item such as "the agent ran the tests and reports the
// result" lost points for work that was done. This block shows that work. It is attributed to a numbered helper session and
// never names the child agent: the bundle hides arm-revealing names (see redact.js), and the redaction runs over this block
// too. Skill lookups and nested hand-offs are left out, since they name the arm's tooling rather than the work. The main
// session's own tool calls are not shown, as before.

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
// The scratch workspace of a run is r-XXXX/work; paths inside it print relative, so no run directory reaches a judge.
const shortPath = (s) => String(s ?? '').replace(/[^\s"'`]*\/r-[A-Za-z0-9]+\/work\/?/g, './');
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

function entryText(e) {
  const status = e.failed ? 'failed' : e.status === 'completed' ? 'completed' : e.status ?? 'no result recorded';
  const res = e.result == null ? '' : resultOf(e.result);
  return `- ${e.tool}: ${inputOf(e.input)} (${status})${res ? `\n${res.split('\n').map((l) => `    ${l}`).join('\n')}` : ''}`;
}

/** The child sessions' tool calls of one run: [{ session, calls: [{ text }] }] in order of first call. Empty when none. */
function delegatedSessions(runDir, result) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return [];
  const timeline = TIMELINES[descriptorOf(runtimeOf(result)).streamFormat];
  if (!timeline) return [];
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  const order = [];
  const byAgent = new Map();
  for (const e of timeline(events)) {
    if (e.kind !== 'tool' || e.agent === 'root') continue;
    if (!byAgent.has(e.agent)) { byAgent.set(e.agent, []); order.push(e.agent); }
    byAgent.get(e.agent).push({ text: entryText(e) });
  }
  return order.map((agent, i) => ({ session: i + 1, calls: byAgent.get(agent) }));
}

/**
 * The bundle block for the child sessions, at most `room` characters. When the calls do not fit, the first and last calls of
 * each session are kept (where a child looks around and where it checks its work) and the count of the rest is stated.
 * Returns { text, calls, shown } or null when the run has no child tool calls.
 */
function delegatedBlock(sessions, room) {
  const calls = sessions.reduce((n, s) => n + s.calls.length, 0);
  if (!calls) return null;
  const heading = `## Tool calls made by helper sessions the agent started (${calls})`;
  const render = (keep) => sessions.map((s) => {
    const k = Math.min(keep, s.calls.length);
    const head = s.calls.slice(0, Math.ceil(k / 2));
    const tail = s.calls.slice(s.calls.length - Math.floor(k / 2));
    const hidden = s.calls.length - head.length - tail.length;
    const lines = [...head.map((c) => c.text), ...(hidden > 0 ? [`- [${hidden} more call(s) not shown]`] : []), ...tail.map((c) => c.text)];
    return { text: `### Helper session ${s.session} (${s.calls.length} tool call(s))\n${lines.join('\n')}`, shown: head.length + tail.length };
  });
  const max = Math.max(...sessions.map((s) => s.calls.length));
  for (let keep = max; keep >= 0; keep--) {
    const parts = render(keep);
    const text = `${heading}\n${parts.map((p) => p.text).join('\n\n')}`;
    if (text.length <= room || keep === 0) {
      const shown = parts.reduce((n, p) => n + p.shown, 0);
      if (text.length <= room) return { text, calls, shown };
      return { text: `${heading}\n[not shown: bundle limit reached]`, calls, shown: 0 };
    }
  }
  return null;
}

module.exports = { delegatedSessions, delegatedBlock };
