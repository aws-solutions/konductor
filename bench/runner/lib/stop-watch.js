// SPDX-License-Identifier: Apache-2.0
'use strict';

// Decides, while an agent is running, whether to stop it: at the first capability call (a skill load or a delegation),
// at the end of the turn, or after a number of tool calls. It reads the event stream as it grows, like credit-watch.js,
// and never touches the process; the caller kills the process group when poll() returns a decision.

const fs = require('node:fs');
const { SKILLS_SERVER, SUBAGENT_TOOL } = require('./stream.js');

const STOP_ON = ['first-capability', 'first-load', 'end_turn'];
const KIRO_SKILL_TOOLS = new Set(['find_skills', 'get_skill']);

const hasInput = (input) => input && typeof input === 'object' && Object.keys(input).length > 0;

/**
 * `stopOn`: first-capability (the first skills-server call of any kind, the first subagent call, or the end of the turn),
 * first-load (as first-capability but a find_skills call does not count, since it only searches), or end_turn.
 * `maxToolCalls` stops the run after that many distinct tool calls, whatever they are.
 * A capability call is acted on once its input is in the stream and, for a skills-server call, once its answer is too (so a
 * load counts as a load), or after `graceMs`. A subagent call is acted on at once: waiting would run the whole delegation.
 * poll() returns null or a sticky { reason: 'first-capability'|'max-tool-calls'|'end_turn', detail }.
 */
function makeStopWatcher(file, { runtime = 'kiro-cli', stopOn = 'end_turn', maxToolCalls = null, graceMs = 2000, now = Date.now } = {}) {
  if (!STOP_ON.includes(stopOn)) throw new Error(`--stop-on takes ${STOP_ON.slice(0, -1).join(', ')} or ${STOP_ON.at(-1)}`);
  if (maxToolCalls !== null && !(Number.isInteger(maxToolCalls) && maxToolCalls >= 1)) throw new Error('--max-tool-calls must be an integer >= 1');
  const oc = runtime === 'opencode';
  let offset = 0;
  let pending = '';
  let decision = null;
  let ended = false;
  let calls = 0;
  const seen = new Set();
  let capability = null;

  const isCapability = (tool, server) => {
    if (stopOn === 'end_turn') return false;
    if (oc) return tool === 'skill' || tool === 'task';
    if (tool === SUBAGENT_TOOL) return true;
    if (server !== SKILLS_SERVER || !KIRO_SKILL_TOOLS.has(tool)) return false;
    return stopOn === 'first-capability' || tool === 'get_skill';
  };

  function onEvent(ev) {
    if (oc) {
      if (ev?.type === 'step_finish' && ev.part?.reason && ev.part.reason !== 'tool-calls') ended = true;
      if (ev?.type !== 'tool_use') return;
      const p = ev.part ?? {};
      if (p.callID && seen.has(p.callID)) return;
      if (p.callID) seen.add(p.callID);
      calls++;
      if (!capability && isCapability(p.tool)) capability = { id: p.callID, detail: p.tool, input: p.state?.input ?? {}, since: now(), done: true };
      return;
    }
    if (ev?.type === 'runFinished') { ended = true; return; }
    const u = ev?.type === 'sessionUpdate' ? ev.data?.update : null;
    if (!u) return;
    if (u.sessionUpdate === 'tool_call_update') {
      if (capability && u.toolCallId === capability.id) {
        if (hasInput(u.rawInput)) capability.input = { ...capability.input, ...u.rawInput };
        if (u.rawOutput !== undefined || u.status === 'completed' || u.status === 'failed') capability.done = true;
      }
      return;
    }
    if (u.sessionUpdate !== 'tool_call') return;
    if (u.toolCallId && seen.has(u.toolCallId)) {
      if (capability && u.toolCallId === capability.id && hasInput(u.rawInput)) capability.input = { ...capability.input, ...u.rawInput };
      return;
    }
    if (u.toolCallId) seen.add(u.toolCallId);
    calls++;
    const meta = u._meta?.kiro;
    if (!capability && isCapability(meta?.toolName, meta?.mcpServerName)) {
      capability = { id: u.toolCallId, detail: meta.toolName, input: u.rawInput && typeof u.rawInput === 'object' ? { ...u.rawInput } : {}, since: now(), done: meta.toolName === SUBAGENT_TOOL };
    }
  }

  const ready = () => capability && ((hasInput(capability.input) && capability.done) || now() - capability.since >= graceMs);

  function read() {
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return; }
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= offset) return;
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const lines = (pending + buf.toString('utf8')).split('\n');
      pending = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        try { onEvent(JSON.parse(l)); } catch { /* a partial or foreign line */ }
        if (decision) return;
        if (ready()) { decision = { reason: 'first-capability', detail: capability.detail }; return; }
        if (maxToolCalls !== null && calls >= maxToolCalls && !capability) { decision = { reason: 'max-tool-calls', detail: String(maxToolCalls) }; return; }
      }
    } finally { fs.closeSync(fd); }
  }

  return {
    poll() {
      if (decision) return decision;
      read();
      if (decision) return decision;
      if (ready()) decision = { reason: 'first-capability', detail: capability.detail };
      else if (maxToolCalls !== null && calls >= maxToolCalls && !capability) decision = { reason: 'max-tool-calls', detail: String(maxToolCalls) };
      else if (ended && !capability) decision = { reason: 'end_turn', detail: 'runFinished' };
      return decision;
    },
  };
}

module.exports = { makeStopWatcher, STOP_ON };
