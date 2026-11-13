// SPDX-License-Identifier: Apache-2.0
'use strict';

// The generate-strands command: runs the external strands-evals generator once and records where the cases came from.
// The generator is a separate Python tool. This module only builds its argument array, waits for it, and checks the file it wrote.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { sha256, writeJson } = require('../../skilleval/lib/util.js');
const { UsageError, parseFlags, positiveInt } = require('./args.js');
const { loadExperiment } = require('./experiment.js');

const EVALUATORS = ['OutputEvaluator', 'TrajectoryEvaluator', 'InteractionsEvaluator'];
const VALUE_FLAGS = ['context-file', 'task-description', 'out', 'num-cases', 'num-topics', 'evaluator', 'model', 'strands-bin'];
const DEFAULT_BIN = 'strands-evals';
const VERSION_TIMEOUT_MS = 5000;
const CONTEXT_PLACEHOLDER = '<contents of contextFile>';
const MAX_CONTEXT_BYTES = 120000;

const USAGE = `usage: agenteval.js generate-strands --context-file FILE --task-description TEXT --out FILE [options]

Runs "strands-evals generate" (a separate Python tool, not part of this repository) and writes a provenance sidecar next to the
experiment. The generator calls a model and may cost money; this command does not set up credentials and passes the environment
through unchanged. Nothing from the environment is logged or stored.

  --context-file FILE      text describing the agent and its tools; its contents are passed as --context (required)
  --task-description TEXT  short description of the agent's task (required)
  --out FILE               experiment JSON to write, must end in .json (required); the sidecar is FILE with .json replaced by .generation.json
  --num-cases N            number of cases (the generator's own default applies when omitted)
  --num-topics K           expand into K topic prompts for more variety
  --evaluator NAME         ${EVALUATORS.join(' | ')}; picks the rubric the generator writes
  --model ID               model for the generator
  --strands-bin PATH       the generator binary (default: ${DEFAULT_BIN} from PATH)
  --force                  replace an existing experiment and sidecar

Install the generator in a Python 3.11+ virtualenv: python3 -m venv .venv && .venv/bin/pip install strands-agents-evals

Expected trajectories: in strands-agents-evals 1.9.0 the "generate" command builds its generator with include_expected_trajectory
left at its default (False) and does not change it for TrajectoryEvaluator, so --evaluator TrajectoryEvaluator only changes the
rubric text. Cases from this command come back with expected_trajectory null. To get trajectories, call ExperimentGenerator from
Python with include_expected_trajectory=True and pass the resulting file to import-strands.

Exit codes: 0 ok, 1 error (including a generator that exits non-zero), 2 usage.`;

function runGenerator(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 2, 2] });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function readVersion(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || r.stderr).trim().split('\n')[0] || null;
}

const sidecarPath = (out) => out.replace(/\.json$/i, '.generation.json');

async function run(argv, { out, err }) {
  const opts = parseFlags(argv, { value: VALUE_FLAGS, bool: ['force', 'help'] });
  if (opts.help) { out(USAGE); return 0; }
  for (const need of ['context-file', 'task-description', 'out']) if (opts[need] === undefined) throw new UsageError(`--${need} is required`);
  if (!/\.json$/i.test(opts.out)) throw new UsageError('--out must end in .json');
  if (opts.evaluator !== undefined && !EVALUATORS.includes(opts.evaluator)) throw new UsageError(`--evaluator must be one of ${EVALUATORS.join(', ')}`);
  const numCases = positiveInt(opts, 'num-cases');
  const numTopics = positiveInt(opts, 'num-topics');
  const bin = opts['strands-bin'] ?? DEFAULT_BIN;

  let context;
  try { context = fs.readFileSync(opts['context-file']); } catch (e) { throw new Error(`cannot read context file ${opts['context-file']}: ${e.message}`); }
  if (context.length > MAX_CONTEXT_BYTES) throw new Error(`context file ${opts['context-file']} is ${context.length} bytes; it is passed as one command-line argument, so keep it under ${MAX_CONTEXT_BYTES}`);
  const outFile = path.resolve(opts.out);
  const sidecar = sidecarPath(outFile);
  const existing = [outFile, sidecar].filter((f) => fs.existsSync(f));
  if (existing.length && !opts.force) throw new Error(`${path.basename(existing[0])} already exists; pass --force to replace it`);
  for (const f of existing) fs.rmSync(f);

  const flags = ['--task-description', opts['task-description']];
  if (numCases !== undefined) flags.push('--num-cases', String(numCases));
  if (numTopics !== undefined) flags.push('--num-topics', String(numTopics));
  if (opts.evaluator !== undefined) flags.push('--evaluator', opts.evaluator);
  if (opts.model !== undefined) flags.push('--model', opts.model);
  // The --context=TEXT form keeps argparse from reading a context that starts with a dash as a flag.
  const argvFor = (contextArg, outArg) => ['generate', `--context=${contextArg}`, ...flags, '-o', outArg];

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const startedAt = new Date();
  let result;
  try {
    result = await runGenerator(bin, argvFor(context.toString('utf8'), outFile));
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`cannot find "${bin}". Install the generator in a Python 3.11+ virtualenv (python3 -m venv .venv && .venv/bin/pip install strands-agents-evals), activate it, or pass --strands-bin PATH.`);
    }
    throw new Error(`cannot run "${bin}": ${e.message}`);
  }
  const durationMs = Date.now() - startedAt.getTime();
  if (result.code !== 0) throw new Error(`${path.basename(bin)} generate ${result.signal ? `was stopped by ${result.signal}` : `exited with code ${result.code}`}; nothing was recorded`);

  if (!fs.existsSync(outFile)) throw new Error(`${path.basename(bin)} exited 0 but did not write ${opts.out}`);
  let experiment;
  try { experiment = loadExperiment(outFile); } catch (e) { throw new Error(`${path.basename(bin)} wrote a file that is not a usable experiment: ${e.message}`); }

  if (experiment.cases.length === 0) throw new Error(`${path.basename(bin)} wrote an experiment with no cases to ${opts.out}; nothing was recorded. Try again, or raise --num-cases.`);

  const record = {
    schemaVersion: 1,
    tool: 'strands-evals',
    toolVersion: readVersion(bin),
    command: [path.basename(bin), ...argvFor(CONTEXT_PLACEHOLDER, path.basename(outFile))],
    contextSha256: sha256(context),
    contextFile: path.basename(opts['context-file']),
    taskDescription: opts['task-description'],
    numCases: numCases ?? null,
    numTopics: numTopics ?? null,
    evaluator: opts.evaluator ?? null,
    model: opts.model ?? null,
    startedAt: startedAt.toISOString(),
    durationMs,
    exitCode: 0,
  };
  writeJson(sidecar, record);
  out(`${experiment.cases.length} cases written to ${opts.out}; provenance in ${path.basename(sidecar)}`);
  return 0;
}

module.exports = { run, USAGE, sidecarPath };
