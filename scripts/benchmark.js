#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * benchmark.js — the ASDLCCoreAICapabilities benchmark CLI (interim entry
 * point).
 *
 * One-command flow: generate + install agent files for `--agent`, run the
 * benchmark subset whose registry `name` matches it (its scenario directory
 * comes from that entry's own `datasetPath`), write results, print a
 * pass/fail summary.
 *
 * Roadmap note (owner direction, 2026-08): the `konductor` CLI launches with
 * 8 commands — install/update/uninstall/synth/init/
 * doctor/config/metrics — and no workflow-run subcommand; running a
 * workflow is agent-driven at launch, with CLI-headless workflow-run
 * features (the "coded conductor loop") landing post-launch. A `konductor
 * benchmark` subcommand fits that same post-launch, CLI-headless pattern.
 * This file is written so that migration is a wrap-or-port, not a rewrite:
 *
 *   - All argument parsing + orchestration lives HERE, in one self-contained
 *     script — not spread across chained npm scripts.
 *   - The actual work is delegated to two library functions with a clean,
 *     object-in/object-out interface (`generateAgents(options)` in
 *     scripts/generate-agent-files.js, `runSubset(options)` in
 *     scripts/run-claude-subset.js) — no `process.exit`, no argv parsing
 *     inside either. A future `konductor benchmark` subcommand (Rust or
 *     Python) can call the equivalent logic directly, or port it, without
 *     needing to re-derive semantics from this file's CLI surface.
 *   - Flag names/semantics are chosen to survive that migration unchanged:
 *     `--agent`, `--replicates`, `--output`, `--scenarios` (plus `--parallel`,
 *     `--model`, `--install-dir`, `--max-inline-chars` for the generator
 *     step). None of these are npm/Node-specific.
 *
 * Today's invocation:
 *   npm run benchmark -- --agent k-developer --replicates 3
 *   node scripts/benchmark.js --agent k-quality-assurance --scenarios qa-ui-text
 *
 * Planned future invocation (not available yet — see roadmap note above):
 *   konductor benchmark --agent k-developer --replicates 3
 *
 * See docs/guides/benchmarking.md for prerequisites and the sandboxing
 * warning (`--permission-mode bypassPermissions` is unconditional in the
 * runner this drives — never run against a real project checkout).
 */
'use strict';

const path = require('path');
const { generateAgents, reportGenerateAgents } = require('./generate-agent-files.js');
const { runSubset } = require('./run-claude-subset.js');
const { CONSTANTS } = require('./brand-config/lib/constants.js');
const fs = require('fs');

const USAGE = [
  'Usage: node scripts/benchmark.js --agent <agent-name> [--replicates N] [--parallel N]',
  '         [--output DIR] [--model ID] [--scenarios <substrings>] [--install-dir DIR]',
  '         [--max-inline-chars N] [--skip-generate]',
  '',
  'Example: node scripts/benchmark.js --agent k-developer --replicates 3',
].join('\n');

/** Minimal, dependency-free argv parser: `--flag value` or bare `--flag` (boolean). */
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }
  return opts;
}

/**
 * Programmatic entry point — object options in, structured result out (no
 * `process.exit`). This is the function a future `konductor benchmark`
 * subcommand would call or port.
 *
 * @param {{agent: string, replicates?: number, parallel?: number, output?: string, model?: string, scenarios?: string[], installDir?: string, maxInlineChars?: number, skipGenerate?: boolean, onProgress?: (msg: string) => void}} options
 * @returns {Promise<{generate: object, run: object, exitCode: number}>}
 */
async function benchmark(options) {
  const onProgress = options.onProgress || (() => {});
  if (!options.agent) {
    throw new Error('options.agent is required (e.g. "k-developer")');
  }

  let generateResult = null;
  if (!options.skipGenerate) {
    onProgress(`=== Step 1/2: generating and installing agent files for ${options.agent} ===`);
    generateResult = generateAgents({
      agent: options.agent,
      install: true,
      installDir: options.installDir,
      maxInlineChars: options.maxInlineChars,
    });
    // Surface the generate report (including any skipped/unresolved-skill
    // WARN lines) here, before Step 2's expensive `claude` run, not after
    // it. A skill that silently failed to inline means the whole run that
    // follows measured an agent missing that skill -- that needs to be
    // visible before the spend, not printed alongside the final summary.
    reportGenerateAgents(generateResult);
  }

  onProgress(`\n=== Step 2/2: running benchmark subset ${options.agent} ===`);
  const run = await runSubset({
    subset: options.agent,
    outputDir: options.output || 'benchmark-results',
    parallel: options.parallel,
    replicates: options.replicates,
    modelId: options.model,
    scenarios: options.scenarios,
    onProgress,
  });

  const outputDir = options.output || 'benchmark-results';
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${options.agent}.json`), JSON.stringify(run, null, 2));

  const failed = run.results.filter((r) => !r.success).length;
  const exitCode = failed > 0 ? 1 : 0;

  return { generate: generateResult, run, exitCode };
}

/** CLI wrapper: argv -> benchmark() options -> printed report. Returns a process exit code (does not call process.exit itself). */
async function main(argv) {
  const opts = parseArgs(argv);
  const agent = typeof opts.agent === 'string' ? opts.agent : undefined;
  if (!agent) {
    console.error(USAGE);
    return 1;
  }

  const { run, exitCode } = await benchmark({
    agent,
    replicates: opts.replicates ? parseInt(opts.replicates, 10) : undefined,
    parallel: opts.parallel ? parseInt(opts.parallel, 10) : undefined,
    output: typeof opts.output === 'string' ? opts.output : undefined,
    model: typeof opts.model === 'string' ? opts.model : process.env[CONSTANTS.bench_model_env] || undefined,
    scenarios:
      typeof opts.scenarios === 'string' ? opts.scenarios.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    installDir: typeof opts['install-dir'] === 'string' ? opts['install-dir'] : undefined,
    maxInlineChars: opts['max-inline-chars'] ? parseInt(opts['max-inline-chars'], 10) : undefined,
    skipGenerate: Boolean(opts['skip-generate']),
    onProgress: (msg) => console.log(msg),
  });

  const outputDir = typeof opts.output === 'string' ? opts.output : 'benchmark-results';
  const failed = run.results.filter((r) => !r.success).length;
  const passed = run.results.length - failed;
  console.log(
    `\n${passed}/${run.results.length} scenario(s) passed (each attempt-gated on toolUse; see attempts[] in ${path.join(outputDir, `${agent}.json`)} for per-replicate detail)`,
  );

  return exitCode;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { parseArgs, benchmark, main, USAGE };
