// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scripts/pilot-2x2.sh with a fake bench runner, a fake aws and a fake claude: no network, no cloud credentials,
// no model call. Checks the plan, the argument rules, resume, credential handling and cleanup.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { makeFakeClaude } = require('./fake-claude.js');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'pilot-2x2.sh');
const FAKE_BENCH = path.join(__dirname, 'fake-pilot-bench.js');
const SECRET = 'fakeSecretValueNotReal0123456789abcdefgh';
const TOKEN = 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==';
const KEY_ID = 'AK' + 'IATESTTESTTEST1234';

const FAKE_AWS = `#!/bin/sh
DIR="$(dirname "$0")"
MODE="$(cat "$DIR/fake-aws.mode" 2>/dev/null)"
echo "$1 $2" >> "$DIR/aws.log"
case "$1 $2" in
  "configure export-credentials")
    N=$(( $(cat "$DIR/export-count" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$DIR/export-count"
    case " $MODE " in
      *" fail-first "*) [ "$N" -gt 1 ] || { echo "the SSO session has expired" >&2; exit 255; } ;;
      *" fail-always "*) echo "the SSO session has expired" >&2; exit 255 ;;
      *" fail-first-key "*) [ "$N" -gt 1 ] || { echo "bad key ${KEY_ID} for profile good" >&2; exit 255; } ;;
    esac
    [ "$3" = "--profile" ] && [ "$4" = "good" ] || { echo "profile not found" >&2; exit 255; }
    echo "export AWS_ACCESS_KEY_ID=${KEY_ID}"
    echo "export AWS_SECRET_ACCESS_KEY=${SECRET}"
    echo "export AWS_SESSION_TOKEN=${TOKEN}"
    ;;
  "sts get-caller-identity")
    [ -n "$AWS_ACCESS_KEY_ID" ] && [ -z "$AWS_PROFILE" ] || exit 255
    echo "123456789012"
    ;;
  *) exit 2 ;;
esac
`;

function setup() {
  const root = tmp();
  const dirs = { scratch: path.join(root, 'scratch'), claudeTmp: path.join(root, 'claude-tmp'), probe: path.join(root, 'probe'), home: path.join(root, 'home'), bin: path.join(root, 'bin') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const claude = makeFakeClaude(path.join(root, 'tools'), { dir: dirs.probe, streamFile: path.join(__dirname, 'fixtures', 'claude-code', 'vanilla-success.stream.jsonl') });
  write(path.join(dirs.bin, 'aws'), FAKE_AWS);
  write(path.join(dirs.bin, 'opencode'), '#!/bin/sh\nexit 0\n');
  write(path.join(dirs.bin, 'kiro-cli'), '#!/bin/sh\nexit 0\n');
  for (const f of ['aws', 'opencode', 'kiro-cli']) fs.chmodSync(path.join(dirs.bin, f), 0o755);
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const log = path.join(root, 'bench-calls.jsonl');
  fs.writeFileSync(log, '');
  const out = path.join(root, 'pilot-out');
  const s = { root, ...dirs, claude, authDb, log, out };
  s.calls = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  s.awsMode = (m) => { fs.writeFileSync(path.join(dirs.bin, 'fake-aws.mode'), m); fs.rmSync(path.join(dirs.bin, 'export-count'), { force: true }); };
  s.awsLog = () => (fs.existsSync(path.join(dirs.bin, 'aws.log')) ? fs.readFileSync(path.join(dirs.bin, 'aws.log'), 'utf8') : '');
  return s;
}

const BASE = (s) => ['--out', s.out, '--tasks', 't1,t2', '--konductor-ref', 'HEAD', '--claude-bin', s.claude, '--auth-db', s.authDb];
const FULL = (s) => [...BASE(s), '--profile', 'good', '--budget-usd', '10', '--kiro-credit-limit', '15'];

function run(s, args, env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8', timeout: 120000,
    env: {
      PATH: `${s.bin}:${process.env.PATH}`, HOME: s.home, TMPDIR: process.env.TMPDIR,
      PILOT_BENCH_JS: FAKE_BENCH, PILOT_FAKE_LOG: s.log, PILOT_SCRATCH_ROOT: s.scratch, PILOT_CLAUDE_TMP_BASE: s.claudeTmp,
      PILOT_PROC_PATTERN: 'pilot-2x2-no-such-process', PILOT_MIN_FREE_GB: '1', ...env,
    },
  });
}
const noSecrets = (r) => { for (const v of [SECRET, TOKEN, KEY_ID]) { assert.equal(r.stdout.includes(v), false, 'stdout'); assert.equal(r.stderr.includes(v), false, 'stderr'); } };
const grepTree = (dir, needles) => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const t = fs.readFileSync(p, 'utf8'); if (needles.some((n) => t.includes(n))) hits.push(p); } } };
  walk(dir);
  return hits;
};
const label = (c) => `${c.args[c.args.indexOf('--arms') + 1].split('=')[0]}/${c.args[c.args.indexOf('--tasks') + 1]}`;

