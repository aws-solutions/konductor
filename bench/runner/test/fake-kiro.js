// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `kiro-cli` (a node script) in a directory. Its behavior is read
// from fake-kiro.config.json next to it, because the runner passes it no custom env.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const net = require('net');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-kiro.config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('kiro-cli 9.9.9'); process.exit(0); }
if (args.includes('--list-models')) { console.log('[]'); process.exit(0); }
if (args.includes('--help')) { console.log('--agent-engine <ENGINE>\\n[possible values: v2, v1, v3]'); process.exit(0); }
fs.writeFileSync(path.join(cfg.dir, 'started.json'), JSON.stringify({ pid: process.pid, cwd: process.cwd(), home: process.env.HOME, args, envKeys: Object.keys(process.env) }));
if (cfg.sleepSec) { setTimeout(() => {}, cfg.sleepSec * 1000); return; }
const ev = (type, data) => console.log(JSON.stringify({ type, data }));
fs.writeFileSync('out.txt', 'done\\n');
const finish = () => {
  ev('runStarted', { engine: 'v2' });
  ev('metadata', { sessionId: 's1', turnDurationMs: 100, meteringUsage: [{ value: cfg.credits ?? 0.5, unit: 'credit' }] });
  ev('runFinished', { sessionId: 's1', status: 'success', stopReason: 'end_turn', finalText: cfg.finalText ?? 'done', finalTextTruncated: false });
};
if (cfg.breakSessions) { fs.mkdirSync(path.join(process.env.HOME, '.kiro/sessions'), { recursive: true }); fs.writeFileSync(path.join(process.env.HOME, '.kiro/sessions/cli'), 'not a directory'); }
if (cfg.makeSocket) { const s = net.createServer(); s.listen(path.join(process.cwd(), 'sock'), () => { finish(); process.exit(0); }); } else { finish(); }
`;

function makeFakeKiro(binDir, config) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'kiro-cli');
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'fake-kiro.config.json'), JSON.stringify(config));
  return file;
}

module.exports = { makeFakeKiro };
