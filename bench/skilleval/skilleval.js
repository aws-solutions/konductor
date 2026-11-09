#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a skill-evaluation scenario set: extract rules, vote on them, write scenarios and rubrics, freeze, emit bench tasks.
//   node bench/skilleval/skilleval.js extract|vote|scenarios|freeze|verify|emit --skill NAME [options]
// See bench/README.md, section "Skill evaluation scenarios".

const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('./lib/util.js');
const { makeCachedModel, DEFAULT_BUDGET_USD } = require('./lib/model.js');
const { loadSkill, skillDir, buildStoplist } = require('./lib/skill.js');
const { runExtract, DEFAULT_RULES } = require('./lib/extract.js');
const { runVote, DEFAULT_PANEL } = require('./lib/vote.js');
const { runScenarios, DEFAULT_MAX } = require('./lib/scenarios.js');
const { runRubrics } = require('./lib/rubric.js');
const { freeze, verify, assertNotFrozen } = require('./lib/freeze.js');
const { emit } = require('./lib/emit.js');
const { writeJson } = require('./lib/util.js');

const DEFAULT_MODEL = 'glm-5';
const DEFAULT_DOMAIN = 'software engineering';
const COMMANDS = ['extract', 'vote', 'scenarios', 'freeze', 'verify', 'emit'];
const VALUE_FLAGS = ['skill', 'ref', 'repo', 'skill-file', 'domain', 'max', 'count', 'model', 'extract-model', 'scenario-model', 'rubric-model', 'judges', 'decisions',
  'noise-margin', 'budget-usd', 'concurrency', 'opencode-bin', 'aws-creds-file', 'aws-profile', 'aws-region', 'timeout-sec'];

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (!VALUE_FLAGS.includes(name)) throw new Error(`unknown flag ${a}`);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Error(`${a} needs a value`);
    opts[name] = rest[++i];
  }
  return { cmd, opts };
}

