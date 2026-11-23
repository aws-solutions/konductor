// SPDX-License-Identifier: Apache-2.0
'use strict';

// Evidence that an introspection run sent nothing to a telemetry collector on the host. While the agent runs, the
// TCP sockets connected to the watched loopback ports are sampled with `ss`; a socket whose process has the run's
// HOME in its environment, or a working directory under the run root, is attributed to the run. Linux only: on other
// platforms the watch reports itself unavailable instead of claiming a clean result.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// 20774: the host collector this machine runs. 4317 and 4318: the OTLP default ports, where an exporter left on
// its defaults would connect.
const DEFAULT_PORTS = [20774, 4317, 4318];

/** Parses `ss -Htnp` output into [{ local, peer, peerPort, pids: [{ comm, pid }] }]. */
function parseSs(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5) continue;
    const peer = f[4];
    const port = Number(/:(\d+)$/.exec(peer)?.[1]);
    if (!Number.isInteger(port)) continue;
    const pids = [...line.matchAll(/\("([^"]*)",pid=(\d+)/g)].map((m) => ({ comm: m[1], pid: Number(m[2]) }));
    out.push({ state: f[0], local: f[3], peer, peerPort: port, pids });
  }
  return out;
}

/** The environment entries of process `pid` from /proc, or null when it cannot be read. */
function readEnviron(pid) {
  try { return fs.readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0'); } catch { return null; }
}

/** The working directory of process `pid` from /proc, or null when it cannot be read. */
function readCwd(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; }
}

/** True when the process belongs to the run: its HOME is the run's HOME or its cwd is under the run root. */
function belongsToRun(pid, { home, runRoot, environOf = readEnviron, cwdOf = readCwd }) {
  const env = environOf(pid);
  if (env && env.includes(`HOME=${home}`)) return true;
  const cwd = cwdOf(pid);
  return Boolean(cwd && runRoot && (cwd === runRoot || cwd.startsWith(`${runRoot}/`)));
}

/** Starts sampling `ss` for connections to the collector `ports` every `intervalMs`; `stop()` returns what it saw, by run and other. */
function startWatch({ home, runRoot, ports = DEFAULT_PORTS, intervalMs = 250, platform = process.platform, ss = () => spawnSync('ss', ['-Htnp'], { encoding: 'utf8' }), deps = {} }) {
  const record = { available: platform === 'linux', ports, samples: 0, sampleErrors: 0, otherConnections: 0, runConnections: [] };
  if (!record.available) return { stop: () => ({ ...record, note: `the collector watch samples ss and /proc, which ${platform} does not have` }) };
  const seen = new Set();
  const sample = () => {
    const r = ss();
    if (r.status !== 0) { record.sampleErrors++; return; }
    record.samples++;
    for (const s of parseSs(r.stdout)) {
      if (!ports.includes(s.peerPort)) continue;
      const mine = s.pids.filter((p) => belongsToRun(p.pid, { home, runRoot, ...deps }));
      if (!mine.length) { record.otherConnections++; continue; }
      const key = `${s.local}->${s.peer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      record.runConnections.push({ at: new Date().toISOString(), local: s.local, peer: s.peer, processes: mine.map((p) => p.comm) });
    }
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  return {
    stop: () => {
      clearInterval(timer);
      sample();
      return { ...record, clean: record.runConnections.length === 0 && record.samples > 0 };
    },
  };
}

module.exports = { startWatch, parseSs, belongsToRun, DEFAULT_PORTS };
