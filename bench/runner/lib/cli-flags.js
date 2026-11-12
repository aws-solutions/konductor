// SPDX-License-Identifier: Apache-2.0
'use strict';

// The flags each bench.js command accepts. An unknown flag is an error: a typo such as --arm must never
// fall back to a default and start a real run. A test keeps this table equal to the usage text.

const FLAGS = {
  run: [
    'suite', 'arms', 'tasks', 'replicates', 'replicate-offset', 'parallel', 'budget-credits', 'budget-usd', 'out', 'model', 'effort', 'cache', 'cargo-target',
    'cargo-online', 'seed', 'isolate', 'allow-unisolated', 'allow-partial', 'censored-floor', 'hide', 'no-default-hide', 'env-keep', 'tripwire-exclude', 'tripwire-depth', 'tripwire-dir',
    'kiro-bin', 'bench-dir', 'repo-root', 'real-cache', 'prepare-only', 'aws-creds-file', 'aws-profile', 'opencode-bin', 'rg-bin', 'agent-engine',
    'extra-tasks', 'suites-dir', 'run-credit-limit', 'auth-db', 'arm-prefix', 'arm-agent', 'arm-config', 'stop-on', 'max-tool-calls', 'profile',
    'oracle-skills', 'oracle-manifest', 'claude-bin', 'claude-tools-dir', 'run-budget-usd', 'aws-region', 'gate-strict', 'max-auth-failures',
  ],
  judge: [
    'run', 'judges', 'mode', 'baseline', 'concurrency', 'budget-credits', 'judge-cmd', 'max-file-chars', 'max-bundle-chars', 'redact-file',
    'judge-timeout-sec', 'bench-dir', 'allow-small-panel', 'kiro-bin', 'isolate', 'hide', 'auth-db', 'extra-tasks', 'profile',
    'judge-backend', 'budget-usd', 'opencode-bin', 'aws-creds-file', 'aws-profile', 'aws-region', 'cache', 'criteria-pack', 'plan', 'rescore-quotes', 'quote-match',
  ],
  explain: ['run', 'arm', 'task', 'rep', 'brief', 'scoring', 'bench-dir', 'extra-tasks'],
  trace: ['run', 'arm', 'task', 'rep', 'format', 'full', 'instructions', 'repo-root'],
  'refs-report': ['run', 'out'],
  'probe-report': ['run', 'out', 'scoring', 'arms-file', 'canary-token-file'],
  'canary-report': ['run', 'out', 'layers-file'],
  report: ['run', 'baseline', 'out', 'bench-dir', 'extra-tasks', 'detail', 'format', 'scoring', 'profile', 'verdict', 'phases', 'test-arms', 'changed-skills', 'criteria-pack', 'allow-stale-pack'],
  'report-2x2': ['kiro-vanilla', 'kiro-konductor', 'cc-vanilla', 'cc-konductor', 'out', 'json', 'bench-dir', 'extra-tasks', 'scoring', 'criteria-pack'],
  compare: ['base', 'head', 'min-rel', 'rule', 'force', 'bench-dir'],
  contrast: ['run', 'base', 'head', 'min-rel', 'rule', 'by', 'bench-dir', 'extra-tasks', 'detail', 'format', 'out', 'scoring', 'phases'],
  'pr-plan': ['ref', 'base', 'suite', 'replicates', 'no-vanilla', 'budget-credits', 'seed', 'repo-root', 'bench-dir'],
  recheck: ['run', 'bench-dir', 'dry-run', 'extra-tasks'],
  backfill: ['run', 'write', 'credits', 'skills', 'bench-dir', 'repo-root', 'extra-tasks'],
  skills: ['run', 'bench-dir', 'repo-root', 'json', 'extra-tasks'],
  'calibrate export': ['run', 'n', 'seed', 'out', 'bench-dir', 'max-file-chars', 'max-bundle-chars', 'redact-file', 'criteria-pack'],
  'calibrate score': ['labels', 'key', 'kappa-min', 'agreement-min', 'spearman-min', 'save', 'criteria-pack'],
  'list-arms': ['arms', 'repo-root'],
  gc: ['root', 'older-than', 'kind', 'keep-last', 'apply', 'json', 'protect-file', 'protect', 'adopt'],
  archive: ['run', 'out', 'compress', 'remove-originals', 'apply', 'restore', 'dry-run'],
  'cap list': ['cap', 'kind', 'all', 'base', 'repo-root', 'bench-dir', 'extra-tasks', 'init', 'json'],
  'cap audit': ['cap', 'kind', 'all', 'base', 'harness', 'repo-root', 'bench-dir', 'extra-tasks', 'out', 'public', 'json', 'update-baseline', 'force'],
  'cap variant': [
    'base', 'drop', 'replace', 'add', 'overlay', 'to-agent', 'preset', 'scratch', 'verify', 'force', 'acting-agent', 'agent-engine', 'repo-root', 'bench-dir',
    'cache', 'cargo-target', 'cargo-online', 'json',
  ],
  'cap draft': ['cap', 'n', 'model', 'model-cmd', 'base', 'out', 'isolate', 'kiro-bin', 'auth-db', 'hide', 'repo-root', 'bench-dir'],
  'cap import': ['from', 'cap', 'n', 'out', 'repo-root', 'bench-dir'],
  'cap scenarios': ['cap', 'n', 'mode', 'seed-queries', 'model', 'model-cmd', 'base', 'out', 'isolate', 'kiro-bin', 'auth-db', 'hide', 'repo-root', 'bench-dir', 'dry-run'],
  'cap controls': ['out', 'base', 'reps', 'scratch', 'agent-engine', 'repo-root', 'bench-dir', 'check', 'base-arm', 'aa', 'keep', 'prune', 'extra-tasks', 'json'],
  'cap trigger': [
    'cap', 'mode', 'split', 'reps', 'crosscheck', 'crosscheck-run', 'harness', 'base', 'queries', 'out', 'model', 'model-cmd', 'from-run', 'from-arm', 'acting-agent',
    'concurrency', 'budget-credits', 'budget-usd', 'run-credit-limit', 'stop-on', 'max-tool-calls', 'seed', 'censored-floor', 'dry-run', 'kiro-bin', 'auth-db', 'isolate', 'hide', 'cache',
    'cargo-target', 'cargo-online', 'agent-engine', 'effort', 'aws-creds-file', 'aws-profile', 'opencode-bin', 'rg-bin', 'repo-root', 'bench-dir', 'extra-tasks', 'json', 'profile',
  ],
  'cap prune-report': ['base', 'harness', 'runs', 'runs-glob', 'min-exposure', 'evidence', 'out', 'json', 'repo-root', 'bench-dir', 'detail', 'format'],
  'cap skill-plan': ['base', 'runs', 'runs-glob', 'tier', 'only', 'tasks-per-skill', 'reps', 'max-sections', 'min-section-bytes', 'large', 'large-top', 'duplicates', 'agent-engine', 'model', 'arm-config', 'credits-per-run', 'sec-per-run', 'judge-usd-per-run', 'budget-credits', 'profile', 'repo-root', 'bench-dir', 'extra-tasks', 'allow-regex', 'screen', 'screen-tasks', 'forced-load', 'out', 'json'],
  'cap skill-study': [
    'base', 'runs', 'runs-glob', 'tier', 'only', 'tasks-per-skill', 'reps', 'max-sections', 'min-section-bytes', 'large', 'large-top', 'duplicates', 'agent-engine', 'model', 'arm-config', 'credits-per-run', 'sec-per-run', 'judge-usd-per-run', 'budget-credits', 'profile', 'repo-root', 'bench-dir', 'extra-tasks', 'allow-regex', 'screen', 'screen-tasks', 'study', 'init', 'status', 'dry-run', 'seed', 'scratch', 'control-reps', 'judge-backend', 'aws-creds-file', 'aws-profile', 'aws-region', 'budget-usd',
    'wave-budget-credits', 'auth-db', 'cache', 'cargo-target', 'kiro-bin', 'opencode-bin', 'forced-load', 'forced-held-min', 'waves',
  ],
  'cap decide': ['study', 'out', 'json', 'repo-root', 'bench-dir', 'extra-tasks', 'no-patches', 'forced-held-min'],
  'cap review': ['run', 'n', 'seed', 'sample-only', 'out', 'key-out', 'force', 'bench-dir', 'extra-tasks', 'max-file-chars', 'max-bundle-chars', 'redact-file'],
  'cap review-import': ['ratings', 'key', 'run', 'rater', 'out', 'save', 'force', 'kappa-min', 'agreement-min', 'spearman-min', 'json'],
  'cap criteria': ['study', 'runs', 'runs-glob', 'baseline', 'aa', 'out', 'json', 'margin', 'saturated', 'judge-disagree', 'replicate-sd', 'min-runs', 'no-adjust', 'bench-dir', 'extra-tasks'],
  'cap forced-prefix': ['cap', 'harness', 'base', 'out', 'repo-root', 'bench-dir'],
  'cap plan': [
    'mode', 'cap', 'base', 'reps', 'tasks', 'budget-credits', 'vanilla', 'allow-regex', 'force', 'candidate', 'acting-agent', 'agent-engine', 'scratch', 'seed',
    'repo-root', 'bench-dir', 'extra-tasks', 'json', 'profile',
  ],
};

