// SPDX-License-Identifier: Apache-2.0
'use strict';

// Sums the credits a running agent has metered so far by reading its event stream as it grows. Used for the per-run
// credit limit; the final figure still comes from the stream parser after the run.

const fs = require('node:fs');

function makeCreditMeter(file) {
  let offset = 0;
  let pending = '';
  let total = 0;
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
            if (!line.includes('meteringUsage')) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev?.type !== 'metadata') continue;
            for (const m of ev.data?.meteringUsage ?? []) if (m.unit === 'credit') total += Number(m.value) || 0;
          }
        }
      } finally { fs.closeSync(fd); }
      return total;
    },
  };
}

module.exports = { makeCreditMeter };
