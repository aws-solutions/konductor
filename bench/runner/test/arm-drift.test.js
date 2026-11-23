// SPDX-License-Identifier: Apache-2.0
'use strict';

// An arm id names one commit within a study directory: a ref that moved between two commands is refused.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { resolveArm } = require('../lib/arms.js');
const { pinConflicts, recordedPins, describeConflicts } = require('../lib/study-pins.js');
const { cmdRun } = require('../lib/run-cmd.js');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
}

// main with two commits; origin/main points at the first, as if a fetch had not happened yet.
function makeRepo() {
  const repo = tmp();
  git(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, 'cli/konductor-rs/Cargo.toml'), '[package]\nname = "k"\n');
  write(path.join(repo, 'mcp/Cargo.toml'), '[workspace]\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  write(path.join(repo, 'a.txt'), 'two\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'two');
  const second = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'update-ref', 'refs/remotes/origin/main', first);
  return { repo, first, second };
}

const writeResult = (outDir, armId, commitSha, rep = 1) => write(path.join(outDir, armId, 't1', String(rep), 'result.json'), JSON.stringify({ armId, commitSha, taskId: 't1', replicate: rep, status: 'success' }));

test('pinConflicts finds an arm id whose recorded commit differs from the one resolved now, from results and run-config', () => {
  const { repo, first, second } = makeRepo();
  const out = tmp();
  try {
    const before = resolveArm('main', repo);
    assert.equal(before.commitSha, first);
    writeResult(out, 'main', first);
    writeResult(out, 'vanilla', null);
    assert.deepEqual(pinConflicts(out, [before, resolveArm('vanilla', repo)]), [], 'same commit, and vanilla has no pin');

    git(repo, 'update-ref', 'refs/remotes/origin/main', second); // a fetch moved origin/main
    const after = resolveArm('main', repo);
    const conflicts = pinConflicts(out, [after]);
    assert.equal(conflicts.length, 1);
    assert.deepEqual({ armId: conflicts[0].armId, recorded: conflicts[0].recorded, now: conflicts[0].now }, { armId: 'main', recorded: first, now: second });
    assert.match(describeConflicts(conflicts, out), new RegExp(`arm main \\(origin/main\\): .* holds commit ${first.slice(0, 12)} .*resolved ${second.slice(0, 12)}`));
    assert.match(describeConflicts(conflicts, out), /--allow-arm-drift/);

    fs.rmSync(path.join(out, 'main'), { recursive: true });
    write(path.join(out, 'run-config.json'), JSON.stringify({ arms: [{ id: 'main', commitSha: first }] }));
    assert.equal(pinConflicts(out, [after]).length, 1, 'run-config.json alone is enough');
    assert.deepEqual(recordedPins(out, ['other']), new Map());
  } finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

test('a directory arm is pinned by its snapshot hash', () => {
  const { repo } = makeRepo();
  const out = tmp();
  const dir = tmp();
  try {
    write(path.join(dir, 'cli/konductor-rs/Cargo.toml'), '[package]\n');
    const a = resolveArm(`wt=dir:${dir}`, repo);
    write(path.join(out, 'wt', 't1', '1', 'result.json'), JSON.stringify({ armId: 'wt', commitSha: null, source: 'dir', contentHash: a.contentHash }));
    assert.deepEqual(pinConflicts(out, [a]), []);
    write(path.join(dir, 'b.txt'), 'edited\n');
    const edited = resolveArm(`wt=dir:${dir}`, repo);
    assert.equal(pinConflicts(out, [edited])[0].kind, 'content');
  } finally { for (const d of [repo, out, dir]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('run refuses an --out that holds the same arm id at another commit, before building anything', async () => {
  const { repo, first, second } = makeRepo();
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const out = path.join(root, 'out');
    writeResult(out, 'main', first);
    git(repo, 'update-ref', 'refs/remotes/origin/main', second);
    await assert.rejects(
      cmdRun({ suite: 'lite', arms: 'main', 'budget-credits': '1000', 'bench-dir': bench, 'repo-root': repo, out, cache: path.join(root, 'cache'), isolate: 'none', 'allow-unisolated': true }),
      (e) => { assert.match(e.message, /arm content changed since earlier results/); assert.ok(e.message.includes(second.slice(0, 12))); return true; },
    );
    assert.equal(fs.existsSync(path.join(root, 'cache')), false, 'nothing was built');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});
