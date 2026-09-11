#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * run-claude-subset.js — Run a Claude Code benchmark subset directly.
 *
 * Aim-free driver with no dependency on internal build tooling. Notable
 * behavior:
 *
 *  - Dataset directory convention: a subset's scenario directory comes from
 *    its registry entry's own `datasetPath` (resolved under `tests/`), and
 *    falls back to the subset name when the entry declares none.
 *  - `--replicates N` (default 1) runs each scenario N times and records
 *    every run under `attempts[]`, matching the schema
 *    `results[].attempts[].metrics.scores.toolUse.score` that
 *    tests/scripts/check-benchmark-regression.js expects.
 *  - `--scenarios <substrings>` (comma-separated, case-insensitive) filters
 *    the loaded scenarios down to those whose taskId contains any of the
 *    given substrings. Omit to run every scenario in the subset.
 *  - Optional per-subset `requiredMcpServer` / `subjectModel` are read from
 *    tests/registry.json (if present) and forwarded to the runner as
 *    `context.requiredMcpServer` / `context.modelId` — see
 *    tests/judges/claude-code-agent-runner.js's header for why the MCP gate
 *    defaults to skipped for agents that declare no MCP servers.
 *  - Post-Phase-3 rebrand, registry.json's `name` carries the renamed public
 *    agent identifier (e.g. `k-developer`), while `datasetPath` and the actual
 *    `tests/<dir>/` scenario directories still use the pre-rename name (e.g.
 *    `./asdlc-developer`). `--agent` is matched against `name` only, and the
 *    directory is read from `datasetPath` only (see resolveDatasetDir), so the
 *    single `--agent k-developer` satisfies both. Phase 4 moves the
 *    directories and their `datasetPath` values together, with no code change
 *    here.
 *
 * The `runSubset(options)` function below is the "clean interface" boundary:
 * object options in, a structured `{ subset, results, metadata }` result out
 * (no `process.exit`, no console output). `main(argv)` is a thin CLI wrapper
 * over it that also writes the results JSON and prints progress/summary —
 * this split is deliberate so a future `konductor benchmark` CLI subcommand
 * (a post-launch, CLI-headless addition to the separate Konductor CLI
 * program) can call or port `runSubset` directly without needing to mimic
 * this file's argv parsing.
 *
 * Usage: node scripts/run-claude-subset.js <subset|--agent <subset>>
 *          [--output <dir>] [--parallel N] [--replicates N] [--model <id>]
 *          [--scenarios <substrings>]
 * Example: node scripts/run-claude-subset.js k-developer --replicates 3
 *
 * Reads scenario files from the subset's dataset directory, invokes `claude --agent` for
 * each, writes results JSON to <outputDir>/<subset>.json, exits 1 if any
 * scenario fails (toolUse score below 2 on any attempt).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const runner = require('../tests/judges/claude-code-agent-runner.js');
const { CONSTANTS } = require('./brand-config/lib/constants.js');

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

function loadRegistryEntry(subset) {
  const registryPath = path.join(__dirname, '..', 'tests', 'registry.json');
  if (!fs.existsSync(registryPath)) return null;
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    return (registry.subsets || []).find((s) => s.name === subset) || null;
  } catch {
    return null;
  }
}

const TESTS_ROOT = path.join(__dirname, '..', 'tests');

/**
 * Resolves the scenario directory for `subset`, from the registry entry's own
 * `datasetPath` when it has one, else from the subset name.
 *
 * The two lookups this script performs are deliberately decoupled: the AGENT
 * identifier comes from the registry entry's `name` (which `--agent` matches),
 * and the DIRECTORY comes from that same entry's `datasetPath`. They were
 * previously both derived from the single `--agent` string, so once the
 * Konductor rename moved `name` to `k-*` while the directories stayed
 * `asdlc-*`, no value of `--agent` could satisfy both at once. Reading each
 * from its own field means the rename needs no directory move, and the Phase 4
 * directory move needs no code change — only the `datasetPath` values.
 *
 * `datasetPath` is resolved relative to `tests/` and required to stay inside
 * it, so a malformed entry fails loudly here instead of reading an arbitrary
 * directory.
 */
function resolveDatasetDir(subset, registryEntry) {
  const declared = registryEntry?.datasetPath;
  if (!declared) return path.join(TESTS_ROOT, subset);
  const resolved = path.resolve(TESTS_ROOT, declared);
  if (resolved !== TESTS_ROOT && !resolved.startsWith(TESTS_ROOT + path.sep)) {
    throw new Error(`registry.json datasetPath for '${subset}' escapes tests/: ${declared}`);
  }
  return resolved;
}

function loadScenarios(datasetDir) {
  return fs
    .readdirSync(datasetDir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(datasetDir, f), 'utf-8'));
      return Array.isArray(data.scenarios) ? data.scenarios : [data];
    });
}

/** Filters scenarios to those whose taskId contains any of `substrings` (case-insensitive). No-op if `substrings` is empty/undefined. */
function filterScenarios(scenarios, substrings) {
  if (!substrings || substrings.length === 0) return scenarios;
  const needles = substrings.map((s) => s.toLowerCase());
  return scenarios.filter((s) => {
    const taskId = (s.taskId || s.id || '').toLowerCase();
    return needles.some((n) => taskId.includes(n));
  });
}

/**
 * Programmatic entry point — object options in, structured result out (no
 * `process.exit`, no progress logging). See the file header for why this is
 * kept separate from `main`.
 *
 * @param {{subset: string, outputDir?: string, parallel?: number, replicates?: number, modelId?: string, scenarios?: string[], onProgress?: (msg: string) => void}} options
 * @returns {Promise<{subset: string, results: object[], metadata: {model: string|null}}>}
 */
