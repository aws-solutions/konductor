// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a stand-in `opencode` for the judge backend (a node script). It answers `--version`, `run` (the prompt arrives on
// stdin, the reply is a JSON event stream) and `db` (one session row per run, kept in the run's own XDG data dir).
// Every `run` is recorded in <dir>/call-N.json (`dir: null` records nothing: a call under real OS isolation cannot write outside its scratch root). Behavior per call comes from fake-opencode-judge.config.json next to the script:
// `mode` for all calls, or `modes[i]` for call i + 1. Modes: good, prose, crash, throttle, auth, sleep, tool, empty, wrongmodel, leak, nodb, twosteps,
// and the read modes below (readall, readhalf, readout, readbash, readglobout), which end with the good reply.
// `compaction: {messages, parts}` is what the compaction query of `db` returns; `dbFails` makes every `db` call fail.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-opencode-judge.config.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(cfg.version || '1.19.5'); process.exit(0); }
const dbFile = () => path.join(process.env.XDG_DATA_HOME || '/nonexistent', 'opencode', 'fake-db.json');
if (args[0] === 'db') {
  if (cfg.dbFails) process.exit(1);
  let rows;
  try { rows = JSON.parse(fs.readFileSync(dbFile(), 'utf8')); } catch { process.exit(1); }
  if (/compaction/.test(args[1])) console.log(JSON.stringify([rows.compaction || { messages: 0, parts: 0 }]));
  else console.log(JSON.stringify(/from session/.test(args[1]) ? rows.sessions : []));
  process.exit(0);
}
if (args[0] !== 'run') { console.error('unexpected command ' + args[0]); process.exit(2); }
const prompt = fs.readFileSync(0, 'utf8');
// Every entry under the working folder, with its type, so a test can see what the read view's copy holds.
function listTree(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? rel + '/' + e.name : e.name;
    const st = fs.lstatSync(path.join(root, r));
    out.push({ rel: r, type: st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file' });
    if (st.isDirectory()) out.push(...listTree(root, r));
  }
  return out;
}
let n = 1;
if (cfg.dir) {
  fs.mkdirSync(cfg.dir, { recursive: true });
  for (;; n++) { try { fs.closeSync(fs.openSync(path.join(cfg.dir, 'call-' + n + '.json'), 'wx')); break; } catch { /* taken */ } }
}
const modelArg = args[args.indexOf('-m') + 1] || '';
const modelId = modelArg.replace(/^amazon-bedrock\\//, '');
const cfgText = fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.json'), 'utf8');
const credFile = process.env.AWS_SHARED_CREDENTIALS_FILE || '';
const mode = (cfg.modes || [])[n - 1] || cfg.mode || 'good';
if (cfg.dir) fs.writeFileSync(path.join(cfg.dir, 'call-' + n + '.json'), JSON.stringify({
  n, mode, args, cwd: process.cwd(), home: process.env.HOME, env: process.env, prompt, config: cfgText,
  credFile, credHeaders: fs.existsSync(credFile) ? fs.readFileSync(credFile, 'utf8').split('\\n').filter((l) => l.startsWith('[')) : null,
  homeEntries: fs.readdirSync(process.env.HOME).sort(),
  cwdFiles: listTree(process.cwd()),
}));
const sessionID = 'ses_fake_' + n;
const out = (o) => console.log(JSON.stringify({ timestamp: Date.now(), sessionID, ...o }));
const ids = [...prompt.matchAll(/^- id: (\\S+)/gm)].map((m) => m[1]);
const goodReply = () => {
  if (prompt.includes('"gradeA"')) return JSON.stringify({ gradeA: 4, gradeB: 4, reason: 'equally good' });
  if (!prompt.includes('=== RESPONSE A ===')) return JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) });
  return JSON.stringify({ winner: 'A', reason: 'first looked better' });
};
const tokens = Object.assign({ input: Math.ceil(prompt.length / 4), output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cfg.tokens || {});
const cost = cfg.cost === undefined ? 0.01 : cfg.cost;
const finish = (text, servedModel) => {
  const step = () => out({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', cost, tokens: { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning, cache: { read: tokens.cacheRead, write: tokens.cacheWrite } } } });
  out({ type: 'step_start', part: { type: 'step-start' } });
  if (mode === 'twosteps') { out({ type: 'text', part: { type: 'text', text: 'summary of the conversation' } }); step(); out({ type: 'step_start', part: { type: 'step-start' } }); }
  out({ type: 'text', part: { type: 'text', text } });
  step();
  // nodb: the database is there but holds no session row, so the usage comes from the stream.
  const row = { id: sessionID, parent_id: null, agent: args[args.indexOf('--agent') + 1], model: JSON.stringify({ id: servedModel, providerID: 'amazon-bedrock' }), cost, tokens_input: tokens.input, tokens_output: tokens.output, tokens_reasoning: tokens.reasoning, tokens_cache_read: tokens.cacheRead, tokens_cache_write: tokens.cacheWrite, title: 'bench' };
  fs.mkdirSync(path.dirname(dbFile()), { recursive: true });
  fs.writeFileSync(dbFile(), JSON.stringify({ sessions: mode === 'nodb' ? [] : [row], compaction: cfg.compaction || { messages: 0, parts: 0 } }));
};
if (mode === 'sleep') { setTimeout(() => {}, 60000); return; }
if (mode === 'crash') { console.error('boom'); process.exit(3); }
if (mode === 'throttle') { out({ type: 'error', error: { name: 'APIError', data: { message: 'ThrottlingException: Too many requests, please wait before trying again.' } } }); process.exit(1); }
if (mode === 'auth') { out({ type: 'error', error: { name: 'APIError', data: { message: 'ExpiredTokenException: The security token included in the request is expired' } } }); process.exit(1); }
if (mode === 'empty') process.exit(0);
if (mode === 'prose') { finish('I think it is fine.', modelId); process.exit(0); }
if (mode === 'tool') { out({ type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { status: 'completed' } } }); finish(goodReply(), modelId); process.exit(0); }
if (mode === 'leak') { console.error(fs.readFileSync(credFile, 'utf8')); finish(goodReply(), modelId); process.exit(0); }
if (mode === 'wrongmodel') { finish(goodReply(), 'some.other-model'); process.exit(0); }
// Read modes: tool_use events as opencode 1.19.5 emits them (part.state.input: filePath, offset, limit), one step each.
// readall reads every file of the working folder in 2000-line pages; readhalf reads one line of each; readout reads a
// path outside the folder; readbash uses bash; readglobout globs above the folder. cfg.absPaths gives absolute paths.
const tool = (name, input, status = 'completed') => {
  out({ type: 'step_start', part: { type: 'step-start' } });
  out({ type: 'tool_use', part: { type: 'tool', tool: name, state: { status, input } } });
  out({ type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls', cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } });
};
const files = () => listTree(process.cwd()).filter((e) => e.type === 'file').map((e) => e.rel);
const where = (rel) => (cfg.absPaths ? path.join(args[args.indexOf('--dir') + 1], rel) : rel);
if (/^read/.test(mode)) {
  tool('glob', { pattern: '**/*' });
  for (const rel of files()) {
    const lines = fs.readFileSync(rel, 'utf8').split('\\n').length;
    if (mode === 'readhalf') { tool('read', { filePath: where(rel), offset: 1, limit: 1 }); continue; }
    for (let off = 1; off <= Math.max(1, lines); off += 2000) tool('read', { filePath: where(rel), offset: off, limit: 2000 });
  }
  if (mode === 'readout') tool('read', { filePath: '../home/.aws/credentials' });
  if (mode === 'readglobout') tool('glob', { pattern: '*', path: '/' });
  if (mode === 'readbash') tool('bash', { command: 'cat ~/.aws/credentials' });
}

finish(goodReply(), modelId);
`;

function makeFakeOpencodeJudge(binDir, config) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'opencode');
  fs.writeFileSync(file, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'fake-opencode-judge.config.json'), JSON.stringify(config));
  const calls = () => fs.readdirSync(config.dir).filter((f) => /^call-\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
    .map((f) => JSON.parse(fs.readFileSync(path.join(config.dir, f), 'utf8')));
  return { file, calls, setConfig: (more) => fs.writeFileSync(path.join(binDir, 'fake-opencode-judge.config.json'), JSON.stringify({ ...config, ...more })) };
}

module.exports = { makeFakeOpencodeJudge };
