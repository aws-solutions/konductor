// SPDX-License-Identifier: Apache-2.0
'use strict';

// Sums the credits a running agent has metered so far by reading its event stream as it grows. Used for the per-run
// credit limit; the final figure still comes from the stream parser after the run.
//
// `poll()` is every credit seen, and `live()` is the part that arrived while the agent could still be stopped. Engine v2
// meters after each model call, so its credits are live. Engine v3 reports a prompt turn's whole spend in one
// turn_completion summary written when the turn ends, a few lines before the process exits, so v3 credits are counted
// by `poll()` but never by `live()`: there is no earlier signal in the stream, and a kill at that point would only
// risk the run's last events.

const fs = require('node:fs');

function makeCreditMeter(file) {
  let offset = 0;
  let pending = '';
  let total = 0;
  let liveTotal = 0;
  const countedTurns = new Set();
  return {
    /** Reads what was appended since the last call and returns the credits metered so far. */
    poll() {
      let fd;
      try { fd = fs.openSync(file, 'r'); } catch { return total; }
      try {
        const size = fs.fstatSync(fd).size;
        if (size > offset) {
          const buf = Buffer.alloc(size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          offset = size;
          const lines = (pending + buf.toString('utf8')).split('\n');
          pending = lines.pop();
          for (const line of lines) {
            const v2 = line.includes('meteringUsage');
            if (!v2 && !line.includes('turn_completion')) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (v2 && ev?.type === 'metadata') {
              for (const m of ev.data?.meteringUsage ?? []) {
                if (m.unit === 'credit') { total += Number(m.value) || 0; liveTotal += Number(m.value) || 0; }
              }
            } else if (ev?.type === 'sessionUpdate' && ev.data?.update?._meta?.kiro?.kind === 'turn_completion') {
              const k = ev.data.update._meta.kiro;
              const turnKey = k.executionId ?? k.turnId;
              if (turnKey && countedTurns.has(turnKey)) continue;
              if (turnKey) countedTurns.add(turnKey);
              for (const m of k.promptTurnSummaries ?? []) if (m.unit === 'credit') total += Number(m.usage) || 0;
            }
          }
        }
      } finally { fs.closeSync(fd); }
      return total;
    },
    /** poll(), then the credits that were metered mid-run (engine v2 only). */
    live() {
      this.poll();
      return liveTotal;
    },
  };
}

module.exports = { makeCreditMeter };