async function runSubset(options) {
  const { subset, onProgress = () => {} } = options;
  const parallel = Math.max(1, options.parallel || 3);
  const replicates = Math.max(1, options.replicates || 1);

  const registryEntry = loadRegistryEntry(subset);
  const requiredMcpServer = registryEntry?.requiredMcpServer || null;
  const effectiveModelId = options.modelId || registryEntry?.subjectModel || undefined;

  const datasetDir = resolveDatasetDir(subset, registryEntry);
  if (!fs.existsSync(datasetDir)) {
    throw new Error(`Dataset directory not found: ${datasetDir}`);
  }

  const allScenarios = loadScenarios(datasetDir);
  const scenarios = filterScenarios(allScenarios, options.scenarios);
  if (scenarios.length === 0) {
    throw new Error(
      options.scenarios && options.scenarios.length
        ? `No scenarios in ${datasetDir} matched --scenarios filter: ${options.scenarios.join(',')}`
        : `No scenarios found in ${datasetDir}`,
    );
  }

  onProgress(
    `Running ${scenarios.length} scenario(s) for ${subset} (parallel: ${parallel}, replicates: ${replicates})...`,
  );
  if (requiredMcpServer) onProgress(`  requiredMcpServer: ${requiredMcpServer} (from tests/registry.json)`);
  if (effectiveModelId) onProgress(`  model: ${effectiveModelId}`);

  // Flatten (scenario x replicate) into one work queue so the parallel
  // worker pool spreads load across scenarios AND replicates evenly, rather
  // than running one scenario's replicates fully serially before moving on.
  const jobs = [];
  for (const scenario of scenarios) {
    for (let attemptIndex = 0; attemptIndex < replicates; attemptIndex++) {
      jobs.push({ scenario, attemptIndex });
    }
  }

  const attemptsByTaskId = new Map();

  async function worker() {
    while (jobs.length > 0) {
      const job = jobs.shift();
      if (!job) break;
      const { scenario, attemptIndex } = job;
      const taskId = scenario.taskId || scenario.id;
      const workDir = path.join(
        os.tmpdir(),
        `${CONSTANTS.agent_prefix}bench-${subset}-${taskId.replace(/[^a-zA-Z0-9-]/g, '_')}-attempt${attemptIndex}-${Date.now()}`,
      );
      fs.mkdirSync(workDir, { recursive: true });
      onProgress(`  [start] ${taskId} (attempt ${attemptIndex + 1}/${replicates}, workDir: ${workDir})`);
      let result;
      try {
        result = await runner.evaluate({
          taskId,
          expectedTools: scenario.expectedTools,
          expectedStrings: scenario.expectedStrings,
          expectedSkillMarkers: scenario.expectedSkillMarkers,
          input: scenario.input,
          metadata: scenario.metadata,
          subsetName: subset,
          datasetPath: `./${path.relative(TESTS_ROOT, datasetDir)}`,
          workDir,
          modelId: effectiveModelId,
          requiredMcpServer,
        });
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      if (!attemptsByTaskId.has(taskId)) attemptsByTaskId.set(taskId, []);
      attemptsByTaskId.get(taskId).push({
        index: attemptIndex,
        metrics: { scores: result.scores },
        success: result.success,
        similarityScore: result.similarityScore,
        judgeOutput: result.judgeOutput,
        modelId: result.modelId,
      });
      onProgress(`  ${result.success ? '✅' : '❌'} ${taskId} (attempt ${attemptIndex + 1}/${replicates})`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, () => worker()));

  const results = scenarios.map((scenario) => {
    const taskId = scenario.taskId || scenario.id;
    const attempts = attemptsByTaskId.get(taskId) || [];
    const passed = attempts.length > 0 && attempts.every((a) => a.success);
    return { taskId, attempts, success: passed };
  });

  const observedModelId = results.flatMap((r) => r.attempts).find((a) => a.modelId)?.modelId || null;

  return {
    subset,
    results,
    metadata: { model: observedModelId || effectiveModelId || null },
    timestamp: new Date().toISOString(),
  };
}

/** CLI wrapper: argv -> runSubset() options -> written results JSON + printed summary. Returns a process exit code (does not call process.exit itself). */
async function main(argv) {
  const opts = parseArgs(argv);
  const subset = typeof opts.agent === 'string' ? opts.agent : opts._[0];
  if (!subset) {
    console.error(
      'Usage: node scripts/run-claude-subset.js <subset> [--agent <subset>] [--output <dir>] [--parallel N] [--replicates N] [--model <id>] [--scenarios <substrings>]',
    );
    return 1;
  }

  const outputDir = typeof opts.output === 'string' ? opts.output : 'benchmark-results';
  const scenarios = typeof opts.scenarios === 'string' ? opts.scenarios.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  let run;
  try {
    run = await runSubset({
      subset,
      outputDir,
      parallel: opts.parallel ? parseInt(opts.parallel, 10) : undefined,
      replicates: opts.replicates ? parseInt(opts.replicates, 10) : undefined,
      modelId: typeof opts.model === 'string' ? opts.model : process.env[CONSTANTS.bench_model_env] || undefined,
      scenarios,
      onProgress: (msg) => console.log(msg),
    });
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${subset}.json`), JSON.stringify(run, null, 2));

  const failed = run.results.filter((r) => !r.success).length;
  const passed = run.results.length - failed;
  console.log(
    `\n${passed}/${run.results.length} scenario(s) passed (each attempt-gated on toolUse; see attempts[] in ${path.join(outputDir, `${subset}.json`)} for per-replicate detail)`,
  );
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { parseArgs, loadRegistryEntry, resolveDatasetDir, loadScenarios, filterScenarios, runSubset, main };
