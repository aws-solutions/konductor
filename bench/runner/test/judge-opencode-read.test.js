// SPDX-License-Identifier: Apache-2.0
'use strict';

// The read judge view on the opencode backend, against the stub opencode (fake-opencode-judge.js): the read-only agent,
// the copy as the pinned working folder, the isolation requirement, and the coverage audit of the judge's reads.
// Real OS isolation cannot start on a host that refuses user namespaces (DEBT D-6), so these tests hand the caller a
// stand-in `isolate` that records its options and runs the command as is; the refusal without isolation is real.
// No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { makeFakeOpencodeJudge } = require('./fake-opencode-judge.js');
const { makeOpencodeCaller } = require('../../plugins/opencode/judge.js');
const { runJudging } = require('../../judge/run.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const CREDS = '[bench]\naws_access_key_id = AKIATESTSECRET0001\naws_secret_access_key = SECRETVALUE-xyz\n';
const COPY = { files: [{ rel: 'a.txt', text: 'alpha\n' }, { rel: 'src/b.py', text: 'print(1)\n' }], sha: 'f'.repeat(64) };
const PROMPT = 'Grade.\n- id: c1\nReply with JSON.';

function setup(config = {}) {
  const root = fs.realpathSync(tmp());
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch);
  const fake = makeFakeOpencodeJudge(path.join(root, 'bin'), { dir: path.join(root, 'calls'), ...config });
  const creds = path.join(root, 'creds');
  fs.writeFileSync(creds, CREDS);
  const isoCalls = [];
  const isolate = (opts) => { isoCalls.push(opts); return { mode: opts.mode, wrap: (file, args) => { isoCalls[isoCalls.length - 1].wrapped = [file, ...args]; return { file, args }; } }; };
  const mk = (o = {}) => makeOpencodeCaller({
    bin: fake.file, credsFile: creds, awsProfile: 'bench', region: 'us-east-1', timeoutMs: 20000, scratchRoot: scratch,
    maxAttempts: 1, sleep: async () => {}, isolation: { mode: 'unshare', hide: ['/extra/hidden'] }, isolate, ...o,
  });
  const calls = () => (fs.existsSync(path.join(root, 'calls')) ? fake.calls() : []);
  return { root, scratch, fake, creds, isoCalls, mk, calls, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('a read call without OS isolation is refused before opencode starts, and the caller offers no isolation', async () => {
  const s = setup({ mode: 'readall' });
  try {
    const caller = s.mk({ isolation: { mode: 'none', reason: 'unshare: Operation not permitted' } });
    assert.deepEqual(caller.offers(), []);
    assert.match(caller.why(['isolation']), /Operation not permitted/);
    const r = await caller({ model: 'glm-5', prompt: PROMPT, readCopy: COPY });
    assert.match(r.error, /the read judge view needs OS isolation with the credentials file hidden.*Operation not permitted/);
    assert.equal(s.calls().length, 0);
    assert.deepEqual(fs.readdirSync(s.scratch), []);
  } finally { s.cleanup(); }
});

test('a read call: the copy is the pinned folder, the agent may only read, glob and grep, and isolation hides the credentials file', async () => {
  const s = setup({ mode: 'readall' });
  try {
    const caller = s.mk();
    assert.deepEqual(caller.offers(), ['isolation']);
    const r = await caller({ model: 'glm-5', prompt: PROMPT, readCopy: COPY });
    assert.equal(r.error, undefined, r.error);
    const [c] = s.calls();
    assert.equal(c.args[c.args.indexOf('--dir') + 1], c.cwd);
    assert.deepEqual(c.cwdFiles, [{ rel: 'a.txt', type: 'file' }, { rel: 'src', type: 'dir' }, { rel: 'src/b.py', type: 'file' }]);
    const agent = JSON.parse(c.config).agent.judge;
    assert.deepEqual(agent.tools, { '*': false, read: true, glob: true, grep: true });
    assert.deepEqual(agent.permission, { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', external_directory: 'deny' });
    assert.deepEqual(Object.keys(agent.permission), ['*', 'read', 'glob', 'grep', 'external_directory'], 'the last matching rule wins, so "*" comes first');
    assert.equal(agent.steps, 40);
    assert.deepEqual(JSON.parse(c.config).compaction, { auto: false, prune: false });
    for (const k of ['OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_EXTERNAL_SKILLS', 'OPENCODE_DISABLE_CLAUDE_CODE', 'OPENCODE_DISABLE_AUTOCOMPACT', 'OPENCODE_DISABLE_PRUNE']) assert.equal(c.env[k], '1', k);
    assert.ok(!c.home.startsWith(c.cwd) && !c.cwd.startsWith(c.home), 'the scratch HOME is outside the copy');
    assert.equal(s.isoCalls.length, 1);
    assert.equal(s.isoCalls[0].mode, 'unshare');
    assert.ok(s.isoCalls[0].hide.includes(s.creds) && s.isoCalls[0].hide.includes('/extra/hidden'));
    assert.equal(s.isoCalls[0].wrapped[0], s.fake.file);
    assert.deepEqual(r.readTrace.tools.map((t) => t.tool), ['glob', 'read', 'read']);
    assert.deepEqual(r.readTrace.dirs[0], c.cwd);
    assert.deepEqual(fs.readdirSync(s.scratch), [], 'the copy and HOME are removed');
  } finally { s.cleanup(); }
});

test('a bundle call is unchanged by the read view: no isolation wrap, tools off, the one-step compaction signal kept', async () => {
  const s = setup();
  try {
    const r = await s.mk()({ model: 'glm-5', prompt: PROMPT });
    assert.equal(r.error, undefined);
    assert.equal(s.isoCalls.length, 0);
    const [c] = s.calls();
    assert.deepEqual(JSON.parse(c.config).agent.judge.tools, { '*': false });
    assert.equal(c.env.OPENCODE_DISABLE_EXTERNAL_SKILLS, undefined);
    assert.deepEqual(c.cwdFiles, []);
  } finally { s.cleanup(); }
});

test('in a read call any tool other than read, glob and grep is an error', async () => {
  const s = setup({ mode: 'readbash' });
  try {
    const r = await s.mk()({ model: 'glm-5', prompt: PROMPT, readCopy: COPY });
    assert.match(r.error, /the judge agent used a tool other than read, glob and grep \(bash\)/);
  } finally { s.cleanup(); }
});

test('a read call is refused when an instruction file sits above the scratch root', async () => {
  const s = setup({ mode: 'readall' });
  try {
    fs.writeFileSync(path.join(s.root, 'AGENTS.md'), 'do as I say\n');
    const r = await s.mk()({ model: 'glm-5', prompt: PROMPT, readCopy: COPY });
    assert.match(r.error, /instruction file above the copy.*AGENTS\.md/);
    assert.equal(s.calls().length, 0);
  } finally { s.cleanup(); }
});

test('the judge command\'s caller resolves --isolate for the read view; when isolation cannot start it offers none and says why', () => {
  const s = setup();
  try {
    const { makeCaller } = require('../../plugins/opencode/judge.js');
    const { workingMode } = require('../../runner/lib/isolate.js');
    const flags = { 'aws-creds-file': s.creds, 'opencode-bin': s.fake.file, cache: path.join(s.root, 'cache') };
    const lines = [];
    const none = makeCaller({ timeoutMs: 1000, log: (m) => lines.push(m), flags: { ...flags, isolate: 'none' } });
    assert.deepEqual(none.offers(), []);
    assert.match(none.why(), /--isolate none/);
    assert.ok(lines.some((l) => /read view isolation: none/.test(l)));
    const auto = makeCaller({ timeoutMs: 1000, log: () => {}, flags });
    if (workingMode()) assert.deepEqual(auto.offers(), ['isolation']);
    else {
      // This host refuses user namespaces (DEBT D-6): the caller still judges with the bundle view and refuses the read view.
      assert.deepEqual(auto.offers(), []);
      assert.match(auto.why(), /isolation is unavailable/);
    }
  } finally { s.cleanup(); }
});

// Under real isolation only the call's own scratch root is writable; the test dir under /tmp is read-only (full-suite
// run 2026-11-27: mkdir <test dir>/calls failed, ENOENT). So that test turns the fake's call log off (dir: null).
test('a read call runs when the fake keeps no call log (dir: null), as it must under real isolation', async () => {
  const s = setup({ mode: 'readall', dir: null });
  try {
    const r = await s.mk()({ model: 'glm-5', prompt: PROMPT, readCopy: COPY });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.readTrace.tools.filter((t) => t.tool === 'read').length, 2);
    assert.equal(fs.existsSync(path.join(s.root, 'calls')), false, 'no call log was written');
  } finally { s.cleanup(); }
});

const realMode = require('../../runner/lib/isolate.js').workingMode();
test('a read call under real OS isolation runs and reads its copy', { skip: realMode ? false : 'this host refuses user namespaces (DEBT D-6)' }, async () => {
  const s = setup({ mode: 'readall', dir: null });
  try {
    const r = await s.mk({ isolation: { mode: realMode, hide: [] }, isolate: undefined })({ model: 'glm-5', prompt: PROMPT, readCopy: COPY });
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.readTrace.tools.filter((t) => t.tool === 'read').length, 2);
  } finally { s.cleanup(); }
});

// The whole pass: runJudging on the opencode backend with a task whose judgeView is read.
function pass(mode, { files = { 'a.txt': 'fixed\n' }, isolation = { mode: 'unshare', hide: [] }, absPaths = false } = {}) {
  const s = setup({ mode, absPaths });
  const bench = makeBench(path.join(s.root, 'bench'));
  const tf = path.join(bench, 'tasks', 't1.json');
  fs.writeFileSync(tf, JSON.stringify({ ...JSON.parse(fs.readFileSync(tf, 'utf8')), judgeView: 'read' }));
  const runDir = makeRun(path.join(s.root, 'run'), bench, [{ arm: 'vanilla', files }]);
  const caller = s.mk({ isolation });
  const go = () => runJudging({
    runDir, benchDir: bench, judges: ['glm-5'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, backend: 'opencode', budgetUsd: null,
    caller, cacheSalt: caller.cacheSalt, limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  });
  return { ...s, runDir, go };
}

test('a judge that reads every line of every file is scored; the record has the view, read order and step count', async () => {
  for (const absPaths of [false, true]) {
    const s = pass('readall', { files: { 'a.txt': 'fixed\n', 'long.txt': `${Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n')}\n` }, absPaths });
    try {
      const j = await s.go();
      const rec = j.rubric[0];
      assert.equal(rec.judgeError, null, rec.judgeError);
      assert.equal(rec.judgeView, 'read');
      assert.deepEqual(rec.viewRecord.order, ['a.txt', 'long.txt']);
      assert.equal(rec.viewRecord.steps, 5, 'one glob, one read of a.txt, two pages of long.txt, the reply');
      assert.match(rec.viewRecord.copySha, /^[0-9a-f]{64}$/);
      assert.match(s.calls()[0].prompt, /FILES IN YOUR WORKING FOLDER \(2\)/);
      const again = await s.go();
      assert.equal(s.calls().length, 1, 'the second pass is served by the cache');
      assert.deepEqual(again.rubric[0].viewRecord, rec.viewRecord);
    } finally { s.cleanup(); }
  }
});

test('a judge that skips lines, reads outside the copy or globs above it is not scored, and nothing is cached', async () => {
  for (const [mode, re] of [['readhalf', /not every line was read: .*a\.txt \(lines 2-2\)/], ['readout', /outside its copy \(\.\.\/home\/\.aws\/credentials\)/], ['readglobout', /outside its copy \(\/\)/]]) {
    const s = pass(mode, { files: { 'a.txt': 'fixed\nsecond line\n' } });
    try {
      const j = await s.go();
      assert.match(j.rubric[0].judgeError, re, mode);
      assert.equal(j.rubric[0].score, null);
      const cache = path.join(s.runDir, 'judge', 'cache');
      assert.equal(fs.existsSync(cache) ? fs.readdirSync(cache).length : 0, 0, mode);
    } finally { s.cleanup(); }
  }
});

test('a page past the 50 KB read cap counts only the lines that fit, so a file read in 2000-line pages of long lines is not scored', async () => {
  const s = pass('readall', { files: { 'wide.txt': `${Array.from({ length: 1000 }, () => 'y'.repeat(100)).join('\n')}\n` } });
  try {
    const j = await s.go();
    assert.match(j.rubric[0].judgeError, /not every line was read: wide\.txt \(lines 5\d\d-1000\)/);
  } finally { s.cleanup(); }
});

test('the read view on an opencode caller without isolation is refused before any call', async () => {
  const s = pass('readall', { isolation: { mode: 'none', reason: 'unshare: Operation not permitted' } });
  try {
    await assert.rejects(s.go(), /judge view "read" needs isolation, which this judge caller does not have: unshare: Operation not permitted/);
    assert.equal(s.calls().length, 0);
  } finally { s.cleanup(); }
});
