#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Helpers for claude-code-smoke.sh: find the claude binary, write the two tiny smoke tasks, check the credentials under
// claude's exact environment, and verify the two result directories. Credentials come from the process environment and
// are never printed.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LIB = path.join(__dirname, '..', 'runner', 'lib');
const cc = require(path.join(LIB, 'harness', 'claude-code.js'));
const { validateResult } = require(path.join(LIB, 'result.js'));

const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const out = (line) => process.stdout.write(`${line}\n`);

function resolve(args) {
  const r = cc.resolveClaude({ binOverride: flag(args, '--claude-bin') ?? undefined, toolsDir: flag(args, '--claude-tools-dir') ?? undefined });
  out(`${r.bin}\t${r.version}\t${r.supportsHookEvents ? 'hooks' : 'nohooks'}\t${r.sha256.slice(0, 12)}`);
}

const TASKS = [
  {
    id: 'smoke-hello', class: 'simple', target: null, fixture: 'smoke', timeoutSec: 240, tiers: ['lite'],
    prompt: 'Create a file named hello.txt in the current directory containing the single word hi. Then reply with the word done.',
    checks: [{ type: 'file_exists', path: 'hello.txt' }, { type: 'contains', path: 'hello.txt', pattern: 'hi' }],
    rubric: [{ id: 'creates-file', criterion: 'hello.txt exists and contains the word hi', weight: 1 }],
  },
  {
    id: 'smoke-delegate', class: 'simple', target: null, fixture: 'smoke', timeoutSec: 420, tiers: ['lite'],
    prompt: 'Delegate to the k-researcher agent: have it read hello.py in the current directory and give a one-sentence review of it. Then reply with that sentence only. Do not edit any file.',
    checks: [{ type: 'file_exists', path: 'hello.py' }],
    rubric: [{ id: 'reviews-file', criterion: 'the reply is a one-sentence review of hello.py', weight: 1 }],
  },
];

function makeBench(dir) {
  fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'suites'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'fixtures', 'smoke'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixtures', 'smoke', 'hello.py'), '"""Tiny greeting helper."""\n\n\ndef greet(name: str) -> str:\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    print(greet("world"))\n');
  for (const t of TASKS) fs.writeFileSync(path.join(dir, 'tasks', `${t.id}.json`), `${JSON.stringify(t, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'suites', 'lite.json'), `${JSON.stringify({ tasks: TASKS.map((t) => t.id), arms: ['cc-vanilla'], replicates: 1, parallel: 1 })}\n`);
  out(`bench dir ${dir}: ${TASKS.map((t) => t.id).join(', ')}`);
}

// aws sts get-caller-identity with the environment claude would get (scratch HOME, exported keys, no profile variables).
function preflight(args) {
  const region = flag(args, '--region') ?? cc.REGION;
  const account = flag(args, '--account');
  const { shadow } = cc.checkCredentials(process.env);
  const { env } = cc.envSetup({ arm: { vanilla: true }, ctx: { region }, home: flag(args, '--home'), tmpdir: flag(args, '--tmp') });
  let id;
  try {
    id = execFileSync('aws', ['sts', 'get-caller-identity', '--region', region, '--query', 'Account', '--output', 'text'], { env: { ...env, AWS_CLI_SESSION_ID_DISABLED: 'true' }, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    const why = e.code === 'ENOENT' ? 'the aws CLI is not on PATH' : `aws sts get-caller-identity failed (exit ${e.status ?? 'none'})`;
    out(`FAIL credential preflight under claude's environment: ${why}`);
    process.exit(1);
  }
  if (!/^\d{12}$/.test(id)) { out('FAIL credential preflight: no account id returned'); process.exit(1); }
  if (account && id !== account) { out(`FAIL credential preflight: the credentials resolve to account ****${id.slice(-4)}, expected ****${account.slice(-4)}`); process.exit(1); }
  out(`PASS credential preflight under claude's environment: account ****${id.slice(-4)}, region ${region}${shadow.length ? `; ${shadow.join(', ')} set here and not passed to claude` : ''}`);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const onlyRun = (dir) => {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else if (e.name === 'result.json') found.push(path.join(d, e.name)); } };
  walk(dir);
  return found.length === 1 ? found[0] : null;
};

function* filesUnder(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* filesUnder(p);
    else if (e.isFile()) yield p;
  }
}

