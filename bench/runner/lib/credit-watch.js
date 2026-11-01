// SPDX-License-Identifier: Apache-2.0
'use strict';

// Sums the credits a running agent has metered so far by reading its event stream as it grows. Used for the per-run
// credit limit; the final figure still comes from the stream parser after the run. Engine v3 reports spend only when a
// turn ends, so on v3 the meter reads nothing until then and a limit cannot trip mid-run.

const fs = require('node:fs');

function makeCreditMeter(file) {
  let offset = 0;
  let pending = '';
  let total = 0;
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
              for (const m of ev.data?.meteringUsage ?? []) if (m.unit === 'credit') total += Number(m.value) || 0;
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
  };
}

module.exports = { makeCreditMeter };
