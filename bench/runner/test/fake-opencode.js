// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `opencode` (a node script) in a directory. It replays a captured event stream and answers
// `db` queries from canned rows. Behavior comes from fake-opencode.config.json next to it.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-opencode.config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(cfg.version || '1.19.5'); process.exit(0); }
if (args[0] === 'debug') { if (cfg.debugFails) { console.error('config invalid'); process.exit(1); } console.log('{}'); process.exit(0); }
if (args[0] === 'db') {
  const sql = args[1];
  const rows = JSON.parse(fs.readFileSync(cfg.rowsFile, 'utf8'));
  if (cfg.dbFails) process.exit(1);
  console.log(JSON.stringify(/from session/.test(sql) ? rows.sessions : /from message/.test(sql) ? rows.messages : rows.tools));
  process.exit(0);
}
const dir = args[args.indexOf('--dir') + 1];
// Multi-turn runs: each invocation is one turn; cfg.streamFiles[i] is the stream of turn i+1.
let turn = 0;
try { turn = fs.readdirSync(cfg.dir).filter((f) => /^started-\\d+\\.json$/.test(f)).length; } catch { /* read-only probe directory */ }
const streamFile = (cfg.streamFiles || [])[turn] || cfg.streamFile;
const credFile = path.join(process.env.HOME, '.aws', 'credentials');
const startedRecord = JSON.stringify({
  turn: turn + 1,
  pid: process.pid, cwd: process.cwd(), dir, home: process.env.HOME, args, envKeys: Object.keys(process.env), env: process.env,
  credentials: fs.existsSync(credFile) ? fs.readFileSync(credFile, 'utf8').split('\\n').filter((l) => l.startsWith('[')) : null,
  configFiles: fs.readdirSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode')).sort(),
  agents: fs.existsSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'agents')) ? fs.readdirSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'agents')).sort() : [],
  rg: fs.existsSync(path.join(process.env.XDG_CACHE_HOME, 'opencode', 'bin', 'rg')),
});
fs.writeFileSync(path.join(cfg.dir, 'started.json'), startedRecord);
fs.writeFileSync(path.join(cfg.dir, 'started-' + (turn + 1) + '.json'), startedRecord);
if (cfg.sleepSec) { setTimeout(() => {}, cfg.sleepSec * 1000); return; }
fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\\n');
if (cfg.leak) console.log(JSON.stringify({ type: 'tool_use', sessionID: 'x', part: { type: 'tool', tool: 'bash', state: { output: fs.readFileSync(credFile, 'utf8') } } }));
if (cfg.throttle) { console.log(JSON.stringify({ type: 'error', sessionID: cfg.sessionID, error: { name: 'APIError', data: { message: 'ThrottlingException: Too many requests' } } })); process.exit(1); }
process.stdout.write(fs.readFileSync(streamFile, 'utf8'));
`;

function makeFakeOpencode(binDir, config) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'opencode');
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'fake-opencode.config.json'), JSON.stringify(config));
  return file;
}

module.exports = { makeFakeOpencode };
