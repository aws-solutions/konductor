'use strict';

// Hidden test of t12-sop-route-choice: four requests in docs/inbox.md, each needing a different route (repair the
// live bug first, ship the agreed small change, write a spec and no code for the unsigned feature, review the patch
// without applying it). Every test reads only what is left in the repository: the commits on main since the fixture,
// the code, and the files at the paths CONTRIBUTING.md gives. Each route has two tests; a route's second test and the
// order and clean-up tests need that route's (or every route's) artifact, so leaving a route out earns nothing for it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshot } = require('./git-work.js');

const root = __dirname;
const BASE = '3ca4faa0299c7d881d1e9acdd6a8346df20283b6';
const HIDDEN = ['work.test.js', 'git-work.js', 'hidden-tests'];
const opts = { timeout: 120000 };

function env() {
  const { NODE_TEST_CONTEXT, ...rest } = process.env;
  return { ...rest, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}
const git = (...args) => {
  const r = spawnSync('git', args, { cwd: root, env: env(), encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').slice(0, 200)}`);
  return r.stdout.trim();
};
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const nodeOk = (cwd, args) => spawnSync(process.execPath, args, { cwd, env: env(), encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' }).status === 0;
const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
const drop = (d) => fs.rmSync(d, { recursive: true, force: true });

// The commits on main since the fixture, oldest first, each with the files it changed.
let cache = null;
function commits() {
  if (cache) return cache;
  const head = spawnSync('git', ['rev-parse', '--verify', 'refs/heads/main'], { cwd: root, env: env(), encoding: 'utf8' });
  const ok = head.status === 0 && spawnSync('git', ['merge-base', '--is-ancestor', BASE, 'refs/heads/main'], { cwd: root, env: env() }).status === 0;
  cache = ok ? lines(git('rev-list', '--reverse', '--no-merges', `${BASE}..refs/heads/main`)).map((sha) => ({ sha, files: lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', sha)) })) : [];
  return cache;
}
const needWork = () => assert.ok(commits().length, 'no commit on main since the fixture: no work was committed');
const touching = (pred) => commits().filter((c) => c.files.some(pred));

// What each route leaves behind.
const ROUTES = {
  repair: (f) => f === 'src/refund.js',
  change: (f) => f === 'src/summary.js',
  spec: (f) => f.startsWith('docs/specs/waitlist/'),
  review: (f) => f === 'docs/reviews/0001-overlap-check.md',
};
const SPEC = ['requirements.md', 'design.md', 'tasks.md'].map((n) => `docs/specs/waitlist/${n}`);
const REVIEW = 'docs/reviews/0001-overlap-check.md';
const hasRoute = {
  repair: () => touching(ROUTES.repair).length > 0,
  change: () => touching(ROUTES.change).length > 0,
  spec: () => SPEC.every((p) => read(p)),
  review: () => Boolean(read(REVIEW)),
};
const needAll = () => {
  needWork();
  const missing = Object.keys(hasRoute).filter((k) => !hasRoute[k]());
  assert.deepEqual(missing, [], `requests not handled: ${missing.join(', ')}`);
};

function passesHidden(rel) {
  const dir = snapshot(root, 'refs/heads/main');
  try {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
    return nodeOk(dir, ['--test', rel]);
  } finally { drop(dir); }
}

// The tests main adds or changes since the fixture catch the route's fix: they pass on main and fail on main with
// only the route's source file put back as it was in the fixture.
const SOURCE = { repair: 'src/refund.js', change: 'src/summary.js' };
function regression(route) {
  const tests = lines(git('diff', '--name-only', BASE, 'refs/heads/main')).filter((f) => /^test\/.*\.test\.js$/.test(f));
  assert.ok(tests.length, 'main adds or changes no test under test/');
  const atMain = snapshot(root, 'refs/heads/main');
  try {
    const caught = tests.filter((t) => nodeOk(atMain, ['--test', t]));
    fs.writeFileSync(path.join(atMain, SOURCE[route]), git('show', `${BASE}:${SOURCE[route]}`));
    const fails = caught.filter((t) => !nodeOk(atMain, ['--test', t]));
    assert.ok(fails.length, `no new test passes on main and fails with the old ${SOURCE[route]}`);
  } finally { drop(atMain); }
}

function block(text) {
  const all = [...String(text).matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (!all.length) return null;
  try { return JSON.parse(all[all.length - 1][1]); } catch { return null; }
}

test('repair: the refund follows the policy tiers on main', opts, () => {
  needWork();
  assert.ok(hasRoute.repair(), 'no commit changes src/refund.js');
  assert.ok(passesHidden('hidden-tests/refund.test.js'), 'refunds still break the policy');
});

test('repair: a regression test that fails on the old code', opts, () => {
  needWork();
  assert.ok(hasRoute.repair(), 'no commit changes src/refund.js');
  regression('repair');
});

test('agreed change: the summary has nights, on main', opts, () => {
  needWork();
  assert.ok(hasRoute.change(), 'no commit changes src/summary.js');
  assert.ok(passesHidden('hidden-tests/nights.test.js'), 'nights is missing or wrong');
});

test('agreed change: a test for it and its changelog line', opts, () => {
  needWork();
  assert.ok(hasRoute.change(), 'no commit changes src/summary.js');
  regression('change');
  const log = read('CHANGELOG.md') || '';
  const unreleased = (log.split(/^## /m).find((s) => s.startsWith('Unreleased')) || '');
  assert.match(unreleased, /BK-215/, 'no BK-215 line under ## Unreleased');
});

test('unsigned feature: a spec at docs/specs/waitlist/ with the agreed facts and the open question', opts, () => {
  needWork();
  const [req, design, tasks] = SPEC.map(read);
  assert.ok(req && design && tasks, `spec files missing: ${SPEC.filter((p) => !read(p)).join(', ')}`);
  assert.match(req, /\b5\b|\bfive\b/i, 'requirements miss the limit of 5 per room and date');
  assert.match(req, /\b2\s*-?\s*hours?\b|\btwo\s*-?\s*hours?\b|\b120\s*min/i, 'requirements miss the 2-hour offer');
  const open = req.split(/^#+\s.*open questions?.*$/im)[1] || '';
  assert.match(open, /loyalty|member/i, 'requirements end with no open question on loyalty members');
  assert.match(open, /Dana/i, 'the open question does not say who decides it');
  assert.ok((tasks.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length >= 3, 'tasks.md lists fewer than 3 tasks');
});

test('unsigned feature: no waitlist code before sign-off', opts, () => {
  needWork();
  assert.ok(hasRoute.spec(), 'no spec at docs/specs/waitlist/');
  const code = lines(git('diff', '--name-only', BASE, 'refs/heads/main')).filter((f) => /^(src|test)\//.test(f));
  const built = code.filter((f) => /waitlist|wait-list/i.test(f) || /waitlist|wait.?list/i.test(read(f) || ''));
  assert.deepEqual(built, [], `waitlist code written before sign-off: ${built.join(', ')}`);
});

test('patch review: a request-changes review naming the room and the back-to-back faults', opts, () => {
  needWork();
  const b = block(read(REVIEW) || '');
  assert.ok(b, `no json block in ${REVIEW}`);
  assert.match(String(b.verdict), /^request[- ]changes$/i, 'the verdict is not request-changes');
  const findings = Array.isArray(b.findings) ? b.findings : [];
  const text = findings.map((f) => `${f.file} ${f.problem}`);
  assert.ok(text.some((t) => /room/i.test(t)), 'no finding on the dropped room check');
  assert.ok(text.some((t) => /back[- ]to[- ]back|adjacent|touch|>=|<=|equal|same (time|instant|moment)|ends? (exactly )?(when|where|as)|end.{0,30}start/i.test(t)), 'no finding on back-to-back bookings now clashing');
});

test('patch review: the patch is not applied', opts, () => {
  needWork();
  assert.ok(hasRoute.review(), `no review at ${REVIEW}`);
  const changed = lines(git('diff', '--name-only', BASE, 'refs/heads/main')).filter((f) => f === 'src/overlap.js' || f.startsWith('patches/'));
  assert.deepEqual(changed, [], `the patch was applied or changed: ${changed.join(', ')}`);
});

test('order: the live bug is fixed first, each request in its own commits', opts, () => {
  needAll();
  const routesOf = (c) => Object.keys(ROUTES).filter((k) => c.files.some(ROUTES[k]));
  const first = commits().find((c) => routesOf(c).length);
  assert.deepEqual(routesOf(first), ['repair'], 'the first piece of work committed is not the refund fix');
  const mixed = commits().filter((c) => routesOf(c).length > 1);
  assert.deepEqual(mixed.map((c) => c.sha.slice(0, 8)), [], 'a commit mixes two requests');
});

test('main is green when each request is done', opts, () => {
  needAll();
  const done = Object.values(ROUTES).map((r) => touching(r).pop().sha);
  for (const sha of new Set([...done, commits()[commits().length - 1].sha])) {
    const dir = snapshot(root, sha);
    try { assert.ok(nodeOk(dir, ['--test', 'test/*.test.js']), `the suite fails at ${sha.slice(0, 8)}`); } finally { drop(dir); }
  }
});

test('clean-up: main checked out, everything committed', opts, () => {
  needAll();
  assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'main');
  const dirty = lines(git('status', '--porcelain', '--untracked-files=all')).map((l) => l.slice(3))
    .filter((p) => !HIDDEN.some((h) => p === h || p.startsWith(`${h}/`)));
  assert.deepEqual(dirty, [], `not committed: ${dirty.slice(0, 5).join(', ')}`);
});
