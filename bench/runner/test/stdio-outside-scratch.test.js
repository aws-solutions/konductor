// SPDX-License-Identifier: Apache-2.0
'use strict';

// The live stdout and stderr files are opened by the runner in the out dir and handed to the agent as inherited
// descriptors. Nothing the host reads later (the credit meter, the stop watcher, the moved result) sits in the
// space the agent can write. The macOS directory is checked through its profile text and path choice.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { liveStdioDir, probeUnshare } = require('../lib/isolate.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

// Runs the fake agent through a wrapper that records what it sees next to its work dir and tries to reach the
// out dir files. The wrapper writes into its cwd, which the run snapshots into <out>/workspace.
async function runProbed(root, mode, { reachOut }) {
  const prevPath = process.env.PATH;
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probeDir = path.join(root, 'probe');
  fs.mkdirSync(probeDir);
  const real = makeFakeKiro(bin, { dir: probeDir });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch'); const watch = path.join(root, 'watch'); const outRoot = path.join(root, 'out');
  fs.mkdirSync(scratchDir); fs.mkdirSync(watch); fs.mkdirSync(outRoot);
  const outDir = path.join(outRoot, 't1');
  const reach = reachOut
    ? `for f in ${outDir}/stream.jsonl ${outDir}/stderr.txt; do [ -e "$f" ] && echo "visible $f" >> reach.txt; done\n( : > ${outDir}/stderr.txt ) 2>/dev/null && echo wrote >> reach.txt\n[ -e ${outDir}/stream.jsonl ] && rm -f ${outDir}/stream.jsonl 2>/dev/null && echo removed >> reach.txt\n`
    : '';
  fs.renameSync(real, path.join(bin, 'kiro-real'));
  fs.writeFileSync(real, `#!/bin/sh\n{ echo "[run root]"; ls -A ..; echo "[scratch]"; ls -A ../..; } > listing.txt 2>&1\n${reach}exec "$(dirname "$0")/kiro-real" "$@"\n`, { mode: 0o755 });
  const ctx = {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode }, mask: [outRoot], tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
  };
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  try {
    const result = await executeRun({ arm: ARM, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 });
    return { result, outDir, scratchDir };
  } finally {
    process.env.PATH = prevPath;
  }
}

function sections(text) {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^\[(.+)\]$/.exec(line);
    if (m) { cur = m[1]; out[cur] = []; } else if (cur && line) out[cur].push(line);
  }
  return out;
}

function assertLiveFilesOutsideScratch({ result, outDir, scratchDir }) {
  const seen = sections(fs.readFileSync(path.join(outDir, 'workspace', 'listing.txt'), 'utf8'));
  assert.ok(!seen['run root'].includes('stdio'), `run root lists a stdio dir: ${seen['run root']}`);
  assert.deepEqual(seen['run root'].filter((e) => /stdio/.test(e)), []);
  assert.equal(seen.scratch.length, 1, `scratch holds only the run root: ${seen.scratch}`);
  assert.ok(!/stdio/.test(seen.scratch[0]));
  assert.ok(!result.flags.includes('stdioTampered'));
  const stream = fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8');
  assert.match(stream, /"runStarted"/);
  assert.equal(fs.existsSync(path.join(outDir, 'stderr.txt')), true);
  assert.deepEqual(fs.readdirSync(scratchDir), [], 'nothing is left behind after the run');
}

test('isolation none: no stdio directory in or beside the run root; stream and stderr are written in the out dir', async () => {
  const root = tmp();
  try {
    const run = await runProbed(root, 'none', { reachOut: false });
    assertLiveFilesOutsideScratch(run);
    assert.equal(run.result.status, 'success', run.result.error ?? '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable here (${probe.reason}); the real-sandbox assertions did not run`;

test('unshare: the out dir files are not reachable from the agent, and its attempt to replace them finds nothing', { skip }, async () => {
  const root = tmp();
  try {
    const run = await runProbed(root, 'unshare', { reachOut: true });
    assertLiveFilesOutsideScratch(run);
    const reachFile = path.join(run.outDir, 'workspace', 'reach.txt');
    assert.equal(fs.existsSync(reachFile) ? fs.readFileSync(reachFile, 'utf8') : '', '', 'the agent saw or changed an out dir file');
    assert.equal(run.result.status, 'success', run.result.error ?? '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('liveStdioDir: only sandbox-exec gets one, as a sibling of the run root and never inside it', () => {
  assert.equal(liveStdioDir('none', '/s/r-abc'), null);
  assert.equal(liveStdioDir('unshare', '/s/r-abc'), null);
  const d = liveStdioDir('sandbox-exec', '/s/r-abc');
  assert.equal(d, '/s/r-abc-stdio');
  assert.ok(!d.startsWith('/s/r-abc/'));
});