function verify(args) {
  const kinds = [['vanilla', flag(args, '--vanilla')], ['konductor', flag(args, '--konductor')]].filter(([, d]) => d);
  const secrets = cc.secrets();
  let failed = 0;
  const report = (ok, text) => { out(`${ok ? 'PASS' : 'FAIL'}  ${text}`); if (!ok) failed++; };
  const honored = [];
  for (const [kind, dir] of kinds) {
    const file = fs.existsSync(dir) ? onlyRun(dir) : null;
    if (!file) { report(false, `${kind}: exactly one result.json under ${dir}`); continue; }
    let r;
    try { r = readJson(file); } catch { report(false, `${kind}: result.json parses`); continue; }
    report(true, `${kind}: result.json parses`);
    const problems = validateResult(r);
    report(problems.length === 0, `${kind}: result.json matches the schema${problems.length ? ` (${problems[0]})` : ''}`);
    report(r.status === 'success' && !r.infraError, `${kind}: run succeeded (status ${r.status}${r.infraError ? `, infra error: ${String(r.infraError).slice(0, 120)}` : ''}${r.error ? `, ${String(r.error).slice(0, 120)}` : ''})`);
    report(typeof r.costUsd === 'number' && r.costUsd > 0 && r.costCensored === false, `${kind}: cost > 0 and not censored (USD ${r.costUsd})`);
    const cfg = (() => { try { return readJson(path.join(dir, 'run-config.json')); } catch { return {}; } })();
    const canonical = cfg.canonicalModel ?? r.claudeCode?.canonicalModel ?? null;
    const seen = r.claudeCode?.modelsSeen ?? [];
    report(canonical !== null && seen.length === 1 && seen[0] === canonical && !(r.flags ?? []).includes('modelMismatch'), `${kind}: one canonical model (${seen.join(', ') || 'none'}; expected ${canonical})`);
    report((r.checks ?? []).length > 0 && r.checks.every((c) => c.passed), `${kind}: task checks passed`);
    if (kind === 'konductor') {
      report((r.claudeCode?.spawned ?? 0) >= 1 && (r.claudeCode?.spawnFailed ?? 1) === 0, `${kind}: delegated at least once, no failed spawn (spawned ${r.claudeCode?.spawned}, failed ${r.claudeCode?.spawnFailed})`);
      const delegated = (r.claudeCode?.spawned ?? 0) >= 1 && (r.claudeCode?.spawnFailed ?? 1) === 0;
      const mode = r.isolation ?? 'unknown';
      report(delegated, `${kind}: delegation worked under isolation: ${delegated ? 'yes' : 'no'} (isolation ${mode}${mode === 'none' ? ', so nothing was isolated' : ''}${delegated ? '' : '; if this fails here but passes with --isolate none, the isolation is the cause'})`);
      const log = (() => { try { return fs.readFileSync(path.join(path.dirname(file), 'install.log'), 'utf8'); } catch { return ''; } })();
      report(/agents \(11\)/.test(log) && /pin: model/.test(log), `${kind}: 11 agents installed, all pinned to the canonical model`);
    }
    if (r.claudeCode?.tmpCleanup) honored.push(r.claudeCode.tmpCleanup);
    let leaked = 0;
    for (const f of filesUnder(dir)) {
      let text;
      try { text = fs.statSync(f).size <= 16 * 1024 * 1024 ? fs.readFileSync(f, 'utf8') : ''; } catch { continue; }
      if (secrets.some((s) => text.includes(s))) leaked++;
    }
    report(leaked === 0, `${kind}: no credential value in any output file${leaked ? ` (${leaked} file(s))` : ''}`);
  }
  if (honored.length) {
    const inRun = honored.some((h) => h.inRunTmpdir > 0);
    const inDefault = honored.some((h) => h.inDefaultTmp > 0);
    out(`INFO  claude's task directory was found ${inRun ? 'under the run TMPDIR (TMPDIR is honored)' : ''}${inRun && inDefault ? ' and ' : ''}${inDefault ? 'under the default temp directory (TMPDIR is not honored for it)' : ''}${!inRun && !inDefault ? 'nowhere (no task directory was made)' : ''}`);
  }
  process.exit(failed ? 1 : 0);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'resolve') resolve(args);
  else if (cmd === 'make-bench') makeBench(args[0]);
  else if (cmd === 'preflight') preflight(args);
  else if (cmd === 'verify') verify(args);
  else { process.stderr.write('usage: claude-code-smoke.js resolve|make-bench|preflight|verify\n'); process.exit(2); }
} catch (e) {
  out(`FAIL ${cmd}: ${String(e.message).split('\n')[0]}`);
  process.exit(1);
}
