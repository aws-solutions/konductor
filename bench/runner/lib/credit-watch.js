// SPDX-License-Identifier: Apache-2.0
'use strict';

// Sums the credits a running agent has metered so far by reading its event stream as it grows. Used for the per-run
// credit limit; the final figure still comes from the stream parser after the run.
//
// `poll()` is every credit seen, and `live()` is the part that arrived while the agent could still be stopped. Engine v2
// meters after each model call, so its credits are live. Engine v3 reports a prompt turn's whole spend in one
// turn_completion summary written when the turn ends, a few lines before the process exits, so v3 credits are counted
// by `poll()` but not by `live()`. Instead, on a stream with no v2 metering, `live()` is the session's own creditSplit
// (makeSplitReader, measured after each model call), and only when the session has written none, an estimate made from
// the sum of the context-window percentages in `context_usage` events (estimateCredits, DEBT D-67). That figure decides
// a kill; the ledger then charges the killed run at least the limit (orchestrate.js makeLedger).

const fs = require('node:fs');
const path = require('node:path');

// The estimate's coefficients, fitted on saved v3 turns: profiles/v3-credit-estimate.json holds the samples, the method
// and the date. Real spend is bounded by slopeCap x pct on short turns and by intercept + slope x pct on long ones,
// where most input is cached; the estimate is margin x the smaller of the two, so it runs high but by about 1.1x to
// 3x on long turns, not the 4x of the old single rate 0.13.
// shortcut: fitted on claude-sonnet-5.5 turns only; refit when another model's turns land above it.
const ESTIMATE = require('../../profiles/v3-credit-estimate.json').estimate;

/** Estimated credits of a v3 turn whose context_usage percentages sum to `pct`. */
function estimateCredits(pct) {
  if (!(pct > 0)) return 0;
  const { slopeCap, intercept, slope, margin } = ESTIMATE;
  return margin * Math.min(slopeCap * pct, intercept + slope * pct);
}

// Engine v3 writes the session's cumulative credits after every model call (its own and its sub-agents') as a
// `creditSplit` line ({ main, delegated, auxiliary }) in <sessionsDir>/<workspace hash>/sess_<id>/messages.jsonl. The last
// line of a finished session equals its turn_completion credits (513 saved STANDARD v2 and cx runs: ratio 1.000 to 1.008,
// the auxiliary part), so it is a measured mid-turn figure, one model call behind (DEBT D-297).
const SESSION_DIR = /^sess_[0-9A-Za-z-]+$/;
const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

/**
 * Reads the creditSplit lines of every v3 session under `sessionsDir` as they grow. `read()` returns the sum over sessions
 * of the highest split seen in each (a lower line never lowers it), or null while no split was seen. The agent owns these
 * folders, so links are not followed.
 */
// `flat`: `sessionsDir` holds the sess_<id> folders itself, as a finished run's copy in <run>/session does.
// `maxStep()` is the largest rise between two lines of one session: about one model call, the most a kill can leave unwritten.
function makeSplitReader(sessionsDir, { flat = false } = {}) {
  const files = new Map(); // path -> { offset, pending, best }
  let maxStep = 0;
  const scan = () => {
    if (!sessionsDir || !isDir(sessionsDir)) return;
    for (const ws of flat ? ['.'] : listDir(sessionsDir)) {
      const wsDir = path.join(sessionsDir, ws);
      if (ws === 'cli' || !isDir(wsDir)) continue;
      for (const name of listDir(wsDir)) {
        const f = path.join(wsDir, name, 'messages.jsonl');
        if (SESSION_DIR.test(name) && !files.has(f) && isDir(path.join(wsDir, name)) && isFile(f)) files.set(f, { offset: 0, pending: '', best: null });
      }
    }
  };
  const readFile = (f, st) => {
    let fd;
    try { fd = fs.openSync(f, 'r'); } catch { return; }
    try {
      const size = fs.fstatSync(fd).size;
      if (size < st.offset) { st.offset = 0; st.pending = ''; }
      if (size <= st.offset) return;
      const buf = Buffer.alloc(size - st.offset);
      fs.readSync(fd, buf, 0, buf.length, st.offset);
      st.offset = size;
      const lines = (st.pending + buf.toString('utf8')).split('\n');
      st.pending = lines.pop();
      for (const line of lines) {
        if (!line.includes('creditSplit')) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        const p = ev?.payload;
        if (p?.type !== 'session_metadata' || p.key !== 'creditSplit' || !p.value || typeof p.value !== 'object') continue;
        const sum = ['main', 'delegated', 'auxiliary'].reduce((s, k) => s + (Number(p.value[k]) || 0), 0);
        if (!Number.isFinite(sum)) continue;
        if (st.best != null) maxStep = Math.max(maxStep, sum - st.best);
        st.best = Math.max(st.best ?? 0, sum);
      }
    } finally { fs.closeSync(fd); }
  };
  return {
    read() {
      scan();
      let total = null;
      for (const [f, st] of files) {
        if (isFile(f)) readFile(f, st);
        if (st.best != null) total = (total ?? 0) + st.best;
      }
      return total;
    },
    maxStep: () => maxStep,
  };
}

/**
 * `file` is the agent's live stream. `sessionsDir` (optional) is the run HOME's .kiro/sessions: when its v3 sessions write
 * creditSplit lines, live() is the spend measured since the meter was made and the context_usage estimate is not used.
 */
function makeCreditMeter(file, { sessionsDir = null } = {}) {
  let offset = 0;
  let pending = '';
  let total = 0;
  let liveTotal = 0;
  let contextPct = 0;
  let sawV2 = false;
  const countedTurns = new Set();
  const splits = makeSplitReader(sessionsDir);
  // A resumed session already holds the earlier turns' spend; only what grows from here belongs to this meter.
  const baseline = splits.read() ?? 0;
  let split = null;
  const readSplit = () => { const v = splits.read(); if (v != null) split = Math.max(0, v - baseline); return split; };
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
    /**
     * poll(), then the credits metered mid-run: engine v2 metering, else the v3 session's creditSplit, else the estimate
     * from context_usage.
     */
    live() {
      this.poll();
      if (sawV2) return liveTotal;
      if (readSplit() != null) return Math.max(liveTotal, split);
      return Math.max(liveTotal, estimateCredits(contextPct));
    },
    /** True when live() is the v3 session's measured creditSplit (no v2 metering seen). */
    measured() {
      this.poll();
      return !sawV2 && readSplit() != null;
    },
    /** True when live() is the context_usage estimate (no v2 metering, no creditSplit, and some context reported). */
    estimated() {
      this.poll();
      return !sawV2 && readSplit() == null && contextPct > 0;
    },
  };
}

module.exports = { makeCreditMeter, makeSplitReader, estimateCredits, ESTIMATE };
