'use strict';

// Hidden test of the work in t12-parallel-backlog: the plan must be carried out as isolated packages and merged in the
// plan's order. It reads only deliverables (the plan's JSON block, work/<package>/, docs/plan/merge-log.md and the
// repository after the merges), never a session label or a tool log.
//   work/<P>/        the repository files package P changes or adds, as they are after P, plus REPORT.md
//   .bench-base/     the untouched fixture, copied in by the tests check (.bench-lib.json "@pristine"), so the
//                    merges can be replayed one at a time
// Every test needs the plan's block (no plan, no credit) and counts twice: the work is the larger part of the task.
// The process helpers (files, node, withTemp) are bench/scenarios/lib/hidden/work-kit.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock } = require('./block-kit/block-key.js');
const { files, node, withTemp: tempDir } = require('./work-kit.js');

const root = __dirname;
const BASE = path.join(root, '.bench-base');
const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
const plan = readBlock(read('docs/plan/release-plan.md') || '');
const packages = Array.isArray(plan?.packages) ? plan.packages.filter((p) => p && typeof p.id === 'string') : [];
const mergeOrder = Array.isArray(plan?.mergeOrder) ? plan.mergeOrder.map(String) : [];
const SAFE_ID = /^[\w.-]+$/;
// The repository's own suite. Node 22 and later take globs, not a directory, so `node --test test/` fails there.
const SUITE = 'test/**/*.test.js';
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ZERO_FAIL = /\b0\s*(fail|failed|failing|failures)\b|\bfail(s|ed|ures?)?\W{0,3}0\b/i;
const SOME_PASS = /\b\d+\s*(pass|passed|passing)\b|\bpass(es|ed)?\W{0,3}\d+/i;

const workFiles = (id) => files(path.join(root, 'work', id)).filter((f) => f !== 'REPORT.md');

const withTemp = (fn) => tempDir('t12-work', fn);

// A copy of the repository's code (src, test, config, package.json) in `dir`.
function copyCode(dir) {
  for (const p of ['src', 'test', 'config', 'package.json']) {
    if (fs.existsSync(path.join(root, p))) fs.cpSync(path.join(root, p), path.join(dir, p), { recursive: true });
  }
}

// Runs `js` in a fresh node process in `cwd` and returns its trimmed stdout (or throws with its stderr).
function evalIn(cwd, js) {
  const r = node(['-e', js], cwd);
  if (r.status !== 0) throw new Error(`node -e failed: ${(r.stderr || '').slice(0, 400)}`);
  return r.stdout.trim();
}

const work = (name, fn) => {
  for (const n of [1, 2]) {
    test(`${name} #${n}`, () => {
      assert.ok(plan, 'no JSON block in docs/plan/release-plan.md');
      assert.ok(packages.length && mergeOrder.length, 'the plan has no packages or no mergeOrder');
      assert.ok(files(path.join(root, 'work')).length, 'work/ holds no package work: the plan was not carried out');
      fn();
    });
  }
};

// The package that holds backlog item `item`, or null.
const holder = (item) => packages.find((p) => Array.isArray(p.items) && p.items.map(String).includes(item)) || null;

work('each package was done in its own folder with only its own files', () => {
  for (const p of packages) {
    assert.match(p.id, SAFE_ID, `package id ${p.id} is not a folder name`);
    const got = workFiles(p.id);
    assert.ok(got.length, `work/${p.id}/ holds no changed file`);
    const allowed = (Array.isArray(p.files) ? p.files : []).map(norm);
    const stray = got.filter((f) => !allowed.some((a) => a === f || (a.endsWith('/') && f.startsWith(a))));
    assert.deepEqual(stray, [], `work/${p.id}/ holds files outside the package's files list`);
  }
  const extra = files(path.join(root, 'work')).map((f) => f.split('/')[0]).filter((d) => !packages.some((p) => p.id === d));
  assert.deepEqual([...new Set(extra)], [], 'work/ holds folders that are not packages of the plan');
});

work('each package reports the check it ran and its result', () => {
  for (const p of packages) {
    const report = read(`work/${p.id}/REPORT.md`);
    assert.ok(report, `work/${p.id}/REPORT.md is missing`);
    assert.match(report, /node --test/, `work/${p.id}/REPORT.md names no node --test run`);
    assert.match(report, SOME_PASS, `work/${p.id}/REPORT.md gives no pass count`);
    assert.match(report, ZERO_FAIL, `work/${p.id}/REPORT.md does not show 0 failures`);
  }
});

work('every merge, replayed in the plan order from the original code, leaves the tests green', () => {
  assert.deepEqual([...mergeOrder].sort(), packages.map((p) => p.id).sort(), 'mergeOrder must list every package once');
  withTemp((dir) => {
    fs.cpSync(BASE, dir, { recursive: true });
    for (const id of mergeOrder) {
      for (const f of workFiles(id)) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.copyFileSync(path.join(root, 'work', id, f), path.join(dir, f));
      }
      const r = node(['--test', SUITE], dir);
      assert.equal(r.status, 0, `after merging ${id} the tests fail: ${(r.stdout || '').split('\n').filter((l) => /^not ok/.test(l)).join('; ').slice(0, 300)}`);
    }
  });
});

work('the repository holds what the packages built, merged in the plan order', () => {
  const last = new Map();
  for (const id of mergeOrder) for (const f of workFiles(id)) last.set(f, id);
  assert.ok(last.size, 'no package file to merge');
  for (const [f, id] of last) {
    assert.equal(read(f), fs.readFileSync(path.join(root, 'work', id, f), 'utf8'), `${f} in the repository is not the version of ${id}, the last package in mergeOrder that changes it`);
  }
});

