// SPDX-License-Identifier: Apache-2.0
'use strict';

// --hide can name a tree (the checkout) that also holds paths the bench masks on its own. The nested path goes
// with its parent; a second mount over it would abort the namespace setup.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeIsolation, probeUnshare } = require('../lib/isolate.js');
const { write } = require('./helpers.js');
const { mkScratch, makeScratchRoot } = require('./scratch.js');

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;

function checkout() {
  const root = fs.realpathSync(mkScratch('nest-'));
  write(path.join(root, 'repo/AGENTS.md'), 'x');
  write(path.join(root, 'repo/bench/fixtures/f/key.md'), 'x');
  write(path.join(root, 'repo/bench/tasks/hidden/t1/a.js'), 'x');
  write(path.join(root, 'repo2/keep.txt'), 'x');
  return { root, repo: path.join(root, 'repo'), sibling: path.join(root, 'repo2') };
}

const mountLines = (script) => script.split('\n').filter((l) => /^mount (-t tmpfs|--bind \/dev\/null)/.test(l));

test('the namespace script mounts once over a hidden tree and not over masks inside it', () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench/fixtures'), path.join(c.repo, 'bench/tasks/hidden')] });
  const lines = mountLines(iso.script).filter((l) => l.includes(c.root));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.ok(lines[0].includes(c.repo));
});

test('a mask whose name only starts like the hidden tree is kept', () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [c.sibling] });
  const lines = mountLines(iso.script).filter((l) => l.includes(c.root));
  assert.equal(lines.length, 2, lines.join('\n'));
});

test('a mask listed before its hidden parent is also pruned', () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench')] });
  assert.equal(mountLines(iso.script).filter((l) => l.includes(c.root)).length, 1);
});

test('the sandbox-exec profile denies the hidden tree once and not the paths inside it', () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'sandbox-exec', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench/fixtures')] });
  assert.ok(iso.profile.includes(`(subpath "${c.repo}")`));
  assert.ok(!iso.profile.includes(path.join(c.repo, 'bench')));
});

test('an agent in the namespace sees an empty hidden checkout and still reads a sibling tree', { skip }, () => {
  const c = checkout();
  const scratch = makeScratchRoot();
  const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [c.repo], mask: [path.join(c.repo, 'bench/fixtures'), path.join(c.repo, 'bench/tasks/hidden')], keyRoots: [path.join(c.repo, 'bench')] });
  const w = iso.wrap('sh', ['-c', `[ -z "$(ls -A ${c.repo})" ] || exit 60; [ -f ${c.sibling}/keep.txt ] || exit 61`]);
  const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
});
