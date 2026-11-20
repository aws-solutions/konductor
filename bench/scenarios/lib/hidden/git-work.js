'use strict';

// Shared hidden tests of the worker tasks (T12: delegated fixes, parallel workers under a multiplexer): the tickets
// must be done by separate workers on their own branches, merged into main with one merge commit each, and cleaned
// up. Every test reads only what is left in the repository (the git history, the code, the working tree), never a
// session label, a plan or a tool log.
//
// A task's hidden dir holds work.test.js (three lines: require this file and call workTests), work.json and the
// ticket tests, and names this helper in .bench-lib.json. work.json:
//   base      the fixture's main commit (the build is deterministic, so the id is fixed)
//   main      the branch the work lands on (default main)
//   suite     the repository's own test command, as node arguments (default ["--test", "test/*.test.js"])
//   tickets   [{ id, files: [source paths only this ticket may change], test: hidden test path, relative to the
//              hidden dir, that passes once the ticket is done }]
//   extra     [{ name, test }]: further hidden tests of the merged result (for example a rule a hasty fix breaks)
//   hidden    the paths the hidden dir lays over the workspace, so the clean-tree check skips them
// Per ticket: fixed on main; a worker branch, merged with its own merge commit, that changes only its ticket's files
// and passes the ticket test on its own; a regression test on that branch that fails on the old code. Then: green
// after every merge, the extra tests, and the clean-up. Each test needs at least one worker merge, and the extra and
// clean-up tests need every ticket merged, so an untouched repository or one agent fixing everything on main scores
// near nothing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const TIMEOUT = 20000;

