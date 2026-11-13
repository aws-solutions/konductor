// SPDX-License-Identifier: Apache-2.0
'use strict';

// The import-strands command: experiment file in, OUT/candidates.json and OUT/review.md out.

const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('../../skilleval/lib/util.js');
const { UsageError, parseFlags, positiveInt, unitInterval } = require('./args.js');
const { loadExperiment } = require('./experiment.js');
const { loadRules } = require('./rules.js');
const { buildCandidates } = require('./candidates.js');
const { loadToolsJson, extractToolsFromText } = require('./tools-file.js');
const { renderReview } = require('./review.js');

const SCHEMA_VERSION = 1;
const VALUE_FLAGS = ['experiment', 'tools', 'tools-from-text', 'rules', 'generation', 'batches', 'duplicate-threshold', 'out'];

const USAGE = `usage: agenteval.js import-strands --experiment FILE (--tools FILE | --tools-from-text FILE) --out DIR [options]

Turns a Strands experiment file into reviewable scenario candidates. Every generated field is a proposal.

  --experiment FILE          experiment JSON written by strands-evals generate (required)
  --tools FILE               declared tools: a JSON array of names, or {"tools": [{"name": ...}]}
  --tools-from-text FILE     declared tools read from a context file; lines like "- lookup_order(order_id: str) -> ..."
                             (give exactly one of --tools and --tools-from-text)
  --rules FILE               optional rules JSON: {"before": [a, b]} and {"tool": t, "inputPattern": p}
  --generation FILE          the .generation.json written by generate-strands; without it the provenance fields are null
  --batches N                number of generation batches (topics) the cases were produced in, in order; with --generation
                             and no --batches, the sidecar's numTopics is used when it is not null (an explicit --batches wins)
  --duplicate-threshold X    token overlap above which an input counts as a duplicate, in (0, 1] (default 0.6)
  --out DIR                  directory for candidates.json and review.md (required; must not exist unless --force)
  --force                    write into an existing OUT, replacing candidates.json and review.md

Exit codes: 0 ok, 1 error, 2 usage.`;

function loadGeneration(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read generation file ${file}: ${e.message}`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.schemaVersion !== 1) throw new Error(`generation file ${file} is not a schemaVersion 1 sidecar from generate-strands`);
  return doc;
}

function run(argv, { out, err }) {
  const opts = parseFlags(argv, { value: VALUE_FLAGS, bool: ['force', 'help'] });
  if (opts.help) { out(USAGE); return 0; }
  for (const need of ['experiment', 'out']) if (opts[need] === undefined) throw new UsageError(`--${need} is required`);
  if (opts.tools !== undefined && opts['tools-from-text'] !== undefined) throw new UsageError('give only one of --tools and --tools-from-text');
  if (opts.tools === undefined && opts['tools-from-text'] === undefined) throw new UsageError('one of --tools or --tools-from-text is required');
  const explicitBatches = positiveInt(opts, 'batches');
  const duplicateThreshold = unitInterval(opts, 'duplicate-threshold');

  const outDir = path.resolve(opts.out);
  if (fs.existsSync(outDir) && !opts.force) throw new Error(`${opts.out} already exists; pass --force to write into it`);
  if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) throw new Error(`${opts.out} exists and is not a directory`);

  const tools = opts.tools !== undefined ? loadToolsJson(opts.tools) : extractToolsFromText(opts['tools-from-text']);
  if (opts['tools-from-text'] !== undefined) err(`declared tools found in ${path.basename(opts['tools-from-text'])}: ${tools.join(', ')}`);
  const experiment = loadExperiment(opts.experiment);
  experiment.sourceFile = path.basename(opts.experiment);
  const rules = opts.rules !== undefined ? loadRules(opts.rules, { tools }) : [];
  const generation = opts.generation !== undefined ? loadGeneration(opts.generation) : null;

  const batches = explicitBatches ?? (Number.isInteger(generation?.numTopics) && generation.numTopics >= 1 ? generation.numTopics : undefined);
  if (explicitBatches === undefined && batches !== undefined) err(`--batches not given; using numTopics ${batches} from ${path.basename(opts.generation)}`);

  const provenance = {
    version: generation?.toolVersion ?? null,
    model: generation?.model ?? null,
    contextSha256: generation?.contextSha256 ?? null,
    taskDescription: generation?.taskDescription ?? null,
  };
  const built = buildCandidates(experiment, { tools, rules, batches, duplicateThreshold, source: provenance });
  const trajectoryRubric = experiment.evaluators.some((e) => e.evaluatorType === 'TrajectoryEvaluator') || generation?.evaluator === 'TrajectoryEvaluator';
  const trajectoryWarning = trajectoryRubric && built.summary.total > 0 && !built.summary.trajectoriesGenerated;
  const source = { experiment: experiment.sourceFile, generation: generation ? path.basename(opts.generation) : null, ...provenance };

  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, 'candidates.json'), { schemaVersion: SCHEMA_VERSION, source, tools, summary: built.summary, rubricHint: built.rubricHint, candidates: built.candidates });
  fs.writeFileSync(path.join(outDir, 'review.md'), renderReview(built, { tools, source: { ...source, hasGeneration: generation !== null, generationFile: source.generation }, trajectoryWarning }));

  const { byStatus, total } = built.summary;
  out(`${total} candidates: ok ${byStatus.ok}, needs-edit ${byStatus['needs-edit']}, reject ${byStatus.reject}; written to ${opts.out}`);
  return 0;
}

module.exports = { run, USAGE };