// Commands whose first word selects the sub-command and therefore the flag table.
const SUBCOMMANDS = { calibrate: ['export', 'score'], cap: ['list', 'audit', 'variant', 'plan', 'draft', 'import', 'trigger', 'prune-report', 'scenarios', 'controls', 'skill-plan', 'skill-study', 'decide', 'review', 'review-import', 'criteria', 'forced-prefix'] };

// Flags that never take a value, so they cannot swallow the next argument.
const BOOLEAN_FLAGS = new Set([
  'cargo-online', 'allow-partial', 'allow-unisolated', 'gate-strict', 'allow-stale-pack', 'prepare-only', 'no-vanilla', 'dry-run', 'force', 'json', 'allow-small-panel', 'help',
  'init', 'public', 'verify', 'vanilla', 'allow-regex', 'all', 'update-baseline', 'write', 'credits', 'skills', 'status', 'no-patches', 'no-adjust', 'screen', 'no-default-hide', 'sample-only', 'plan', 'brief', 'full', 'instructions', 'rescore-quotes', 'apply', 'remove-originals',
]);

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
  if (SUBCOMMANDS[cmd]) {
    const sub = opts._[0];
    if (!SUBCOMMANDS[cmd].includes(sub)) return null;
    key = `${cmd} ${sub}`;
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
  for (const p of positional.slice(cmd === 'gc' && opts.protect === 'add' ? 1 : 0)) problems.push(p.startsWith('-') ? `unknown flag ${p}; flags start with two dashes` : `unexpected argument "${p}"`);
  if (!problems.length) return null;
  return `${problems.join('\n')}\nknown flags for ${key}: ${known.map((f) => `--${f}`).join(' ')}\nnothing was run; see: node bench/runner/bench.js ${cmd} --help`;
}

module.exports = { FLAGS, BOOLEAN_FLAGS, COMMANDS, SUBCOMMANDS, checkArgs };
