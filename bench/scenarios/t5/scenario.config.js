// SPDX-License-Identifier: Apache-2.0
'use strict';

// T5's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t5/scenario.config.js [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t5/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t5/scenario.config.js normalize|map|review|assemble <id>   (needs T5_AUTH)
// normalize puts the author's repository into work/<id>/fixture/ (the author may have written it at the top) and adds
// the scoring kit to hidden/ (lib/build-hidden.js). Hidden dirs are laid over the workspace root as they are, except a
// twin's (its tests sit in hidden/), so there is no canary: each tests check names its test files.

const fs = require('node:fs');
const path = require('node:path');
const { main: buildHidden } = require('./lib/build-hidden.js');

const STACKS = {
  docs: { stack: 'Markdown documents only, no code, no package file and no install step.', runner: 'node', mutcmd: '', pycfg: '' },
  node: { stack: 'Node.js 24, CommonJS, no dependencies and no install step. Tests use node:test and node:assert and run with `node --test`.', runner: 'node', mutcmd: 'node --test --test-timeout=4000 test/*.test.js', pycfg: '' },
  python: { stack: 'Python 3.12, standard library only, no install step. Tests use unittest, live under `tests/` (files `test_*.py`) and run with `python3 -m unittest discover -s tests`. The repository root is on PYTHONPATH.', runner: 'python', mutcmd: '', pycfg: '"pattern": "test*.py", "perTestSec": 5, ' },
};

function render(id, lib) {
  const { read, fill } = lib;
  const b = lib.brief(id);
  if (b.kind === 'twin') return fill(read('prompts/author-twin.md'), { BRIEF: b.brief, ID: b.id });
  const s = STACKS[b.stack];
  const mutants = b.kind === 'mutants' || b.extra === 'flaky';
  const scripted = b.kind === 'scripted';
  const nmut = b.nmut || 10;
  const nkey = b.nkey || 8;
  const testCmd = scripted ? '`node --test --test-timeout=15000 acceptance.test.js`' : b.kind === 'findings' ? '`node --test --test-timeout=15000 findings.test.js`'
    : b.extra === 'flaky' ? '`node --test --test-timeout=30000 stability.test.js mutation.test.js`'
    : '`node --test --test-timeout=30000 mutation.test.js`';
  const vars = {
    BRIEF: `${b.brief}\n\n${lib.sourceLine(b.source)}`,
    SIZE: b.size, STACK: s.stack, ID: b.id, RUNNER: s.runner, MUTCMD: s.mutcmd, PYCFG: s.pycfg,
    NMUT: String(nmut), SURVIVE: String(nmut - 2),
    NKEY: String(nkey), NTRAP: String(b.ntrap || 3), NDECOY: String(b.ndecoy || 2), EXTRA: b.keyExtra || 'Give each item a different location.',
    TESTCMD: testCmd.replace(/`/g, ''), TESTMIN: scripted ? '12' : b.kind === 'findings' ? String(2 * nkey + 1) : b.extra === 'flaky' ? `${nmut + 6} or more` : String(nmut),
    VOICE: b.voice || 'a QA lead or developer who owns the repo, talking to a colleague',
    QUESTIONS_NOTE: scripted ? '; the request says the user can answer questions' : (b.questionsNote || ''),
  };
  let kind = read(scripted ? 'prompts/kind-scripted.md' : mutants ? 'prompts/kind-mutants.md' : 'prompts/kind-findings.md');
  if (b.extra === 'flaky') kind = `${read('prompts/kind-flaky.md')}\n${kind}`;
  if (b.extraText) kind += `\n${b.extraText}\n`;
  vars.KIND = fill(kind, vars);
  return fill(read('prompts/author-common.md'), vars);
}


const AUTHOR_FILES = new Set(['hidden', 'solution', 'kit', 'task-draft.json', 'review.json', 'fixture']);

function normalize(s, id) {
  const w = s.work(id);
  if (!fs.existsSync(path.join(w, 'fixture'))) {
    fs.mkdirSync(path.join(w, 'fixture'));
    for (const name of fs.readdirSync(w).filter((n) => !AUTHOR_FILES.has(n))) fs.renameSync(path.join(w, name), path.join(w, 'fixture', name));
  }
  const b = s.brief(id);
  if (b.kind === 'scripted' || b.kind === 'twin') return;
  if (b.kind === 'findings') buildHidden([path.join(w, 'hidden'), 'findings', b.outputFile], s.readJson(path.join(w, 'task-draft.json')).findingsKey);
  else buildHidden([path.join(w, 'hidden'), 'mutants']);
}

function buildTask(s, id) {
  const b = s.brief(id);
  const draft = s.readJson(s.work(id, 'task-draft.json'));
  const disposition = s.workJson(`${id}.disposition.json`, {});
  const mapping = s.workJson(`${id}.map.json`, s.NO_MAPPING);
  const rev = s.workJson(`${id}.review.json`);
  // Authors guess seconds of work; an agent needs minutes to read a repository and write tests. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits.softSec, b.softSec || 600);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = s.SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(s.YES_SENTENCE) ? `${draft.prompt} ${s.YES_SENTENCE}` : draft.prompt;
  return {
    id, class: 'hard', version: 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: s.withExpertRubric(draft.rubric, b.expertKey, 'the items are judgment about test design, not a pattern in the text'),
    ...(draft.findingsKey ? { findingsKey: draft.findingsKey } : {}),
    ...(draft.scriptedUser ? { scriptedUser: draft.scriptedUser } : {}),
    ...(b.expertKey ? { expertKey: b.expertKey } : {}),
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: s.mustNotLoad(b, mapping) },
    effectSubset: false, tiers: ['full'],
    authorship: { family: s.FAMILY[b.author], model: b.author, date: b.date || s.today(), source: b.source },
    ...(rev ? { review: { family: s.FAMILY[rev.model], date: s.today(), verdicts: rev.verdicts.map((v) => s.reviewed(v, disposition)) } } : {}),
    pilot: null, lockedAt: null,
  };
}

module.exports = {
  dir: __dirname,
  prompt: { render },
  stage: {
    authEnv: 'T5_AUTH',
    buildTask,
    // A twin's hidden tests sit in `hidden/` (the command runs `hidden/*.test.js`); the other kinds put their files at the top.
    layout: (s, id) => [
      [s.work(id, 'fixture'), path.join(s.dir, 'fixtures', id)],
      [s.work(id, 'hidden'), path.join(s.dir, 'hidden', id, s.brief(id).kind === 'twin' ? 'hidden' : '')],
      [s.work(id, 'solution'), path.join(s.dir, 'solutions', id)],
    ],
    commands: { normalize },
  },
};
