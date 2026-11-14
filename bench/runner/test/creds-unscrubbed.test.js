// SPDX-License-Identifier: Apache-2.0
'use strict';

// A run whose output files could not all be scrubbed is flagged credsUnscrubbed and is never sent to a judge.
// Every secret is a made-up value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { HARNESSES } = require('../lib/harness/index.js');
const { runJudging, notJudgedReason } = require('../../judge/run.js');
const { runPackJudging } = require('../../judge/packrun.js');
const { loadPack } = require('../../judge/pack/index.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const asRoot = process.getuid?.() === 0;
const SKIP = asRoot && 'root can read any file';

function lockedDir() {
  const dir = tmp();
  write(path.join(dir, 'ok.txt'), `key ${KEY}\n`);
  const locked = path.join(dir, 'locked.txt');
  write(locked, `key ${KEY}\n`);
  fs.chmodSync(locked, 0o000);
  return { dir, locked, restore: () => fs.chmodSync(locked, 0o600) };
}

for (const id of Object.keys(HARNESSES)) {
  test(`${id} finalize reports a file it could not scrub and still scrubs the others`, { skip: SKIP }, () => {
    const { dir, locked, restore } = lockedDir();
    try {
      const r = HARNESSES[id].finalize(dir, {});
      assert.equal(r.scrubbed, 1);
      assert.deepEqual(r.unscrubbed.map((u) => u.file), [locked]);
      assert.equal(fs.readFileSync(path.join(dir, 'ok.txt'), 'utf8'), 'key <redacted>\n');
    } finally { restore(); }
  });

  test(`${id} finalize reports nothing unscrubbed for a clean tree`, () => {
    const dir = tmp();
    write(path.join(dir, 'ok.txt'), `key ${KEY}\n`);
    const r = HARNESSES[id].finalize(dir, {});
    assert.deepEqual(r, { scrubbed: 1, files: 1, unscrubbed: [], skipped: [] });
  });
}

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

function runSetup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const outDir = path.join(root, 'out', 't1');
  const ctx = {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
  };
  return { root, ctx, outDir, task: loadTasks(bench).get('t1'), bin };
}

async function runWith(finalize) {
  const s = runSetup();
  const kiro = HARNESSES['kiro-cli'];
  const original = kiro.finalize;
  const prevPath = process.env.PATH;
  process.env.PATH = `${s.bin}${path.delimiter}${prevPath}`;
  kiro.finalize = finalize ? (outDir, ctx) => finalize(outDir, ctx, original) : original;
  try {
    const result = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    return { result, saved: JSON.parse(fs.readFileSync(path.join(s.outDir, 'result.json'), 'utf8')) };
  } finally {
    kiro.finalize = original;
    process.env.PATH = prevPath;
    fs.rmSync(s.root, { recursive: true, force: true });
  }
}

test('executeRun sets credsUnscrubbed and lists the file when the scrub could not process one', { skip: SKIP }, async () => {
  const { result, saved } = await runWith((outDir, ctx, original) => {
    const locked = path.join(outDir, 'transcript.txt');
    write(locked, `key ${KEY}\n`);
    fs.chmodSync(locked, 0o000);
    try { return original(outDir, ctx); } finally { fs.chmodSync(locked, 0o600); }
  });
  assert.ok(result.flags.includes('credsUnscrubbed'));
  assert.deepEqual(saved.unscrubbedFiles.map((u) => u.file), ['transcript.txt']);
  assert.match(saved.unscrubbedFiles[0].reason, /EACCES/);
  assert.ok(!/schema:/.test(saved.error ?? ''), saved.error);
});

test('executeRun sets credsUnscrubbed when finalize throws instead of dropping the error', async () => {
  const { result, saved } = await runWith(() => { throw new Error('boom'); });
  assert.ok(result.flags.includes('credsUnscrubbed'));
  assert.deepEqual(saved.unscrubbedFiles, [{ file: '.', reason: 'scrub failed: boom' }]);
});

test('executeRun leaves credsUnscrubbed off when every file was scrubbed', async () => {
  const { result, saved } = await runWith();
  assert.ok(!result.flags.includes('credsUnscrubbed'));
  assert.equal(saved.unscrubbedFiles, undefined);
});

test('a bare count from an older harness still works', async () => {
  const { result } = await runWith(() => 2);
  assert.ok(result.flags.includes('credsRedacted'));
  assert.ok(!result.flags.includes('credsUnscrubbed'));
});

// ---- judging ----

test('notJudgedReason names credsUnscrubbed ahead of other reasons', () => {
  assert.equal(notJudgedReason({ result: { flags: ['credsUnscrubbed'], infraError: 'x' }, dir: '/nope' }), 'credsUnscrubbed');
});

const stub = () => {
  const calls = [];
  const fn = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
    return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }), credits: 0.1, latencyMs: 1 };
  };
  fn.calls = calls;
  return fn;
};

test('a run flagged credsUnscrubbed is not sent to a judge and is recorded as not judged', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [
      { arm: 'vanilla', finalText: 'clean arm text', files: { 'a.txt': 'fixed by vanilla\n' } },
      { arm: 'leaky', finalText: 'leaky arm text', flags: ['credsUnscrubbed'], files: { 'a.txt': `fixed by leaky ${KEY}\n` } },
    ]);
    const caller = stub();
    const messages = [];
    const j = await runJudging({
      runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
      limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: (m) => messages.push(m), caller,
    });
    assert.ok(caller.calls.length > 0);
    assert.ok(caller.calls.every((c) => !c.prompt.includes('leaky arm text') && !c.prompt.includes('fixed by leaky') && !c.prompt.includes(KEY)));
    assert.deepEqual(j.notJudged, [{ armId: 'leaky', taskId: 't1', replicate: 1, reason: 'credsUnscrubbed' }]);
    assert.ok(messages.some((m) => /not judged leaky\|t1\|1: credsUnscrubbed/.test(m)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the quality pack pass skips a run flagged credsUnscrubbed', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
    write(path.join(bench, 'tasks/d1.json'), JSON.stringify({ ...t1, id: 'd1', class: 'design', prompt: 'Write a design for the hold service.' }));
    const runDir = makeRun(path.join(root, 'run'), bench, [
      { arm: 'vanilla', task: 'd1', files: { 'docs/design.md': '# Hold service design\n\nHolds are first come, first served.\n' } },
      { arm: 'leaky', task: 'd1', flags: ['credsUnscrubbed'], files: { 'docs/design.md': `# Leaky design ${KEY}\n` } },
    ], { taskIds: ['t1', 'd1'] });
    const prompts = [];
    const caller = async ({ prompt }) => {
      prompts.push(prompt);
      const ids = (/exactly one entry for each criterion id: (.+)\.$/m.exec(prompt) ?? [])[1]?.split(', ') ?? [];
      return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'Hold service design' })) }), credits: 0.1, latencyMs: 1 };
    };
    const j = await runPackJudging({
      runDir, benchDir: bench, judges: ['gpt-test'], concurrency: 1, budgetCredits: null, limits: { maxFileChars: 6000, maxBundleChars: 24000 },
      redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {}, pack: loadPack('quality'), caller,
    });
    assert.ok(prompts.length > 0);
    assert.ok(prompts.every((p) => !p.includes('Leaky design') && !p.includes(KEY)));
    assert.ok(j.records.every((r) => r.armId !== 'leaky'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
