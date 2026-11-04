// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `claude` (a node script) at <toolsDir>/<version>/claude. It replays a recorded stream-json file and
// records how it was started. Behavior comes from fake-claude.config.json next to it. It never contacts anything.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = `#!/usr/bin/env node
// the real binary carries the --include-hook-events flag text; the fake does too so the harness detects it
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-claude.config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(cfg.version || '9.9.9 (fake)'); process.exit(0); }
const cfgDir = process.env.CLAUDE_CONFIG_DIR;
const list = (d) => { try { return fs.readdirSync(d).sort(); } catch { return null; } };
fs.writeFileSync(path.join(cfg.dir, 'started.json'), JSON.stringify({
  pid: process.pid, cwd: process.cwd(), home: process.env.HOME, configDir: cfgDir, args, env: process.env, envKeys: Object.keys(process.env),
  rules: list(path.join(cfgDir, 'rules')), agents: list(path.join(cfgDir, 'agents')), configFiles: list(cfgDir),
  stdinIsTty: require('tty').isatty(0),
}));
const slug = process.cwd().replace(/[^A-Za-z0-9]/g, '-');
const made = [];
for (const base of cfg.tmpBases || [process.env.TMPDIR]) {
  const d = path.join(base, 'claude-' + process.getuid(), slug, 'tasks');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'task.output'), 'x');
  made.push(d);
}
fs.writeFileSync(path.join(cfg.dir, 'made-' + process.pid + '.json'), JSON.stringify(made));
if (cfg.sleepSec) { setTimeout(() => {}, cfg.sleepSec * 1000); return; }
fs.writeFileSync(path.join(process.cwd(), 'hello.txt'), cfg.helloText || 'hello\\n');
if (cfg.leak) console.log(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: process.env.AWS_SECRET_ACCESS_KEY + ' ' + process.env.AWS_SESSION_TOKEN }] }, parent_tool_use_id: null }));
process.stdout.write(fs.readFileSync(cfg.streamFile, 'utf8'));
process.exit(cfg.exitCode || 0);
`;

function makeFakeClaude(toolsDir, config, version = '9.9.9') {
  const dir = path.join(toolsDir, version);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'fake-claude.config.json'), JSON.stringify(config));
  return file;
}

module.exports = { makeFakeClaude };
