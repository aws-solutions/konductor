// SPDX-License-Identifier: Apache-2.0
'use strict';

// Runs the Strands hook census once per suite, before any trial (design 15.3, SR-22), and refuses a counted suite
// whose plain arm carries a hook that can cancel, rewrite or retry a plant call.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ReleaseRefused } = require('./manifest.js');
const { parseStream } = require('../stream.js');
const { ALL_TOOLS } = require('./meta.js');
const { installForwarder, releaseForwarder, censusProblems, pythonArgs, PLANT_DIR } = require('./strands-adapter.js');

const CENSUS_MS = 60000;

/** The last `census` line of trace `text`, or null. */
function censusOf(text) {
  return parseStream(text).events.filter((l) => l?.type === 'census').at(-1) ?? null;
}

/**
 * Runs the launcher's `--census` once, before any trial (design 15.3: preflight lists every hook on plant tools).
 * `python` is the Strands interpreter; `agentFile` the agent factory or null; `tools` the plant tool names; `env` the
 * launcher's environment; `dir` an empty dir for a read-only launcher copy; `wrap(file, args)` puts the command inside
 * the trial's isolation (`{file, args}`), identity by default. Returns the census. Throws when none comes back.
 */
function runCensus({ python, agentFile, tools, env, dir, wrap = (file, args) => ({ file, args }) }) {
  const plantDir = path.join(dir, PLANT_DIR);
  const launcher = installForwarder(plantDir);
  const w = wrap(python, [...pythonArgs(launcher), '--census', '--tools', tools.join(','), ...(agentFile ? ['--agent-file', agentFile] : [])]);
  const r = spawnSync(w.file, w.args, { env, cwd: dir, encoding: 'utf8', timeout: CENSUS_MS });
  releaseForwarder(plantDir);
  const census = censusOf(r.stdout ?? '');
  if (!census) throw new Error(`Strands hook census gave no census (exit ${r.status}${r.error ? `, ${r.error.message}` : ''}): ${(r.stdout ?? '').trim().slice(-500)} ${(r.stderr ?? '').trim().slice(-500)}`);
  return census;
}

/**
 * The hook census preflight of a Strands plant suite (design 15.3, SR-22), before any trial. Runs the census once in
 * a fresh dir under `scratch` with `strands` (ctx.strands), the launcher env `env` and `wrap`. Throws ReleaseRefused
 * when `suite` is counted, a plain Strands arm (`plant.hooks` "refuse") is among `arms` and the census has problems;
 * a hooked arm runs as its own arm instead. The stub tools are those of every plant kind, so one census covers conveyor and arm tasks.
 * a hooked arm runs as its own arm instead. Returns `{census, problems}` for the run config.
 */
function preflightStrands({ strands, suite, arms, env, scratch, wrap }) {
  const dir = fs.mkdtempSync(path.join(scratch, 'census-'));
  try {
    const census = runCensus({ python: strands.python, agentFile: strands.agentFile, tools: ALL_TOOLS, env: { ...env, HOME: dir, TMPDIR: dir }, dir, wrap });
    const problems = censusProblems(census);
    const plain = arms.filter((a) => a.plant?.hooks === 'refuse').map((a) => a.id);
    if (suite.counted && plain.length && problems.length) {
      throw new ReleaseRefused(`a counted Strands suite refuses tool hooks on plain arms (${plain.join(', ')}); run them as -hooked arms instead:\n  ${problems.join('\n  ')}`);
    }
    return { census, problems };
  } finally {
    releaseForwarder(path.join(dir, PLANT_DIR));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { censusOf, runCensus, preflightStrands };