function env() {
  const { NODE_TEST_CONTEXT, ...rest } = process.env;
  return { ...rest, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

function git(root, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: root, env: env(), encoding: opts.encoding ?? 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr || '').slice(0, 300)}`);
  return opts.encoding === 'buffer' ? r.stdout : r.stdout.trim();
}
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const tryGit = (root, args) => { try { return git(root, args); } catch { return null; } };

/** The commit `sha` as plain files in a fresh temp dir. */
function snapshot(root, sha) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-work-'));
  const tar = git(root, ['archive', '--format=tar', sha], { encoding: 'buffer' });
  const r = spawnSync('tar', ['-x', '-C', dir], { input: tar, timeout: TIMEOUT });
  if (r.status !== 0) throw new Error(`tar of ${sha} failed`);
  return dir;
}
const drop = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Runs node with `args` in `cwd`; true when it exits 0. */
function nodeOk(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, env: env(), encoding: 'utf8', timeout: TIMEOUT, killSignal: 'SIGKILL' });
  return r.status === 0;
}

/** Copies hidden file `rel` (relative to the hidden dir `hid`) into `dir` at the same path. */
function place(hid, rel, dir) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.copyFileSync(path.join(hid, rel), path.join(dir, rel));
}

/** The merge commits on main's first-parent line since `base`, oldest first, with the merged branch's own changes. */
function workerMerges(root, base, main) {
  const head = tryGit(root, ['rev-parse', '--verify', `refs/heads/${main}`]);
  if (!head) return [];
  if (spawnSync('git', ['merge-base', '--is-ancestor', base, head], { cwd: root, env: env() }).status !== 0) return [];
  return lines(git(root, ['rev-list', '--first-parent', '--merges', '--reverse', `${base}..${head}`])).map((merge) => {
    const [first, tip] = lines(git(root, ['rev-list', '--parents', '-n', '1', merge])).join(' ').split(/\s+/).slice(1);
    const fork = git(root, ['merge-base', first, tip]);
    const files = lines(git(root, ['diff', '--name-only', fork, tip]));
    return { merge, first, tip, fork, files };
  });
}

function workTests(test, spec) {
  const root = spec.root;
  const hid = spec.hiddenDir || root;
  const main = spec.main || 'main';
  const suite = spec.suite || ['--test', 'test/*.test.js'];
  const tickets = spec.tickets;
  const owned = (t, f) => t.files.includes(f);
  let merges = null;
  const allMerges = () => (merges ??= workerMerges(root, spec.base, main));
  const workerOf = (t) => allMerges().find((m) => m.files.some((f) => owned(t, f)));
  const needWorkers = () => assert.ok(allMerges().length, `no merge commit on ${main} since the fixture: the tickets were not done on worker branches and merged`);
  const needAll = () => {
    needWorkers();
    const missing = tickets.filter((t) => !workerOf(t)).map((t) => t.id);
    assert.deepEqual(missing, [], `tickets with no merged worker branch: ${missing.join(', ')}`);
  };
  const passesAt = (sha, rel) => {
    const dir = snapshot(root, sha);
    try { place(hid, rel, dir); return nodeOk(dir, ['--test', rel]); } finally { drop(dir); }
  };
  const opts = { timeout: 120000 };

  for (const t of tickets) {
    test(`${t.id}: fixed on ${main}`, opts, () => {
      needWorkers();
      const sha = git(root, ['rev-parse', `refs/heads/${main}`]);
      assert.ok(passesAt(sha, t.test), `${t.id}'s hidden test fails on ${main}`);
    });
    test(`${t.id}: done on its own worker branch and merged`, opts, () => {
      needWorkers();
      const m = workerOf(t);
      assert.ok(m, `no merged branch changes ${t.id}'s files (${t.files.join(', ')})`);
      const others = tickets.filter((o) => o !== t).flatMap((o) => o.files).filter((f) => m.files.includes(f));
      assert.deepEqual(others, [], `${t.id}'s branch also changes another ticket's files`);
      assert.equal(tickets.filter((o) => workerOf(o) === m).length, 1, `${t.id} shares its merge with another ticket`);
      assert.ok(passesAt(m.tip, t.test), `${t.id}'s hidden test fails on its own branch`);
    });
    test(`${t.id}: a regression test that fails without the fix`, opts, () => {
      needWorkers();
      const m = workerOf(t);
      assert.ok(m, `no merged branch for ${t.id}`);
      const tests = m.files.filter((f) => /^test\/.*\.test\.js$/.test(f));
      assert.ok(tests.length, `${t.id}'s branch adds or changes no test under test/`);
      const atTip = snapshot(root, m.tip);
      const atFork = snapshot(root, m.fork);
      try {
        assert.ok(nodeOk(atTip, ['--test', ...tests]), `${t.id}'s tests fail on its own branch`);
        // the branch's test files laid over the code the branch started from
        for (const f of tests) { fs.mkdirSync(path.dirname(path.join(atFork, f)), { recursive: true }); fs.copyFileSync(path.join(atTip, f), path.join(atFork, f)); }
        assert.ok(!nodeOk(atFork, ['--test', ...tests]), `${t.id}'s tests also pass without the fix`);
      } finally { drop(atTip); drop(atFork); }
    });
  }
  test(`${main} is green after every merge`, opts, () => {
    needAll();
    for (const m of allMerges()) {
      const dir = snapshot(root, m.merge);
      try { assert.ok(nodeOk(dir, suite), `the suite fails at merge ${m.merge.slice(0, 8)}`); } finally { drop(dir); }
    }
  });
  for (const x of spec.extra || []) {
    test(x.name, opts, () => {
      needAll();
      assert.ok(passesAt(git(root, ['rev-parse', `refs/heads/${main}`]), x.test), `${x.name}: fails on ${main}`);
    });
  }
  test('clean-up: no extra worktree or worker branch, main checked out, clean tree', opts, () => {
    needAll();
    const wt = path.join(root, '.git', 'worktrees');
    const left = fs.existsSync(wt) ? fs.readdirSync(wt) : [];
    assert.deepEqual(left, [], `worktrees left: ${left.join(', ')}`);
    const branches = lines(git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).filter((b) => b !== main);
    assert.deepEqual(branches, [], `branches left: ${branches.join(', ')}`);
    assert.equal(git(root, ['symbolic-ref', '--short', 'HEAD']), main);
    const skip = (spec.hidden || []).map((h) => h.replace(/\/$/, ''));
    const dirty = lines(git(root, ['status', '--porcelain', '--untracked-files=all'])).map((l) => l.slice(3))
      .filter((p) => !skip.some((h) => p === h || p.startsWith(`${h}/`)));
    assert.deepEqual(dirty, [], `working tree not clean: ${dirty.slice(0, 5).join(', ')}`);
  });
}

module.exports = { workTests, workerMerges, snapshot };
