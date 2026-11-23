// SPDX-License-Identifier: Apache-2.0
'use strict';

// Decides, while an agent is running, whether to stop it: at the first capability call (a skill load or a delegation),
// at the end of the turn, or after a number of tool calls. It reads the event stream as it grows, like credit-watch.js,
// and never touches the process; the caller kills the process group when poll() returns a decision.

const fs = require('node:fs');
const { DEFAULT_RUNTIME } = require('./harness/runtime.js');

const STOP_ON = ['first-capability', 'first-load', 'end_turn'];

const hasInput = (input) => input && typeof input === 'object' && Object.keys(input).length > 0;

// The capability kinds each stopOn acts on. A harness's stopEvent names the kind of a call (harness/streams.js).
const COUNTS = Object.freeze({ 'first-capability': ['delegate', 'load', 'search'], 'first-load': ['delegate', 'load'], end_turn: [] });

/**
 * `stopOn`: first-capability (the first skills-server call of any kind, the first subagent call, or the end of the turn),
 * first-load (as first-capability but a find_skills call does not count, since it only searches), or end_turn.
 * `maxToolCalls` stops the run after that many distinct tool calls, whatever they are.
 * A capability call is acted on once its input is in the stream and, for a skills-server call, once its answer is too (so a
 * load counts as a load), or after `graceMs`. A subagent call is acted on at once: waiting would run the whole delegation.
 * On engine v3 a skills call made before the tool was loaded is refused, so it is not a capability call; the retry is.
 * The runtime's harness reads its own events (`streams.stopEvent`); a harness without one is read as kiro-cli updates.
 * poll() returns null or a sticky { reason: 'first-capability'|'max-tool-calls'|'end_turn', detail }.
 */
function makeStopWatcher(file, { runtime = DEFAULT_RUNTIME, stopOn = 'end_turn', maxToolCalls = null, graceMs = 2000, now = Date.now } = {}) {
  if (!STOP_ON.includes(stopOn)) throw new Error(`--stop-on takes ${STOP_ON.slice(0, -1).join(', ')} or ${STOP_ON.at(-1)}`);
  if (maxToolCalls !== null && !(Number.isInteger(maxToolCalls) && maxToolCalls >= 1)) throw new Error('--max-tool-calls must be an integer >= 1');
  const { streamsOf } = require('./harness/streams.js');
  const stopEvent = streamsOf({ runtime }).stopEvent ?? streamsOf({ runtime: DEFAULT_RUNTIME }).stopEvent;
  let offset = 0;
  let pending = '';
  let decision = null;
  let ended = false;
  let calls = 0;
  const seen = new Set();
  let capability = null;

  function onEvent(raw) {
    const e = stopEvent(raw);
    if (!e) return;
    if (e.kind === 'end') { ended = true; return; }
    const mine = capability && e.id === capability.id;
    if (e.kind === 'update') {
      if (mine && e.input) capability.input = { ...capability.input, ...e.input };
      if (mine && e.done) capability.done = true;
      return;
    }
    if (e.id && seen.has(e.id)) {
      if (mine && e.moreInput) capability.input = { ...capability.input, ...e.moreInput };
      return;
    }
    if (e.id) seen.add(e.id);
    calls++;
    if (!capability && COUNTS[stopOn].includes(e.capability)) capability = { id: e.id, detail: e.detail, input: e.input, since: now(), done: e.done };
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
