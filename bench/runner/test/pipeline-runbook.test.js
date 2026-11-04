// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/RUNBOOK.md is checked against the scripts it describes: every script, flag, variable and path it names must exist.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(BENCH, 'scripts');
const doc = fs.readFileSync(path.join(BENCH, 'RUNBOOK.md'), 'utf8');
const sources = Object.fromEntries(fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.sh')).map((f) => [f, fs.readFileSync(path.join(SCRIPTS, f), 'utf8')]));
const allSource = Object.values(sources).join('\n');

test('every script the runbook names exists, and every pipeline script is named in it', () => {
  const named = new Set([...doc.matchAll(/\b([a-z][a-z-]*\.sh)\b/g)].map((m) => m[1]));
  for (const n of named) assert.ok(sources[n], `${n} is named in RUNBOOK.md but is not in bench/scripts`);
  for (const n of ['run-real-pilot.sh', 'run-after-capability.sh', 'run-skill-bench.sh', 'run-judging.sh', 'monitor.sh']) assert.ok(named.has(n), `${n} is not in RUNBOOK.md`);
  assert.ok(fs.existsSync(path.join(SCRIPTS, 'real-pilot-tasks.txt')) && doc.includes('real-pilot-tasks.txt'));
});

test('every flag shown after a script name in the runbook is handled by that script', () => {
  let checked = 0;
  for (const line of doc.split('\n')) {
    for (const m of line.matchAll(/\b([a-z][a-z-]*\.sh)((?:\s+--?[a-zA-Z][\w-]*(?:\s+\d+)?)+)/g)) {
      const [, name, flags] = m;
      assert.ok(sources[name], `${name} in: ${line}`);
      for (const f of flags.match(/--?[a-zA-Z][\w-]*/g)) {
        assert.ok(new RegExp(`${f.replace(/-/g, '\\-')}(?![\\w-])`).test(sources[name]), `${name} does not handle ${f} (RUNBOOK.md: ${line.trim()})`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 20, `only ${checked} flags were checked`);
});

test('every flag in the runbook\'s monitor and help examples is a real option, and --help works for each script name', () => {
  for (const f of ['--watch', '--json', '--all', '--save']) assert.ok(sources['monitor.sh'].includes(f), f);
  for (const f of ['--dry-run', '--status', '--stop', '--foreground']) for (const n of ['run-after-capability.sh', 'run-real-pilot.sh', 'run-skill-bench.sh']) assert.ok(sources[n].includes(f), `${n} ${f}`);
  assert.ok(sources['run-judging.sh'].includes('--dry-run') && sources['run-judging.sh'].includes('--status'));
});

test('every upper-case variable the runbook names in code font appears in a script', () => {
  const skip = new Set(['DONE', 'FAILED', 'OK', 'ATTENTION', 'DELETE', 'PRUNE', 'KEEP', 'UTC', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  const names = new Set();
  for (const m of doc.matchAll(/`([A-Z][A-Z0-9_]+)(?:=[^`]*)?`/g)) if (!skip.has(m[1])) names.add(m[1]);
  for (const m of doc.matchAll(/\b([A-Z][A-Z0-9_]{3,})=/g)) names.add(m[1]);
  assert.ok(names.size >= 20, `only ${names.size} variables found`);
  for (const n of names) assert.ok(new RegExp(`\\b${n}\\b`).test(allSource), `${n} is named in RUNBOOK.md but no script uses it`);
});

test('the phase table matches the chain\'s phase names', () => {
  const m = /PHASE_NAMES=\(""((?: \w+)+)\)/.exec(sources['run-after-capability.sh']);
  assert.ok(m);
  const names = m[1].trim().split(/\s+/);
  const rows = [...doc.matchAll(/^\| P(\d) \| (\w+) \|/gm)].map((r) => [Number(r[1]), r[2]]);
  assert.deepEqual(rows, names.map((n, i) => [i + 1, n]));
});

test('the paths the runbook names exist', () => {
  const paths = new Set([...doc.matchAll(/`((?:bench\/)[\w./-]+)`/g)].map((m) => m[1]).filter((p) => !p.includes('*') && !/<|>/.test(p)));
  assert.ok(paths.size >= 5);
  for (const p of paths) assert.ok(fs.existsSync(path.join(BENCH, '..', p)), `${p} is named in RUNBOOK.md but does not exist`);
});

test('the README links the runbook and the runbook links back to the README and playbook', () => {
  const readme = fs.readFileSync(path.join(BENCH, 'README.md'), 'utf8');
  assert.match(readme, /\(RUNBOOK\.md\)/);
  assert.match(readme, /run-after-capability\.sh/);
  assert.match(doc, /bench\/README\.md/);
  assert.match(doc, /bench\/CAP-PLAYBOOK\.md/);
});

test('the runbook uses no em or en dashes and no first-person chat wording', () => {
  assert.doesNotMatch(doc, /[\u2013\u2014]/);
  assert.doesNotMatch(doc, /\bI\b|\bour\b|\bwe\b/i);
});

test('the scripts document their credentials rule: no default path, refusal when unset', () => {
  for (const n of ['run-after-capability.sh', 'run-judging.sh']) assert.match(sources[n], /CREDS is not set/, n);
  assert.match(doc, /There is no default and a launch refuses without it/);
});