work('the merge log lists every merge in the plan order, each with the tests green', () => {
  const log = read('docs/plan/merge-log.md');
  assert.ok(log, 'docs/plan/merge-log.md is missing');
  const lines = log.split('\n');
  const at = mergeOrder.map((id) => lines.findIndex((l) => new RegExp(`(^|[^\\w.-])${esc(id)}([^\\w.-]|$)`).test(l)));
  assert.ok(at.every((i) => i >= 0), `the merge log misses ${mergeOrder.filter((_, k) => at[k] < 0).join(', ')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the merge log order differs from the plan mergeOrder');
  for (const i of at) assert.match(lines[i], ZERO_FAIL, `merge log line "${lines[i].trim()}" does not show 0 failures`);
});

work('the merge order respects what the code shares (A1 not after A2, A5 before A4)', () => {
  const pos = (item) => { const p = holder(item); return p ? mergeOrder.indexOf(p.id) : -1; };
  for (const it of ['A1', 'A2', 'A4', 'A5']) assert.ok(pos(it) >= 0, `${it} is in no merged package`);
  assert.ok(pos('A1') <= pos('A2'), 'the A2 package merges before the A1 package');
  assert.ok(pos('A5') < pos('A4'), 'the A4 package does not merge after the A5 package');
});

// The outcome of the release, on the repository after the merges.
work('A1 and A2: invoices carry a currency, EUR for old records, shown as the last CSV column', () => {
  const out = JSON.parse(evalIn(root, `
    const { validate } = require('./src/models/invoice');
    const { toCsv } = require('./src/export/csv');
    const old = { id: 'I-9', customer: 'Ada', amountCents: 5, issuedOn: '2026-11-02' };
    console.log(JSON.stringify({ old: validate(old).currency, nzd: validate({ ...old, currency: 'NZD' }).currency, csv: toCsv([old]) }));`));
  assert.equal(out.old, 'EUR');
  assert.equal(out.nzd, 'NZD');
  const [header, row] = out.csv.split('\n');
  assert.equal(header, 'id,customer,amountCents,issuedOn,currency');
  assert.equal(row, 'I-9,Ada,5,2026-11-02,EUR');
});

work('A5: the settings are read from config/app.json', () => withTemp((dir) => {
  copyCode(dir);
  assert.ok(fs.existsSync(path.join(dir, 'config/app.json')), 'config/app.json is missing');
  fs.rmSync(path.join(dir, 'config/app.ini'), { force: true });
  const out = JSON.parse(evalIn(dir, "const c = require('./src/config'); console.log(JSON.stringify([c.get('session.ttlMinutes'), c.get('export.delimiter')]))"));
  assert.equal(Number(out[0]), 30);
  assert.equal(out[1], ',');
}));

work('A5: the loader still reads config/app.ini when app.json is missing', () => withTemp((dir) => {
  copyCode(dir);
  assert.ok(fs.existsSync(path.join(dir, 'config/app.json')), 'config/app.json is missing, so nothing was moved');
  fs.rmSync(path.join(dir, 'config/app.json'), { force: true });
  fs.writeFileSync(path.join(dir, 'config/app.ini'), 'session.ttlMinutes = 30\nexport.delimiter = ,\n');
  const out = JSON.parse(evalIn(dir, "const c = require('./src/config'); console.log(JSON.stringify([c.get('session.ttlMinutes'), c.get('export.delimiter')]))"));
  assert.equal(Number(out[0]), 30);
  assert.equal(out[1], ',');
}));

const attempts = (fails) => `
  const { login } = require('./src/auth/login');
  for (let i = 0; i < ${fails}; i++) login('ana@example.test', 'wrong');
  console.log(JSON.stringify(login('ana@example.test', 'pw-ana').ok));`;

work('A4: by default the sixth login after five failures in a minute is refused; after four it is not', () => {
  assert.equal(JSON.parse(evalIn(root, attempts(4))), true, 'four failures already block the account');
  assert.equal(JSON.parse(evalIn(root, attempts(5))), false, 'five failures do not block the next attempt');
});

// The setting that holds 5 under a key that names login, auth, attempts or failures, at any depth of config/app.json:
// [object, key] or null. The backlog fixes no key name (a gpt-5.6-luna recheck found `login` alone too narrow).
function loginSetting(obj, trail = '') {
  for (const [k, v] of Object.entries(obj || {})) {
    const t = `${trail}.${k}`;
    if (v && typeof v === 'object') { const hit = loginSetting(v, t); if (hit) return hit; } else if (/login|auth|attempt|fail/i.test(t) && Number(v) === 5) return [obj, k];
  }
  return null;
}

work('A4: the limit is a setting in config/app.json', () => withTemp((dir) => {
  copyCode(dir);
  const file = path.join(dir, 'config/app.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hit = loginSetting(cfg);
  assert.ok(hit, 'config/app.json has no login setting of 5');
  hit[0][hit[1]] = typeof hit[0][hit[1]] === 'string' ? '2' : 2;
  fs.writeFileSync(file, JSON.stringify(cfg));
  assert.equal(JSON.parse(evalIn(dir, attempts(2))), false, 'a limit of 2 in config/app.json does not block after two failures');
}));

work('A3 and A6: the help text names --since, and CI runs the suite under TZ=UTC and TZ=Europe/Berlin', () => {
  const help = evalIn(root, "process.stdout.write(require('./src/cli').HELP)");
  assert.match(help, /--since/);
  assert.doesNotMatch(help, /--from/);
  // The backlog asks for two runs, TZ=UTC and TZ=Europe/Berlin; any CI form that names both zones for the test step counts.
  const ci = read('.ci/pipeline.yml') || '';
  assert.match(ci, /\bTZ\b/);
  assert.match(ci, /node --test/);
  assert.match(ci, /\bUTC\b/);
  assert.match(ci, /Europe\/Berlin/);
});