const intFlag = (opts, name, dflt) => {
  if (opts[name] === undefined) return dflt;
  const n = Number(opts[name]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
};

// The Bedrock backend is built on the first uncached call, so a rerun from the cache needs no credentials and no binary.
function lazyCaller(opts) {
  let real = null;
  const caller = async (args) => {
    if (!real) {
      const { makeOpencodeCaller } = require('../judge/opencode.js');
      const oc = require('../runner/lib/harness/opencode.js');
      for (const need of ['opencode-bin', 'aws-creds-file']) if (!opts[need]) throw new Error(`the answer is not cached; pass --${need} to call the model`);
      real = makeOpencodeCaller({
        bin: path.resolve(opts['opencode-bin']), credsFile: path.resolve(opts['aws-creds-file']), awsProfile: opts['aws-profile'] ?? 'bench',
        region: opts['aws-region'] ?? oc.REGION, timeoutMs: intFlag(opts, 'timeout-sec', 240) * 1000,
      });
    }
    return real(args);
  };
  caller.cacheSalt = (model) => require('../judge/opencode.js').cacheSaltOf(model);
  return caller;
}

function context(opts, { caller } = {}) {
  const skillName = opts.skill;
  const skill = loadSkill({ skill: skillName, ref: opts.ref, file: opts['skill-file'], repo: opts.repo ? path.resolve(opts.repo) : process.cwd() });
  const budget = opts['budget-usd'] === undefined ? DEFAULT_BUDGET_USD : Number(opts['budget-usd']);
  if (!(budget > 0)) throw new Error('--budget-usd must be a positive number');
  const ask = makeCachedModel({ caller: caller ?? lazyCaller(opts), cacheDir: path.join(skill.dir, 'cache'), budgetUsd: budget });
  return { skill, ask, dir: skill.dir };
}

const need = (file, hint) => {
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} is missing; ${hint}`);
  return readJson(file);
};

async function main(argv, { caller, log = console.log } = {}) {
  const { cmd, opts } = parseArgs(argv);
  if (!COMMANDS.includes(cmd)) throw new Error(`usage: skilleval.js ${COMMANDS.join('|')} --skill NAME`);
  const dir = skillDir(opts.skill);

  if (cmd === 'verify') {
    const v = verify(dir);
    log(v.ok ? `${opts.skill}: freeze verified` : `${opts.skill}: freeze check FAILED\n- ${v.problems.join('\n- ')}`);
    return v.ok ? 0 : 1;
  }
  if (cmd === 'emit') {
    const r = emit({ skill: opts.skill, dir });
    log(`${opts.skill}: ${r.emitted.length} tasks written to ${path.relative(process.cwd(), r.tasksDir)}, suite ${path.relative(process.cwd(), r.suiteFile)}`);
    for (const s of r.skipped) log(`skipped ${s.id}: ${s.reason}`);
    return 0;
  }
  if (cmd === 'freeze') {
    const skill = loadSkill({ skill: opts.skill });
    const nm = opts['noise-margin'] === undefined ? undefined : Number(opts['noise-margin']);
    const r = freeze(dir, { skill: opts.skill, source: skill.source, noiseMargin: nm });
    log(`${opts.skill}: ${r.status}`);
    for (const [k, f] of Object.entries(r.freeze.files)) log(`  ${k}: ${f.file} ${f.sha256}`);
    return 0;
  }

  assertNotFrozen(dir, cmd);
  const ctx = context(opts, { caller });
  const report = () => log(`model calls ${ctx.ask.stats.calls}, cache hits ${ctx.ask.stats.hits}, new spend USD ${ctx.ask.stats.newUsd.toFixed(4)}, total spend USD ${ctx.ask.spentUsd().toFixed(4)}`);

  if (cmd === 'extract') {
    const out = await runExtract({
      skill: ctx.skill, ask: ctx.ask, modelName: opts['extract-model'] ?? opts.model ?? DEFAULT_MODEL, count: intFlag(opts, 'count', DEFAULT_RULES), outDir: dir,
    });
    log(`${opts.skill}: ${out.rules.length} rules kept, ${out.rejected.length} rejected (${out.rejected.map((r) => r.reasons.join('/')).join('; ') || 'none'})`);
    report();
    return 0;
  }
  if (cmd === 'vote') {
    const rulesDoc = need(path.join(dir, 'rules.json'), 'run extract first');
    const panel = opts.judges ? opts.judges.split(',').filter(Boolean) : DEFAULT_PANEL;
    const decisionsFile = opts.decisions ? path.resolve(opts.decisions) : path.join(dir, 'owner-decisions.json');
    const { results, survivors } = await runVote({ rulesDoc, ask: ctx.ask, panel, decisionsFile, outDir: dir, concurrency: intFlag(opts, 'concurrency', 3) });
    log(`${opts.skill}: ${survivors.length} of ${results.length} rules survive; ${results.filter((r) => r.flags.length).length} flagged (see flagged.md)`);
    report();
    return 0;
  }
  if (cmd === 'scenarios') {
    const survivorsDoc = need(path.join(dir, 'survivors.json'), 'run vote first');
    const stoplist = buildStoplist({ skill: opts.skill, text: ctx.skill.text, description: ctx.skill.description });
    const model = opts['scenario-model'] ?? opts.model ?? DEFAULT_MODEL;
    const doc = await runScenarios({
      skill: ctx.skill, survivors: survivorsDoc.rules, ask: ctx.ask, model, max: intFlag(opts, 'max', DEFAULT_MAX), stoplist, domain: opts.domain ?? DEFAULT_DOMAIN,
    });
    const rub = await runRubrics({ scenarios: doc.scenarios, survivors: survivorsDoc.rules, ask: ctx.ask, model: opts['rubric-model'] ?? opts.model ?? DEFAULT_MODEL, outDir: dir });
    const noRubric = new Set(rub.failed.map((f) => f.scenarioId));
    const final = {
      ...doc,
      scenarios: doc.scenarios.filter((s) => !noRubric.has(s.id)),
      rejected: [...doc.rejected, ...doc.scenarios.filter((s) => noRubric.has(s.id)).map((s) => ({ ...s, reasons: [`rubric: ${rub.failed.find((f) => f.scenarioId === s.id).reason}`] }))],
      stoplistSize: stoplist.length,
    };
    final.count = final.scenarios.length;
    writeJson(path.join(dir, 'scenarios.json'), final);
    const by = (t) => final.scenarios.filter((s) => s.type === t).length;
    log(`${opts.skill}: ${final.count} scenarios (rule ${by('rule')}, blind ${by('blind')}, near-miss ${by('near-miss')}), ${final.rejected.length} rejected`);
    report();
    return 0;
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code ?? 0), (e) => { console.error(`skilleval: ${e.message}`); process.exit(2); });
}

module.exports = { main, parseArgs };
