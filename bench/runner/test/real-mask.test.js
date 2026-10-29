// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mask = require('../lib/real-mask.js');
const { makeIsolation, probeUnshare } = require('../lib/isolate.js');
const { makeScratchRoot } = require('../lib/sandbox.js');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmask-')));
const touch = (f, t = '') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

// A fake home with two Pythons, a user site, a pip that vendors rich, and the package caches.
function fakeHome() {
  const home = tmp();
  for (const v of ['3.11.1', '3.12.2']) {
    const sp = path.join(home, `.local/share/mise/installs/python/${v}/lib/python${v.split('.').slice(0, 2).join('.')}/site-packages`);
    touch(path.join(sp, 'rich/__init__.py'));
    touch(path.join(sp, 'rich-15.0.0.dist-info/METADATA'));
    touch(path.join(sp, 'markdown_it/__init__.py'));
    touch(path.join(sp, 'markdown_it_py-4.2.0.dist-info/METADATA'));
    touch(path.join(sp, 'click/__init__.py'));
    touch(path.join(sp, 'click-8.1.7.dist-info/METADATA'));
    touch(path.join(sp, 'richer/__init__.py'));
    touch(path.join(sp, 'rich_click/__init__.py'));
    touch(path.join(sp, 'pytest/__init__.py'));
    touch(path.join(sp, 'pip/_vendor/rich/console.py'));
  }
  touch(path.join(home, '.local/lib/python3.12/site-packages/rich/__init__.py'));
  touch(path.join(home, '.cache/uv/archive-v0/abc/rich/__init__.py'));
  touch(path.join(home, '.cache/pip/http/x'));
  touch(path.join(home, '.local/share/mise/installs/node/24.1.0/lib/node_modules/commander/index.js'));
  return home;
}

const PY = (names, modules) => ({ language: 'python', repo: { packageNames: names }, test: { probeModules: modules } });
const JS = (names) => ({ language: 'javascript', repo: { packageNames: names }, test: {} });

test('site-packages of every installed Python and the user site are found', () => {
  const home = fakeHome();
  try {
    const dirs = mask.sitePackagesDirs(home).filter((d) => d.startsWith(home)).map((d) => path.relative(home, d)).sort();
    assert.deepEqual(dirs, [
      '.local/lib/python3.12/site-packages',
      '.local/share/mise/installs/python/3.11.1/lib/python3.11/site-packages',
      '.local/share/mise/installs/python/3.12.2/lib/python3.12/site-packages',
    ]);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('copies of a project are matched by package and normalised name; dist-info and look-alikes are left alone', () => {
  const home = fakeHome();
  try {
    const sp = mask.sitePackagesDirs(home).find((d) => d.includes('3.12.2'));
    const found = mask.pythonCopies(sp, ['markdown-it-py', 'markdown_it', 'rich']).map((p) => path.basename(p)).sort();
    assert.deepEqual(found, ['markdown_it', 'rich']);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a copy vendored inside another package is listed and is not part of the masks', () => {
  const home = fakeHome();
  try {
    const sp = mask.sitePackagesDirs(home).find((d) => d.includes('3.12.2'));
    assert.deepEqual(mask.findVendored(sp, ['rich']).map((p) => path.relative(sp, p)), ['pip/_vendor/rich']);
    const m = mask.realMasks([PY(['rich'], ['rich'])], { home }).paths;
    assert.equal(m.some((p) => p.includes('/pip/_vendor/')), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('masks cover the fixed copies, the package caches and the real cache, only where they exist', () => {
  const home = fakeHome();
  const cache = tmp();
  try {
    const m = mask.realMasks([PY(['rich'], ['rich']), PY(['click'], ['click']), JS(['commander'])], { home, cacheDir: cache, extra: [path.join(home, 'absent')] });
    const rel = m.paths.map((p) => (p.startsWith(home) ? path.relative(home, p) : p));
    assert.ok(rel.includes('.cache/uv'));
    assert.ok(rel.includes('.cache/pip'));
    assert.ok(rel.includes(cache));
    assert.ok(rel.includes('.local/lib/python3.12/site-packages/rich'));
    assert.ok(rel.includes('.local/share/mise/installs/python/3.11.1/lib/python3.11/site-packages/click'));
    assert.equal(rel.some((p) => p.endsWith('.dist-info')), false, 'dist-info stays visible');
    assert.ok(rel.includes('.local/share/mise/installs/node/24.1.0/lib/node_modules/commander'));
    assert.equal(rel.some((p) => /markdown_it|pytest|richer|rich_click|absent|\.npm/.test(p)), false, 'unselected projects, pytest and absent paths stay out');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(cache, { recursive: true, force: true }); }
});

test('python projects are matched through their import names too', () => {
  const home = fakeHome();
  try {
    const m = mask.realMasks([PY(['markdown-it-py'], ['markdown_it'])], { home }).paths.map((p) => path.basename(p));
    assert.ok(m.includes('markdown_it'));
    assert.equal(m.some((n) => n.startsWith('markdown_it_py')), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;

test('inside the namespace the masked directories are empty and their neighbours stay readable', { skip }, () => {
  const scratch = makeScratchRoot();
  const host = tmp();
  try {
    touch(path.join(host, 'site-packages/rich/console.py'), 'FIX');
    touch(path.join(host, 'site-packages/pytest/__init__.py'), 'PYTEST');
    touch(path.join(host, 'cache/wheel'), 'WHEEL');
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, hide: [path.join(host, 'site-packages/rich'), path.join(host, 'cache')] });
    const w = iso.wrap('sh', ['-c', [
      `[ -z "$(ls -A ${host}/site-packages/rich)" ] || exit 60`,
      `[ -z "$(ls -A ${host}/cache)" ] || exit 61`,
      `[ "$(cat ${host}/site-packages/pytest/__init__.py)" = PYTEST ] || exit 62`,
    ].join('; ')]);
    const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(host, { recursive: true, force: true });
  }
});