test('--dry-run prints the plan and the exact commands, reads no credentials and starts and writes nothing', () => {
  const s = setup();
  const r = run(s, [...FULL(s), '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /dry run: no credentials are read, no network is used and nothing is started/);
  for (const re of [/PASS {2}disk:/, /PASS {2}no other bench runner process/, /PASS {2}claude 9\.9\.9/, /PASS {2}kiro-cli found/, /PASS {2}kiro-cli login database present/, /PASS {2}opencode \(judge runner\) found/, /PASS {2}konductor commit [0-9a-f]{12} resolved/]) assert.match(r.stdout, re);
  assert.match(r.stdout, /2 runs per cell, 8 in all/);
  assert.match(r.stdout, /--arms vanilla .*--model claude-sonnet-5\.5 --agent-engine v3 --run-credit-limit 15 --auth-db /);
  const sha = /--arms konductor=([0-9a-f]{40})/.exec(r.stdout)[1];
  assert.match(r.stdout, new RegExp(`--arms cc-konductor=${sha}`));
  assert.match(r.stdout, /--arms cc-vanilla .*--model us\.anthropic\.claude-sonnet-5-5 --budget-usd <remaining> --run-budget-usd 1\.5 --aws-region us-east-1/);
  assert.match(r.stdout, /judge --run \S+cells\/kiro-vanilla\/t1 --judge-backend opencode --judges gpt-5\.6-luna,deepseek-3\.2,glm-5 --mode rubric/);
  assert.match(r.stdout, /report-2x2 --out \S+report --kiro-vanilla \S+kiro-vanilla\/t1,\S+kiro-vanilla\/t2 --kiro-konductor/);
  assert.match(r.stdout, /ceilings: \$10 for Claude Code runs plus judging \(\$9\.00 for runs/);
  assert.match(r.stdout, /worst case, Kiro runs: 4 runs x 15 credits = 60\.0 credits/);
  assert.match(r.stdout, /unmeasured/);
  assert.equal(s.awsLog(), '', 'aws was not called');
  assert.deepEqual(s.calls(), []);
  assert.equal(fs.existsSync(s.out), false);
  assert.deepEqual(fs.readdirSync(s.scratch), []);
  noSecrets(r);
});

test('--dry-run fails the preflight when a tool is missing, and says what to pass', () => {
  const s = setup();
  const r = run(s, [...BASE(s), '--budget-usd', '5', '--kiro-credit-limit', '9', '--dry-run', '--claude-bin', path.join(s.root, 'no-claude'), '--auth-db', path.join(s.root, 'missing.db')]);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /FAIL {2}no usable claude binary/);
  assert.match(r.stdout, /FAIL {2}no kiro-cli login database/);
  assert.match(r.stderr, /preflight failed; nothing was run/);
});

test('budgets have no default: each cell group needs the ceiling it spends against', () => {
  const s = setup();
  const need = (args, re) => { const r = run(s, args); assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, re); assert.deepEqual(s.calls(), []); };
  need([...BASE(s), '--profile', 'good', '--kiro-credit-limit', '15'], /--budget-usd is required for --cells all/);
  need([...BASE(s), '--profile', 'good', '--budget-usd', '10'], /--kiro-credit-limit is required for --cells all/);
  need([...BASE(s), '--cells', 'cc', '--profile', 'good'], /--budget-usd is required for --cells cc/);
  need([...BASE(s), '--cells', 'judge', '--profile', 'good'], /--budget-usd is required for --cells judge/);
  need([...BASE(s), '--cells', 'kiro'], /--kiro-credit-limit is required for --cells kiro/);
  need([...FULL(s), '--budget-usd', '0'], /--budget-usd must be a positive number/);
  need([...FULL(s), '--kiro-credit-limit', 'lots'], /--kiro-credit-limit must be a positive number/);
  need([...FULL(s), '--run-budget-usd', '-1'], /--run-budget-usd must be a positive number/);
  need([...FULL(s), '--reps', '0'], /--reps must be a positive integer/);
  need([...FULL(s), '--tasks', 't1,t1'], /lists a task twice/);
  need([...FULL(s), '--tasks', 'T 1'], /is not a task id/);
  need([...FULL(s), '--cells', 'everything'], /--cells takes/);
  need([...FULL(s), '--konductor-ref', 'no-such-ref-zzz'], /is not a commit/);
  need([...FULL(s), '--arm', 'x'], /unknown option: --arm/);
  need(['--profile', 'good'], /--out DIR is required/);
});

test('the report step needs no budget and no credentials', () => {
  const s = setup();
  const r = run(s, [...BASE(s), '--cells', 'report', '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /report-2x2/);
  assert.doesNotMatch(r.stdout, /judge --run/);
});

test('an --out with other files, or inside an earlier pilot output, is refused, dry run included', () => {
  const s = setup();
  fs.mkdirSync(s.out);
  fs.writeFileSync(path.join(s.out, 'notes.txt'), 'x');
  for (const extra of [[], ['--dry-run']]) {
    const r = run(s, [...FULL(s), ...extra]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /not empty and is not the output of an earlier pilot-2x2 run/);
  }
  assert.deepEqual(s.calls(), []);
  assert.equal(s.awsLog(), '');
  const fresh = path.join(s.root, 'second');
  const ok = run(s, [...FULL(s).map((a) => (a === s.out ? fresh : a)), '--cells', 'kiro']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const nested = path.join(fresh, 'inner');
  const r = run(s, [...FULL(s).map((a) => (a === s.out ? nested : a)), '--cells', 'kiro']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is inside the pilot output/);
});

test('an --out inside the checkout is refused', () => {
  const s = setup();
  const r = run(s, [...FULL(s).map((a) => (a === s.out ? path.join(path.dirname(SCRIPT), 'out-here') : a)), '--dry-run']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out must be outside the checkout/);
});

test('a full run goes Kiro vanilla, Kiro konductor, Claude Code vanilla, Claude Code konductor, judging, then the table, and leaves no secret and no scratch', () => {
  const s = setup();
  const r = run(s, FULL(s));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = s.calls();
  const runs = calls.filter((c) => c.cmd === 'run');
  assert.deepEqual(runs.map(label), ['vanilla/t1', 'vanilla/t2', 'konductor/t1', 'konductor/t2', 'cc-vanilla/t1', 'cc-vanilla/t2', 'cc-konductor/t1', 'cc-konductor/t2']);
  const order = calls.map((c) => c.cmd);
  assert.deepEqual([order.indexOf('run'), order.indexOf('judge'), order.indexOf('report-2x2')].every((x, i, a) => i === 0 || x > a[i - 1]), true);
  assert.equal(order.filter((c) => c === 'judge').length, 8);
  assert.equal(order.at(-1), 'report-2x2');
  const arg = (c, name) => c.args[c.args.indexOf(name) + 1];
  assert.equal(arg(runs[0], '--run-credit-limit'), '15');
  assert.equal(arg(runs[0], '--replicates'), '1');
  assert.deepEqual(runs.slice(0, 4).map((c) => c.awsKeysInEnv.length), [0, 0, 0, 0], 'Kiro runs get no AWS keys');
  assert.deepEqual(runs.slice(4).map((c) => c.awsKeysInEnv.length), [3, 3, 3, 3]);
  assert.ok(runs.every((c) => c.profileVarsInEnv.length === 0));
  assert.deepEqual(runs.slice(4).map((c) => arg(c, '--budget-usd')), ['9.0000', '8.9000', '8.8000', '8.7000'], 'each Claude Code call gets what is left of the 90% share');
  assert.equal(arg(runs[2], '--arms'), arg(runs[0], '--arms').replace('vanilla', 'konductor=') + /[0-9a-f]{40}/.exec(arg(runs[2], '--arms'))[0]);
  assert.equal(arg(runs[2], '--arms').split('=')[1], arg(runs[6], '--arms').split('=')[1], 'the same commit in both harnesses');
  const judges = calls.filter((c) => c.cmd === 'judge');
  assert.ok(judges.every((c) => c.credsFile.exists && c.credsFile.mode === '600' && c.credsFile.hasKeyId && c.awsKeysInEnv.length === 0));
  assert.ok(judges.every((c) => arg(c, '--judges') === 'gpt-5.6-luna,deepseek-3.2,glm-5' && arg(c, '--mode') === 'rubric' && arg(c, '--judge-backend') === 'opencode'));
  assert.ok(judges.every((c) => c.home.startsWith(s.scratch) && c.tmpdir.startsWith(s.scratch)), 'judging runs in a scratch HOME and a scratch TMPDIR');
  assert.match(r.stdout, /== spend ==/);
  assert.match(r.stdout, /\| cc-vanilla \| 2 \| USD 0\.200 \| 0\.100 \|/);
  assert.match(r.stdout, /\| kiro-konductor \| 2 \| 4\.00 credits \| 0\.100 \|/);
  assert.match(r.stdout, /Table: \S+report\/factorial-2x2\.md/);
  assert.ok(fs.existsSync(path.join(s.out, 'report', 'factorial-2x2.md')));
  assert.deepEqual(fs.readdirSync(s.scratch), []);
  assert.deepEqual(fs.readdirSync(s.claudeTmp), []);
  noSecrets(r);
  assert.deepEqual(grepTree(s.out, [SECRET, TOKEN, KEY_ID]), []);
});

test('a rerun with the same --out skips finished and judged work and only rebuilds the table', () => {
  const s = setup();
  assert.equal(run(s, FULL(s)).status, 0);
  const before = s.calls().length;
  const r = run(s, FULL(s));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /kiro-vanilla\/t1: already finished, skipped/);
  assert.match(r.stdout, /cc-konductor\/t2: already judged, skipped/);
  assert.deepEqual(s.calls().slice(before).map((c) => c.cmd), ['report-2x2']);
});

test('a failed task is reported, the other tasks still run, and the rerun redoes only that one and keeps the unfinished directory', () => {
  const s = setup();
  const first = run(s, FULL(s), { PILOT_FAKE_MODE: 'partial:cc-vanilla:t2 fail:konductor:t1' });
  assert.equal(first.status, 1, first.stdout + first.stderr);
  assert.match(first.stdout, /NOT DONE:/);
  assert.match(first.stdout, /kiro-konductor\/t1: bench\.js exited nonzero/);
  assert.match(first.stdout, /cc-vanilla\/t2: bench\.js exited nonzero/);
  assert.match(first.stdout, /cc-vanilla\/t2: not judged, the run is interrupted/);
  assert.match(first.stdout, /the table needs every cell finished and judged/);
  const before = s.calls().length;
  const again = run(s, FULL(s));
  assert.equal(again.status, 0, again.stdout + again.stderr);
  const after = s.calls().slice(before);
  assert.deepEqual(after.filter((c) => c.cmd === 'run').map(label), ['konductor/t1', 'cc-vanilla/t2']);
  assert.equal(after.filter((c) => c.cmd === 'judge').length, 2);
  const moved = fs.readdirSync(path.join(s.out, 'incomplete'));
  assert.equal(moved.length, 1);
  assert.match(moved[0], /^cc-vanilla-t2-\d{8}T\d{6}Z$/);
});

test('--cells kiro touches no AWS credentials and starts no Claude Code or judge call', () => {
  const s = setup();
  const r = run(s, [...BASE(s), '--kiro-credit-limit', '15', '--cells', 'kiro']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(s.awsLog(), '');
  assert.deepEqual(s.calls().map(label), ['vanilla/t1', 'vanilla/t2', 'konductor/t1', 'konductor/t2']);
});

test('the Claude Code allowance stops new runs once spent, and says how to continue', () => {
  const s = setup();
  const r = run(s, [...BASE(s), '--profile', 'good', '--budget-usd', '0.5', '--cells', 'cc'], { PILOT_FAKE_MODE: 'cost:0.3' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(s.calls().map(label), ['cc-vanilla/t1', 'cc-vanilla/t2']);
  assert.match(r.stdout, /cc-vanilla\/t2: the Claude Code allowance is used up|cc-konductor\/t1: the Claude Code allowance is used up/);
  assert.match(r.stdout, /rerun with a higher --budget-usd/);
});

test('an expired credential stops the run before anything starts, with a redacted reason; --refresh-cmd retries once', () => {
  const s = setup();
  s.awsMode('fail-always');
  const dead = run(s, [...FULL(s), '--cells', 'cc']);
  assert.equal(dead.status, 2, dead.stdout + dead.stderr);
  assert.match(dead.stderr, /export-credentials failed: the SSO session has expired/);
  assert.match(dead.stderr, /--refresh-cmd CMD can refresh and retry once/);
  assert.deepEqual(s.calls(), []);
  s.awsMode('fail-first');
  const marker = path.join(s.root, 'refreshed');
  const ok = run(s, [...BASE(s), '--profile', 'good', '--budget-usd', '10', '--cells', 'cc', '--refresh-cmd', `echo x >> '${marker}'`]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'x\n', 'the refresh command ran once');
  s.awsMode('fail-first-key');
  const keyed = run(s, [...BASE(s), '--profile', 'good', '--budget-usd', '10', '--cells', 'cc', '--out', path.join(s.root, 'o3')]);
  assert.equal(keyed.status, 2);
  assert.match(keyed.stderr, /bad key \[redacted\]/);
  noSecrets(keyed);
});

test('no credential source at all is a usage error, and a wrong account is refused', () => {
  const s = setup();
  const none = run(s, [...BASE(s), '--budget-usd', '10', '--cells', 'cc']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no credentials: pass --profile NAME/);
  const wrong = run(s, [...FULL(s), '--cells', 'cc', '--account', '999999999999']);
  assert.equal(wrong.status, 2, wrong.stdout + wrong.stderr);
  assert.match(wrong.stdout, /FAIL credential preflight.*\*\*\*\*9012, expected \*\*\*\*9999/);
  assert.deepEqual(s.calls(), []);
  noSecrets(wrong);
});

test('SIGTERM during a run still removes the scratch directory', () => {
  const s = setup();
  const r = spawnSync('bash', [SCRIPT, ...BASE(s), '--kiro-credit-limit', '15', '--cells', 'kiro'], {
    encoding: 'utf8', timeout: 800, killSignal: 'SIGTERM',
    env: { PATH: `${s.bin}:${process.env.PATH}`, HOME: s.home, TMPDIR: process.env.TMPDIR, PILOT_BENCH_JS: FAKE_BENCH, PILOT_FAKE_LOG: s.log, PILOT_FAKE_MODE: 'sleep:1500', PILOT_SCRATCH_ROOT: s.scratch, PILOT_CLAUDE_TMP_BASE: s.claudeTmp, PILOT_PROC_PATTERN: 'pilot-2x2-no-such-process', PILOT_MIN_FREE_GB: '1' },
  });
  assert.notEqual(r.status, 0);
  assert.deepEqual(fs.readdirSync(s.scratch), []);
});
