// SPDX-License-Identifier: Apache-2.0
'use strict';

// `--introspect`: a diagnostic mode that records what the agent was sent and what it did, per model request.
// Off by default; with the flag off no code here runs and a run is byte-for-byte the same as before.
//
// Claude Code: OpenTelemetry logs, metrics and traces (prompts, tool details, raw API bodies) go to a loopback OTLP
// receiver the runner starts for the run (otlp-sink.js), and the session transcripts, sub-agent ones included, are
// copied out of the scratch HOME. kiro-cli (engine v3): the engine's request dump, configuration dump and timeline
// markers are switched on. The dumps go to a sibling of the run root (kiroDumpRoot), outside the agent's working
// directory and HOME, so the agent does not come across its own prompt while it works; they are copied out with every
// log file the engine left. Every probe output is written to <run>/introspect (mode 0700), inside the out dir, so the
// harness scrub covers it. Nothing is sent anywhere off the host; collector-watch.js samples the sockets to the host
// collector ports for the evidence.

const fs = require('node:fs');
const path = require('node:path');
const { startSink } = require('./otlp-sink.js');
const { startWatch } = require('./collector-watch.js');
const { copyPlainFile } = require('../safe-copy.js');
const { DESCRIPTORS } = require('../harness/descriptors.js');

// The probe kinds a harness descriptor names in `introspect.probe` (bench/plugins/*/meta.js).
const OTLP = 'otlp';
const DUMP = 'request-dump';
/** The probe kind of harness `id`: OTLP, DUMP, or null for a harness with no probe (or no harness). */
const probeOf = (id) => DESCRIPTORS.find((d) => d.id === id)?.introspect?.probe ?? null;

const DIR = 'introspect';
// Variables a parent shell may carry that would send telemetry somewhere, or turn it on. The agent environment is an
// allowlist, so none is inherited; the probe checks that after merging and records the names it saw in the parent.
const TELEMETRY_NAME = /^(OTEL_|CLAUDE_CODE_[A-Z_]*(TELEMETRY|OTEL)|KIRO_DUMP_|KIRO_TIMELINE|KIRO_CHAT_LOG_FILE|KIRO_LOG_LEVEL)/;
// Set by the harnesses themselves, not by this probe; allowed in the merged environment.
const HARNESS_OWNED = new Set(['DISABLE_TELEMETRY', 'KONDUCTOR_TELEMETRY']);
// Claude Code flushes its exporters at exit; the sink stays up this long after the agent exits for a late batch.
const FLUSH_GRACE_MS = 2000;

/** The env that makes Claude Code export OpenTelemetry logs and metrics (http/json) to the run sink at `url`. */
function claudeEnv(url) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: url,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${url}/v1/logs`,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${url}/v1/metrics`,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${url}/v1/traces`,
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
    OTEL_LOG_USER_PROMPTS: '1',
    OTEL_LOG_TOOL_DETAILS: '1',
    OTEL_LOG_TOOL_CONTENT: '1',
    OTEL_LOG_ASSISTANT_RESPONSES: '1',
    OTEL_LOG_RAW_API_BODIES: '1',
    CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH: '10000000',
    OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT: '10000000',
    OTEL_LOGS_EXPORT_INTERVAL: '1000',
    OTEL_METRIC_EXPORT_INTERVAL: '5000',
    OTEL_TRACES_EXPORT_INTERVAL: '1000',
    OTEL_METRICS_INCLUDE_SESSION_ID: 'true',
  };
}

// Where kiro-cli writes its dumps for a run: next to the run root, like the live stdio dir, never inside it. The run's
// isolation makes it writable (writableDirs) and run-one removes it with the run root.
function kiroDumpRoot(runRoot) {
  return path.join(path.dirname(runRoot), `${path.basename(runRoot)}-introspect`);
}

/** Extra directories the agent process must be able to write for this harness's probe, created mode 0700. */
function probeWritableDirs({ harnessId, runRoot }) {
  if (probeOf(harnessId) !== DUMP) return [];
  return [ensurePrivateDir(kiroDumpRoot(runRoot))];
}

/** The env that makes Kiro CLI dump each request and write its timeline markers into `agentDir`. */
function kiroEnv(agentDir) {
  return {
    KIRO_DUMP_REQUESTS: '1',
    KIRO_DUMP_REQUESTS_DIR: path.join(agentDir, 'requests'),
    KIRO_DUMP_CONFIGURATION: '1',
    KIRO_DUMP_CONFIGURATION_DIR: path.join(agentDir, 'configuration'),
    KIRO_TIMELINE: '1',
    KIRO_LOG_LEVEL: 'debug',
  };
}

/**
 * Merges the probe variables into the agent environment and refuses a telemetry variable the probe did not set, or an
 * OTLP endpoint that is not the run's sink. Returns the merged environment.
 */
function mergeEnv(childEnv, probeEnv, { sinkUrl = null } = {}) {
  const env = { ...childEnv, ...probeEnv };
  const foreign = Object.keys(env).filter((k) => (TELEMETRY_NAME.test(k) || /TELEMETRY/.test(k)) && !(k in probeEnv) && !HARNESS_OWNED.has(k));
  if (foreign.length) throw new Error(`introspect: the agent environment carries telemetry variables the probe did not set: ${foreign.join(', ')}`);
  for (const [k, v] of Object.entries(env)) {
    if (!/^OTEL_EXPORTER_OTLP_.*ENDPOINT$/.test(k)) continue;
    if (!sinkUrl || !String(v).startsWith(sinkUrl)) throw new Error(`introspect: ${k} does not point at the run's loopback sink`);
  }
  return env;
}

