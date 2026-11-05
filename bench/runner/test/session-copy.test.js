// SPDX-License-Identifier: Apache-2.0
'use strict';

// copySessions with the entries kiro-cli really leaves under ~/.kiro/sessions/cli, and a whole run that meets them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { copySessions, readTranscripts } = require('../lib/harness/kiro.js');
const { redactHostPaths, hostPathRules } = require('../lib/hygiene.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };

function sessionHome(root) {
  const home = path.join(root, 'home');
  const dir = path.join(home, '.kiro/sessions/cli');
  fs.mkdirSync(dir, { recursive: true });
  return { home, dir };
}

const allFiles = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

test('a nested session directory is copied recursively next to the transcript files', () => {
  const root = tmp();
  try {
    const { home, dir } = sessionHome(root);
    fs.writeFileSync(path.join(dir, 'abc.json'), '{"a":1}');
    fs.writeFileSync(path.join(dir, 'abc.jsonl'), 'line\n');
    fs.mkdirSync(path.join(dir, 'abc/tool-results/deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'abc/tool-results/deep/out.txt'), 'nested');
    const dest = path.join(root, 'out/session');
    const r = copySessions(home, dest);
    assert.deepEqual(allFiles(dest), ['abc', 'abc.json', 'abc.jsonl', 'abc/tool-results', 'abc/tool-results/deep', 'abc/tool-results/deep/out.txt']);
    assert.equal(fs.readFileSync(path.join(dest, 'abc/tool-results/deep/out.txt'), 'utf8'), 'nested');
    assert.deepEqual(r.skipped, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('symlinks are skipped with a note and their targets outside the session dir are never read', () => {
  const root = tmp();
  try {
    const { home, dir } = sessionHome(root);
    const outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(outside, 'secret-dir'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'OUTSIDE_CONTENT');
    fs.writeFileSync(path.join(outside, 'secret-dir/inner.txt'), 'OUTSIDE_INNER');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link-file'));
    fs.symlinkSync(path.join(outside, 'secret-dir'), path.join(dir, 'link-dir'));
    fs.mkdirSync(path.join(dir, 'real'));
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'real/nested-link'));
    fs.symlinkSync(path.join(root, 'does-not-exist'), path.join(dir, 'dangling'));
    fs.writeFileSync(path.join(dir, 'keep.json'), '{}');
    const dest = path.join(root, 'out/session');
    const r = copySessions(home, dest);
    assert.deepEqual(allFiles(dest), ['keep.json', 'real']);
    assert.deepEqual(r.skipped.map((s) => [s.path, s.reason]).sort(), [
      ['dangling', 'symlink'], ['link-dir', 'symlink'], ['link-file', 'symlink'], [path.join('real', 'nested-link'), 'symlink'],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a socket and a FIFO are skipped with a note and the other entries are still copied', async () => {
  const root = tmp();
  const server = net.createServer();
  try {
    const { home, dir } = sessionHome(root);
    fs.writeFileSync(path.join(dir, 'keep.jsonl'), 'x');
    await new Promise((resolve) => server.listen(path.join(dir, 'sock'), resolve));
    assert.equal(spawnSync('mkfifo', [path.join(dir, 'fifo')]).status, 0);
    const dest = path.join(root, 'out/session');
    const r = copySessions(home, dest);
    assert.deepEqual(allFiles(dest), ['keep.jsonl']);
    assert.deepEqual(r.skipped.map((s) => s.path).sort(), ['fifo', 'sock']);
    assert.ok(r.skipped.every((s) => s.reason === 'special file'));
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no sessions directory is not an error', () => {
  const root = tmp();
  try {
    const r = copySessions(path.join(root, 'home'), path.join(root, 'out/session'));
    assert.deepEqual(r, { copied: [], skipped: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a transcript path that is a directory counts as a missing transcript, not a crash', () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, 's1.jsonl'));
    fs.mkdirSync(path.join(root, 's1.json'));
    const r = readTranscripts(root, ['s1'], 'stream');
    assert.deepEqual(r.transcript, { bytes: 6, chars: 6, partial: true });
    assert.deepEqual(r.sessions, [null]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function setup(cfg) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, ...cfg });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' },
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const cleanup = () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); };
  return { ctx, task: loadTasks(bench).get('t1'), outDir: path.join(root, 'out', 't1'), cleanup };
}

test('a run whose session directory holds a nested directory keeps its score, credits and checks', async () => {
  const s = setup({ sessionTree: true, credits: 0.75 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.infraError, null);
    assert.equal(r.status, 'success');
    assert.equal(r.credits, 0.75);
    assert.ok(r.checks.length > 0);
    assert.equal(r.checks[0].passed, true);
    assert.equal(r.flags.includes('sessionCopyPartial'), false);
    assert.equal(fs.readFileSync(path.join(s.outDir, 'session/s1/tool-results/out.txt'), 'utf8'), 'nested');
  } finally {
    s.cleanup();
  }
});

test('a session copy failure flags sessionCopyPartial and does not discard credits or checks', async () => {
  const s = setup({ breakSessions: true, credits: 0.75 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.infraError, null);
    assert.equal(r.status, 'success');
    assert.equal(r.credits, 0.75);
    assert.ok(r.checks.length > 0);
    assert.equal(r.checks[0].passed, true);
    assert.ok(r.flags.includes('sessionCopyPartial'));
    assert.equal(r.transcriptPartial, true);
  } finally {
    s.cleanup();
  }
});

test('an artifact copy failure flags artifactCopyFailed and keeps the run result', async () => {
  const s = setup({ agentJsonDir: true, credits: 0.75 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.infraError, null);
    assert.equal(r.credits, 0.75);
    assert.ok(r.checks.length > 0);
    assert.ok(r.flags.includes('artifactCopyFailed'));
  } finally {
    s.cleanup();
  }
});

// ---- engine v3: ~/.kiro/sessions/<workspace hash>/sess_<id>/ ----

function v3Home(root, { messages = '{"payload":{"type":"user"}}\n', subs = { 'e1.jsonl': '{"payload":{"type":"assistant"}}\n' } } = {}) {
  const home = path.join(root, 'home');
  const sdir = path.join(home, '.kiro/sessions/ab12cd34ef56ab78/sess_abc-123');
  fs.mkdirSync(path.join(sdir, 'sub-executions'), { recursive: true });
  fs.writeFileSync(path.join(sdir, 'session.json'), '{"id":"sess_abc-123"}');
  if (messages !== null) fs.writeFileSync(path.join(sdir, 'messages.jsonl'), messages);
  for (const [name, text] of Object.entries(subs)) fs.writeFileSync(path.join(sdir, 'sub-executions', name), text);
  fs.writeFileSync(path.join(sdir, 'publish.cursor'), '3');
  return { home, sdir };
}

test('a v3 session directory is copied to session/<sess id>/ with its sub-agent files', () => {
  const root = tmp();
  try {
    const { home } = v3Home(root);
    fs.mkdirSync(path.join(home, '.kiro/sessions/ab12cd34ef56ab78/not-a-session'), { recursive: true });
    fs.writeFileSync(path.join(home, '.kiro/sessions/ab12cd34ef56ab78/not-a-session/x'), 'x');
    const dest = path.join(root, 'out/session');
    const r = copySessions(home, dest);
    assert.deepEqual(allFiles(dest), [
      'sess_abc-123', 'sess_abc-123/messages.jsonl', 'sess_abc-123/publish.cursor', 'sess_abc-123/session.json', 'sess_abc-123/sub-executions', 'sess_abc-123/sub-executions/e1.jsonl',
    ]);
    assert.deepEqual(r.skipped, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a v3 workspace directory that is a symlink is skipped and not followed', () => {
  const root = tmp();
  try {
    const { home } = v3Home(root);
    const outside = path.join(root, 'outside/sess_evil');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'messages.jsonl'), 'OUTSIDE');
    fs.symlinkSync(path.join(root, 'outside'), path.join(home, '.kiro/sessions/linked'));
    const dest = path.join(root, 'out/session');
    const r = copySessions(home, dest);
    assert.equal(allFiles(dest).some((f) => f.includes('sess_evil')), false);
    assert.deepEqual(r.skipped.map((s) => [s.path, s.reason]), [['linked', 'symlink']]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the transcript of a v3 session is its messages plus its sub-execution files, and is partial only without messages', () => {
  const root = tmp();
  try {
    const { home } = v3Home(root);
    const dest = path.join(root, 'out/session');
    copySessions(home, dest);
    const whole = readTranscripts(dest, ['sess_abc-123'], 'stream text');
    const expected = Buffer.byteLength('{"payload":{"type":"user"}}\n{"payload":{"type":"assistant"}}\n');
    assert.deepEqual(whole.transcript, { bytes: expected, chars: expected, partial: false });
    fs.rmSync(path.join(dest, 'sess_abc-123/messages.jsonl'));
    const missing = readTranscripts(dest, ['sess_abc-123'], 'stream text');
    assert.deepEqual(missing.transcript, { bytes: 11, chars: 11, partial: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('redactHostPaths replaces the host home in every saved file and leaves other paths alone', () => {
  const root = tmp();
  try {
    fs.writeFileSync(path.join(root, 'a.jsonl'), '{"cwd":"/local/home/someone/project","other":"/home/someone2/x","scratch":"/tmp/w-1/home"}\n');
    fs.mkdirSync(path.join(root, 'd'));
    fs.writeFileSync(path.join(root, 'd/b.json'), '/Users/someone/code and /home/someone');
    const n = redactHostPaths(root, hostPathRules({ HOME: '/local/home/someone' }, 'someone'));
    assert.equal(n, 2);
    assert.equal(fs.readFileSync(path.join(root, 'a.jsonl'), 'utf8'), '{"cwd":"<host-home>/project","other":"/home/someone2/x","scratch":"/tmp/w-1/home"}\n');
    assert.equal(fs.readFileSync(path.join(root, 'd/b.json'), 'utf8'), '<host-home>/code and <host-home>');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a v3 run keeps its full session files, is not transcriptPartial, and carries no host path', async () => {
  const hostPath = path.join(os.homedir(), 'private-project');
  const s = setup({ sessionTreeV3: true, sessionId: 'sess_fake1', hostPath, credits: 0.75 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: { ...s.ctx, config: { ...CONFIG, agentEngine: 'v3' } }, prepared: null, outDir: s.outDir });
    assert.equal(r.infraError, null);
    assert.equal(r.flags.includes('transcriptPartial'), false);
    assert.equal(r.transcriptPartial, false);
    const dir = path.join(s.outDir, 'session/sess_fake1');
    assert.deepEqual(allFiles(dir), ['messages.jsonl', 'publish.cursor', 'session.json', 'sub-executions', 'sub-executions/e1.jsonl']);
    const saved = allFiles(dir).filter((f) => f.endsWith('.json') || f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    assert.equal(saved.includes(os.homedir()), false);
    assert.match(fs.readFileSync(path.join(dir, 'messages.jsonl'), 'utf8'), /hello <host-home>\/private-project/);
  } finally {
    s.cleanup();
  }
});
