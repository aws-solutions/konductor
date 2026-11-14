// SPDX-License-Identifier: Apache-2.0
'use strict';

// --hide can name a tree (the checkout) that also holds paths the bench masks on its own. The nested path goes
// with its parent; a second mount over it would abort the namespace setup.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeIsolation, probeUnshare, realHomes, HIDE_IN_HOME, HIDE_CREDENTIALS_IN_HOME } = require('../lib/isolate.js');
const { write } = require('./helpers.js');
const { mkScratch, makeScratchRoot } = require('./scratch.js');

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;

// The bench hides ~/.kiro, ~/.config and the like by default, and a tree under one of them is pruned from the script
// before the case under test runs. The scratch parent must not be one of those, whatever TMPDIR says.
function hiddenByDefault(dir) {
  const real = fs.realpathSync(dir);
  const names = [...HIDE_IN_HOME, ...HIDE_CREDENTIALS_IN_HOME].filter((d) => !path.isAbsolute(d));
  return realHomes().some((h) => names.some((d) => { const hidden = path.join(h, d); return real === hidden || real.startsWith(hidden + path.sep); }));
}
const SCRATCH_PARENT = [os.tmpdir(), '/tmp', '/var/tmp'].find((d) => fs.existsSync(d) && !hiddenByDefault(d));
const noParent = SCRATCH_PARENT ? false : `no temp directory outside the bench's default hide list (tried ${os.tmpdir()}, /tmp, /var/tmp)`;

function checkout() {
  const root = fs.realpathSync(mkScratch('nest-', SCRATCH_PARENT));
  write(path.join(root, 'repo/AGENTS.md'), 'x');
  write(path.join(root, 'repo/bench/fixtures/f/key.md'), 'x');
  write(path.join(root, 'repo/bench/tasks/hidden/t1/a.js'), 'x');
  write(path.join(root, 'repo2/keep.txt'), 'x');
  return { root, repo: path.join(root, 'repo'), sibling: path.join(root, 'repo2') };
}

// A second name for the checkout, the way /home/u -> /local/home/u makes one on a cloud desktop.
function linkTo(c) {
  const dir = mkScratch('nest-link-', SCRATCH_PARENT);
  const link = path.join(dir, 'via');
  fs.symlinkSync(c.root, link);
  return link;
}

const mountLines = (script) => script.split('\n').filter((l) => /^mount (-t tmpfs|--bind \/dev\/null)/.test(l));

test('the namespace script mounts once over a hidden tree and not over masks inside it', { skip: noParent }, () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench/fixtures'), path.join(c.repo, 'bench/tasks/hidden')] });
  const lines = mountLines(iso.script).filter((l) => l.includes(c.root));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.ok(lines[0].includes(c.repo));
});

test('a mask whose name only starts like the hidden tree is kept', { skip: noParent }, () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [c.sibling] });
  const lines = mountLines(iso.script).filter((l) => l.includes(c.root));
  assert.equal(lines.length, 2, lines.join('\n'));
});

test('a mask listed before its hidden parent is also pruned', { skip: noParent }, () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench')] });
  assert.equal(mountLines(iso.script).filter((l) => l.includes(c.root)).length, 1);
});

test('the sandbox-exec profile denies the hidden tree once and not the paths inside it', { skip: noParent }, () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench/fixtures')] });
  assert.ok(iso.profile.includes(`(subpath "${c.repo}")`));
  assert.ok(!iso.profile.includes(path.join(c.repo, 'bench')));
});

test('an agent in the namespace sees an empty hidden checkout and still reads a sibling tree', { skip: noParent || skip }, () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench/fixtures'), path.join(c.repo, 'bench/tasks/hidden')], keyRoots: [path.join(c.repo, 'bench')] });
  const w = iso.wrap('sh', ['-c', `[ -z "$(ls -A ${c.repo})" ] || exit 60; [ -f ${c.sibling}/keep.txt ] || exit 61`]);
  const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
});

test('a hide named through a symlinked parent and a mask at its real path give one mount, at the real path', { skip: noParent }, () => {
  const c = checkout();
  const via = linkTo(c);
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [path.join(via, 'repo')], mask: [path.join(c.repo, 'bench/fixtures'), path.join(c.repo, 'bench/tasks/hidden')] });
  const lines = mountLines(iso.script).filter((l) => l.includes(c.root) || l.includes(via));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.ok(lines[0].includes(c.repo) && !lines[0].includes(via), lines[0]);
});

test('a mask named through a symlinked parent inside a hide at the real path is pruned too', { skip: noParent }, () => {
  const c = checkout();
  const via = linkTo(c);
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [path.join(via, 'repo/bench/fixtures')] });
  assert.equal(mountLines(iso.script).filter((l) => l.includes(c.root) || l.includes(via)).length, 1);
});

test('a target that does not exist yet is kept as an absolute path', { skip: noParent }, () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, hide: [path.join(c.root, 'not-yet/there')] });
  assert.ok(iso.profile.includes(`(subpath "${path.join(c.root, 'not-yet/there')}")`));
});

test('an agent in the namespace sees an empty checkout hidden through a symlinked parent', { skip: noParent || skip }, () => {
  const c = checkout();
  const via = linkTo(c);
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [path.join(via, 'repo')], mask: [path.join(c.repo, 'bench/fixtures'), path.join(c.repo, 'bench/tasks/hidden')], keyRoots: [path.join(c.repo, 'bench')] });
  const w = iso.wrap('sh', ['-c', `[ -z "$(ls -A ${c.repo})" ] || exit 60; [ -f ${c.sibling}/keep.txt ] || exit 61`]);
  const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
});
