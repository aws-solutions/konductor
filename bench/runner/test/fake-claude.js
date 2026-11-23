// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `claude` (a node script) at <toolsDir>/<version>/claude. It replays a recorded stream-json file and
// records how it was started. Behavior comes from fake-claude.config.json next to it. It never contacts anything.
// <version>/claude is a shell stub that execs the node script next to it, followed by a sparse tail that brings the file to
// the size the harness expects of the real binary (the shell never reads that far).

const fs = require('node:fs');
const path = require('node:path');
const { MIN_BINARY_BYTES } = require('../../plugins/claude-code/harness.js');
const { writeAtomic } = require('../lib/backfill.js');

const SCRIPT = `#!/usr/bin/env node
// the real binary carries the --include-hook-events and --effort flag text; the fake does too so the harness detects them
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-claude.config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(cfg.version || '9.9.9 (fake)'); process.exit(0); }
// The listing probes (plugins/claude-code/listing.js): /context, and -p with --debug-file and no credentials. They are
// answered from the skills in CLAUDE_CONFIG_DIR by the real fill rule (built-ins first, then name order while it fits),
// and never touch started.json or the files of a run.
// A real run also passes --debug-file (D-33), so a probe is told apart by its "-p ok" prompt. In a run the fake writes
// cfg.runDebugLines into that file, as the real claude logs the listing it sent.
const isProbe = args.includes('/context') || (args.includes('--debug-file') && args[args.indexOf('-p') + 1] === 'ok');
if (!isProbe && args.includes('--debug-file') && cfg.runDebugLines) fs.writeFileSync(args[args.indexOf('--debug-file') + 1], cfg.runDebugLines.join('\\n') + '\\n');
if (isProbe) {
  fs.appendFileSync(path.join(cfg.dir, 'probe-env.jsonl'), JSON.stringify({ aws: Object.keys(process.env).filter((k) => k.startsWith('AWS_')).sort(), args }) + '\\n');
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'skills');
  const builtins = [['dataviz', 1440], ['code-review', 840]];
  const read = (d, source) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []).flatMap((name) => {
    let text = ''; try { text = fs.readFileSync(path.join(d, name, 'SKILL.md'), 'utf8'); } catch { return []; }
    if (/^disable-model-invocation:\\s*true/m.test(text)) return [];
    const desc = (/^description:\\s*(.*)$/m.exec(text) || [])[1] || '';
    return [{ name, source, full: ('- ' + name + ': ' + desc + '\\n').length, bare: ('- ' + name + '\\n').length }];
  });
  // Like Claude Code, every .claude/skills above the cwd is read as project skills.
  const project = [];
  for (let d = process.cwd(); ; d = path.dirname(d)) { project.push(...read(path.join(d, '.claude', 'skills'), 'Project')); if (d === path.dirname(d)) break; }
  const skills = [...read(dir, 'User'), ...project].sort((x, y) => (x.name < y.name ? -1 : 1));
  const budget = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET || cfg.listingBudget || 30000);
  const base = builtins.reduce((n, b) => n + b[1], 0);
  const total = base + skills.reduce((n, s) => n + s.full, 0);
  let used = base + skills.reduce((n, s) => n + s.bare, 0);
  for (const s of skills) { s.chars = total <= budget || used + s.full - s.bare <= budget ? s.full : s.bare; if (s.chars === s.full && total > budget) used += s.full - s.bare; }
  if (args.includes('/context')) {
    const tok = (c) => (Math.ceil(c / 3) < 20 ? '< 20' : '~' + Math.ceil(c / 3));
    const rows = [...skills.map((s) => '| ' + s.name + ' | ' + s.source + ' | ' + tok(s.chars) + ' |'), ...builtins.map((b) => '| ' + b[0] + ' | Built-in | ' + tok(b[1]) + ' |')];
    const result = '## Context Usage\\n\\n**Tokens:** 17k / ' + (cfg.contextWindow || '1m') + ' (2%)\\n\\n### Skills\\n\\n| Skill | Source | Tokens |\\n|-------|--------|--------|\\n' + rows.join('\\n') + '\\n';
    console.log(JSON.stringify({ result, num_turns: 0, total_cost_usd: cfg.contextCost || 0 }));
    process.exit(0);
  }
  const lines = ['[DEBUG] Sending ' + (skills.length + builtins.length) + ' skills via attachment (initial)'];
  if (total > budget) lines.push('[WARN] Skill listing over budget: ' + (skills.length + builtins.length) + ' skills, ' + total + ' chars > ' + budget + ' budget');
  if (!cfg.noListingLines) fs.writeFileSync(args[args.indexOf('--debug-file') + 1], lines.join('\\n') + '\\n');
  console.log(JSON.stringify({ is_error: true, total_cost_usd: 0 }));
  process.exit(1);
}
const cfgDir = process.env.CLAUDE_CONFIG_DIR;
const list = (d) => { try { return fs.readdirSync(d).sort(); } catch { return null; } };
// started.json is replaced by a rename, so a test that polls for it never parses a half-written file.
${writeAtomic.toString()}
// Multi-turn runs: each invocation is one turn. started-N.json keeps every turn's record and cfg.turnStreams[N-1] is the stream
// that turn replays (the last one repeats); started.json is the latest, as before.
let turn = 0;
try { turn = fs.readdirSync(cfg.dir).filter((f) => /^started-\\d+\\.json$/.test(f)).length; } catch { /* no probe directory yet */ }
const startedText = JSON.stringify({
  turn: turn + 1, pid: process.pid, cwd: process.cwd(), home: process.env.HOME, configDir: cfgDir, args, env: process.env, envKeys: Object.keys(process.env),
  rules: list(path.join(cfgDir, 'rules')), agents: list(path.join(cfgDir, 'agents')), configFiles: list(cfgDir),
  seen: (cfg.probeFiles || []).filter((f) => fs.existsSync(f)),
  stdinIsTty: require('tty').isatty(0),
  stdin: require('tty').isatty(0) ? null : fs.readFileSync(0, 'utf8'),
});
writeAtomic(path.join(cfg.dir, 'started.json'), startedText);
writeAtomic(path.join(cfg.dir, 'started-' + (turn + 1) + '.json'), startedText);
const streamFile = (cfg.turnStreams || [])[Math.min(turn, (cfg.turnStreams || []).length - 1)] || cfg.streamFile;
const slug = process.cwd().replace(/[^A-Za-z0-9]/g, '-');
const made = [];
for (const base of cfg.tmpBases || [process.env.TMPDIR]) {
  const d = path.join(base, 'claude-' + process.getuid(), slug, 'tasks');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'task.output'), 'x');
  made.push(d);
}
for (const name of cfg.foreign || []) fs.mkdirSync(path.join(cfg.foreignBase, 'claude-' + process.getuid(), name, 'tasks'), { recursive: true });
fs.writeFileSync(path.join(cfg.dir, 'made-' + process.pid + '.json'), JSON.stringify(made));
if (cfg.sleepSec) { setTimeout(() => {}, cfg.sleepSec * 1000); return; }
fs.writeFileSync(path.join(process.cwd(), 'hello.txt'), cfg.helloText || 'hello\\n');
for (const [f, text] of Object.entries((cfg.turnFiles || [])[turn] || {})) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
if (cfg.leak) console.log(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: process.env.AWS_SECRET_ACCESS_KEY + ' ' + process.env.AWS_SESSION_TOKEN }] }, parent_tool_use_id: null }));
const finish = () => { process.stdout.write(fs.readFileSync(streamFile, 'utf8')); process.exit(cfg.exitCode || 0); };
// With otlpLogsFile set and an OTLP logs endpoint in the environment, posts that file's JSON body there first.
const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
if (cfg.otlpLogsFile && endpoint) {
  const req = require('http').request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', finish); });
  req.on('error', finish);
  req.end(fs.readFileSync(cfg.otlpLogsFile));
} else finish();
`;

const stub = () => `#!/bin/sh\nexec '${process.execPath}' "$(dirname "$0")/fake-claude.js" "$@"\n# the real binary carries the --include-hook-events and --effort flag text; the stub does too so the harness detects them\n`;

function makeFakeClaude(toolsDir, config, version = '9.9.9') {
  const dir = path.join(toolsDir, version);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'claude');
  fs.writeFileSync(path.join(dir, 'fake-claude.js'), SCRIPT);
  fs.writeFileSync(file, stub(), { mode: 0o755 });
  fs.truncateSync(file, MIN_BINARY_BYTES + 1);
  fs.writeFileSync(path.join(dir, 'fake-claude.config.json'), JSON.stringify(config));
  return file;
}

module.exports = { makeFakeClaude };