/** Whether `p` is `dir` or a path below it. */
const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);

/** Makes `dir` (mode 0700) and returns it. */
function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

/**
 * Copies regular files below root/rel into dest, keeping the relative layout. Links, special files and files over the
 * copy cap are listed, never followed. Returns { copied, skipped }.
 */
function copyTreePlain(root, rel, dest, { filter = () => true, depth = 8 } = {}) {
  const out = { copied: [], skipped: [] };
  const walk = (r, d, level) => {
    let names;
    try { names = fs.readdirSync(path.join(root, r)); } catch { return; }
    for (const name of names.sort()) {
      const childRel = path.join(r, name);
      let st;
      try { st = fs.lstatSync(path.join(root, childRel)); } catch { continue; }
      if (st.isSymbolicLink()) { out.skipped.push({ path: childRel, reason: 'symlink' }); continue; }
      if (st.isDirectory()) { if (level < depth) walk(childRel, path.join(d, name), level + 1); continue; }
      if (!st.isFile()) { out.skipped.push({ path: childRel, reason: 'special file' }); continue; }
      if (!filter(childRel)) continue;
      try {
        ensurePrivateDir(d);
        if (copyPlainFile(root, childRel, path.join(d, name)) !== false) out.copied.push(childRel);
      } catch (e) {
        out.skipped.push({ path: childRel, reason: e.message });
      }
    }
  };
  try {
    if (fs.lstatSync(path.join(root, rel)).isDirectory()) walk(rel, dest, 0);
  } catch { /* absent */ }
  return out;
}

// The `env` block of the installed Claude Code settings is applied to the agent process and could carry an endpoint.
function settingsTelemetry(home) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    return Object.keys(s?.env || {}).filter((k) => TELEMETRY_NAME.test(k) || /TELEMETRY/.test(k));
  } catch { return []; }
}

/** Resolves after `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts the probes of one run. Returns { apply(env), afterExit() }. `apply` merges and checks the agent environment;
 * `afterExit` stops the sink and the watch, copies the agent-written probe files out of the scratch tree and writes
 * <run>/introspect/probe.json. Call `afterExit` once the agent has exited and before the scratch tree is removed.
 */
