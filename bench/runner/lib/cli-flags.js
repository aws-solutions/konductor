// SPDX-License-Identifier: Apache-2.0
'use strict';

// The flags each bench.js command accepts. An unknown flag is an error: a typo such as --arm must never
// fall back to a default and start a real run. A test keeps this table equal to the usage text.

const FLAGS = {
  run: [
    'suite', 'arms', 'tasks', 'replicates', 'parallel', 'budget-credits', 'budget-usd', 'out', 'model', 'effort', 'cache', 'cargo-target',
    'cargo-online', 'seed', 'isolate', 'allow-partial', 'censored-floor', 'hide', 'env-keep', 'tripwire-exclude', 'tripwire-depth', 'tripwire-dir',
    'kiro-bin', 'bench-dir', 'repo-root', 'real-cache', 'prepare-only', 'aws-creds-file', 'aws-profile', 'opencode-bin', 'rg-bin',
  ],
  judge: [
    'run', 'judges', 'mode', 'baseline', 'concurrency', 'budget-credits', 'judge-cmd', 'max-file-chars', 'max-bundle-chars', 'redact-file',
    'judge-timeout-sec', 'bench-dir', 'allow-small-panel', 'kiro-bin', 'isolate', 'hide', 'auth-db',
  ],
  report: ['run', 'baseline', 'out', 'bench-dir'],
  compare: ['base', 'head', 'min-rel', 'rule', 'force', 'bench-dir'],
  contrast: ['run', 'base', 'head', 'min-rel', 'rule', 'bench-dir'],
  'pr-plan': ['ref', 'base', 'suite', 'replicates', 'no-vanilla', 'budget-credits', 'seed', 'repo-root', 'bench-dir'],
  recheck: ['run', 'bench-dir', 'dry-run'],
  skills: ['run', 'bench-dir', 'repo-root', 'json'],
  'calibrate export': ['run', 'n', 'seed', 'out', 'bench-dir', 'max-file-chars', 'max-bundle-chars', 'redact-file'],
  'calibrate score': ['labels', 'key', 'kappa-min', 'agreement-min', 'spearman-min'],
  'list-arms': ['arms', 'repo-root'],
};

// Flags that never take a value, so they cannot swallow the next argument.
const BOOLEAN_FLAGS = new Set(['cargo-online', 'allow-partial', 'prepare-only', 'no-vanilla', 'dry-run', 'force', 'json', 'allow-small-panel', 'help']);

const COMMANDS = [...new Set(Object.keys(FLAGS).map((k) => k.split(' ')[0]))];

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

function suggestion(flag, known) {
  const name = flag.split('=')[0];
  let best = null;
  for (const k of known) {
    const dist = distance(name, k);
    if (dist <= 2 && (!best || dist < best.dist)) best = { k, dist };
  }
  return best ? best.k : null;
}

/**
 * Null when the arguments fit the command, else the message to print (exit code 2). `help` is always allowed.
 * calibrate with a missing or unknown subcommand is left to its handler, which reports it before doing anything.
 */
function checkArgs(cmd, opts) {
  let key = cmd;
  let positional = opts._;
  if (cmd === 'calibrate') {
    const sub = opts._[0];
    if (sub !== 'export' && sub !== 'score') return null;
    key = `calibrate ${sub}`;
    positional = opts._.slice(1);
  }
  const known = FLAGS[key];
  if (!known) return null;
  const problems = [];
  for (const name of Object.keys(opts)) {
    if (name === '_' || name === 'help' || known.includes(name)) continue;
    const near = suggestion(name, known);
    const eq = name.includes('=') ? ` (a flag takes its value after a space: --${name.replace('=', ' ')})` : '';
    problems.push(`unknown flag --${name}${near && !eq ? ` (did you mean --${near}?)` : ''}${eq}`);
  }
  for (const p of positional) problems.push(p.startsWith('-') ? `unknown flag ${p}; flags start with two dashes` : `unexpected argument "${p}"`);
  if (!problems.length) return null;
  return `${problems.join('\n')}\nknown flags for ${key}: ${known.map((f) => `--${f}`).join(' ')}\nnothing was run; see: node bench/runner/bench.js ${cmd} --help`;
}

module.exports = { FLAGS, BOOLEAN_FLAGS, COMMANDS, checkArgs };
