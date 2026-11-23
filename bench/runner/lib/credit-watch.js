// SPDX-License-Identifier: Apache-2.0
'use strict';

// Sums the credits a running agent has metered so far by reading its event stream as it grows. Used for the per-run
// credit limit; the final figure still comes from the stream parser after the run.
//
// `poll()` is every credit seen, and `live()` is the part that arrived while the agent could still be stopped. Engine v2
// meters after each model call, so its credits are live. Engine v3 reports a prompt turn's whole spend in one
// turn_completion summary written when the turn ends, a few lines before the process exits, so v3 credits are counted
// by `poll()` but not by `live()`. Instead, on a stream with no v2 metering, `live()` is an estimate: ESTIMATE_RATE
// times the sum of the context-window percentages the agent reports in `context_usage` events (DEBT D-67). The
// estimate only decides a kill; it is never charged or reported as credits.

const fs = require('node:fs');

// Credits per percentage point of context window per context_usage event. Fitted on 225 v3 streams (pilot waves, LITE
// 2026-11-21, probe runs): turn credits over the sum of reported percentages ran 0.020 to 0.126, median 0.058. The rate
// sits above every one of them, so the estimate runs high and a run is stopped early rather than late.
// shortcut: one fixed rate for every model; refit when a model's streams land above it.
const ESTIMATE_RATE = 0.13;

function makeCreditMeter(file) {
  let offset = 0;
  let pending = '';
  let total = 0;
  let liveTotal = 0;
  let contextPct = 0;
  let sawV2 = false;
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
            if (!v2 && !line.includes('turn_completion') && !line.includes('context_usage')) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (v2 && ev?.type === 'metadata') {
              sawV2 = true;
              for (const m of ev.data?.meteringUsage ?? []) {
                if (m.unit === 'credit') { total += Number(m.value) || 0; liveTotal += Number(m.value) || 0; }
              }
            } else if (ev?.type === 'sessionUpdate' && ev.data?.update?._meta?.kiro?.kind === 'context_usage') {
              const k = ev.data.update._meta.kiro;
              contextPct += Number(k.usagePercentage ?? k.contextUsage?.usagePercentage) || 0;
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
    /** poll(), then the credits metered mid-run (engine v2), or the estimate from context_usage when no v2 metering came. */
    live() {
      this.poll();
      return sawV2 ? liveTotal : Math.max(liveTotal, contextPct * ESTIMATE_RATE);
    },
    /** True when live() is the context_usage estimate (no v2 metering seen and some context reported). */
    estimated() {
      this.poll();
      return !sawV2 && contextPct > 0;
    },
  };
}

module.exports = { makeCreditMeter, ESTIMATE_RATE };