async function startProbe({ harnessId, outDir, runRoot, home, dumpRoot = null, baseEnv = process.env, deps = {} }) {
  const dir = ensurePrivateDir(path.join(outDir, DIR));
  const record = {
    harness: harnessId, startedAt: new Date().toISOString(),
    parentTelemetryNames: Object.keys(baseEnv).filter((k) => TELEMETRY_NAME.test(k)).sort(),
    probeEnvNames: [], sink: null, collectorWatch: null, copied: {}, notes: [],
  };
  let probeEnv = {};
  let sink = null;
  let agentDir = null;
  const kind = probeOf(harnessId);
  if (kind === OTLP) {
    sink = await (deps.startSink ?? startSink)({ file: path.join(dir, 'otlp.jsonl') });
    probeEnv = claudeEnv(sink.url);
    record.sink = { url: sink.url, bind: '127.0.0.1', protocol: 'http/json', file: `${DIR}/otlp.jsonl` };
  } else if (kind === DUMP) {
    agentDir = ensurePrivateDir(dumpRoot ?? kiroDumpRoot(runRoot));
    probeEnv = kiroEnv(agentDir);
    record.kiroDumpRoot = { outsideRunRoot: !inside(agentDir, runRoot), name: path.basename(agentDir) };
    record.notes.push('kiro-cli: request bodies come from the v3 engine request dump (KIRO_DUMP_REQUESTS); token counts per request are not in it');
  } else {
    record.notes.push(`${harnessId}: no probe is implemented for this runtime; only the stream-based timeline is written`);
  }
  record.probeEnvNames = Object.keys(probeEnv).sort();
  const watch = (deps.startWatch ?? startWatch)({ home, runRoot });
  let done = false;
  return {
    dir,
    record,
    apply(childEnv) { return mergeEnv(childEnv, probeEnv, { sinkUrl: sink?.url ?? null }); },
    async afterExit() {
      if (done) return record;
      done = true;
      if (sink) {
        await sleep(deps.flushGraceMs ?? FLUSH_GRACE_MS);
        record.sink.received = await sink.stop();
      }
      record.collectorWatch = watch.stop();
      if (kind === OTLP) {
        record.copied.claudeProjects = copyTreePlain(home, path.join('.claude', 'projects'), path.join(dir, 'claude-projects'));
        record.settingsTelemetryNames = settingsTelemetry(home);
      }
      if (agentDir) {
        record.copied.kiroDumps = copyTreePlain(agentDir, '.', path.join(dir, 'kiro'));
        // Log files only: a .log file, or a .json/.jsonl/.txt file inside a logs directory. Never the auth database.
        const isLog = (rel) => (/\.log$/.test(rel) || (/(^|\/)(logs?|kiro-log)\//.test(rel) && /\.(jsonl?|txt)$/.test(rel))) && !/(^|\/)(node_modules|\.git)\//.test(rel);
        record.copied.tmpLogs = copyTreePlain(runRoot, 'tmp', path.join(dir, 'tmp-logs'), { filter: (rel) => /\.log$/.test(rel), depth: 6 });
        record.copied.homeLogs = copyTreePlain(home, '.', path.join(dir, 'home-logs'), { filter: (rel) => isLog(rel) && !/^\.kiro\/sessions\//.test(rel), depth: 6 });
      }
      record.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(dir, 'probe.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      return record;
    },
  };
}

/** What run-config.json records about --introspect: the probe settings, never captured content. */
function runConfigRecord(runtime) {
  return {
    enabled: true,
    output: '<run>/introspect (mode 0700): probe.json, timeline.md and the raw probe files',
    claudeCode: probeOf(runtime) === OTLP ? { exporter: 'OTLP http/json to a loopback receiver the runner starts per run (127.0.0.1, OS-picked port)', variables: Object.keys(claudeEnv('http://127.0.0.1:0')).sort() } : undefined,
    kiroCli: probeOf(runtime) === DUMP ? { variables: Object.keys(kiroEnv('/x')).sort(), dumps: '<run root>-introspect, a sibling of the run root outside the agent workspace and HOME, copied to <run>/introspect/kiro' } : undefined,
    collectorWatch: 'ss samples every 250 ms of sockets to 127.0.0.1:20774, :4317 and :4318 from processes of the run',
    comparable: false,
  };
}

module.exports = { OTLP, DUMP, probeOf, startProbe, mergeEnv, claudeEnv, kiroEnv, kiroDumpRoot, probeWritableDirs, copyTreePlain, runConfigRecord, settingsTelemetry, TELEMETRY_NAME, DIR };
