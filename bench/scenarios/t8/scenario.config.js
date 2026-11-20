// SPDX-License-Identifier: Apache-2.0
'use strict';

// T8's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
// Hidden dirs are laid over the workspace root as they are (hidden/<id>/block.test.js, block-kit/), so no canary:
// each tests check names its one test file.
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t8/scenario.config.js [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t8/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t8/scenario.config.js audit|log-author|normalize|map|review|variants|assemble <id>
// Brief kinds: doc (a document ending in a JSON block, graded by block-key.js), bugfix (hidden behaviour tests plus
// regress.test.js), small (negative control: a few plain hidden tests), twin (same fixture as twinOf, a plain ask).

const fs = require('node:fs');
const path = require('node:path');
const { buildHidden } = require('./lib/selfcheck.js');
const { listTree, overlayOf } = require('../lib/workspace.js');

const STACKS = {
  ops: 'An ops folder: logs, metric CSVs, a deploy history, YAML or JSON config, alert definitions, Markdown docs and a few small shell or Python scripts. No package file and no install step.',
  node: 'Node.js 24, CommonJS, no dependencies and no install step. Tests use node:test and node:assert, live in `test/`, run with `node --test test/`, all pass today and finish in under 3 seconds. Include a CI config (`.github/workflows/ci.yml`), a changelog and a package.json.',
};

// `twoStep: true` (a second author family): step `a` writes the generator, the fixture and the request
// (prompts/step-a.md), step `b`, a separate call, the key and the reference (prompts/step-b.md).
function render(id, lib, step = null) {
  const b = lib.brief(id);
  const brief = `${b.brief}\n\n${lib.sourceLine(b.source, 'Use the idea only; write every word and number fresh.')}`;
  if (b.kind === 'twin') return lib.fill(lib.read('prompts/author-twin.md'), { BRIEF: brief, ID: id });
  if (b.twoStep && step !== 'a' && step !== 'b') throw new Error(`${id} is written in two steps: give step a or b`);
  const kindFile = { doc: 'kind-doc.md', bugfix: 'kind-bugfix.md', small: 'kind-small.md' }[b.kind];
  const vars = {
    BRIEF: brief, ID: id, SIZE: b.size, STACK: STACKS[b.stack], LOGLINES: String(b.loglines || 3000),
    VOICE: b.voice || 'an SRE or engineering lead who owns the service, writing to a colleague',
    TESTSRULE: 'One `tests` check exactly as the kind section gives it.',
    OUTFILE: b.outFile || '', BLOCKFIELDS: b.blockFields || '', NITEMS: b.nItems || '12 to 18', KINDEXTRA: b.kindExtra ? `- ${b.kindExtra}` : '',
    EXTRAKEYS: b.kind === 'doc' ? '- `blockKey`: the key, as the kind section describes.' : '',
  };
  vars.KIND = lib.fill(lib.read(`prompts/${kindFile}`), vars);
  const common = lib.fill(lib.read('prompts/author-common.md'), vars);
  if (!b.twoStep) return common;
  // The common prompt's head (intro, brief, fixture rules) opens step a; its tail (task file keys, finish) closes step b.
  const [head, tail] = common.split(vars.KIND);
  if (step === 'a') return `${head}${lib.fill(lib.read('prompts/step-a.md'), { ...vars, SEEDEXTRA: b.seedExtra || '' })}`;
  return lib.fill(lib.read('prompts/step-b.md'), { ...vars, BRIEFLINE: b.briefLine, KINDEXTRA: b.kindExtra || '', TAIL: tail });
}

const AUTHOR_FILES = new Set(['hidden', 'solution', 'kit', 'gen', 'task-draft.json', 'review.json', 'fixture']);

function normalize(s, id) {
  const w = s.work(id);
  if (!fs.existsSync(path.join(w, 'fixture'))) fs.mkdirSync(path.join(w, 'fixture'));
  for (const name of fs.readdirSync(w).filter((n) => !AUTHOR_FILES.has(n))) fs.renameSync(path.join(w, name), path.join(w, 'fixture', name));
  buildHidden(w, s.readJson(path.join(w, 'task-draft.json')));
}

const HURRY = '\nYou have ten minutes before a meeting. Read the README and at most two other small files, do not open the large log, metric or data files, and write a plausible answer from what you saw.\n';
// The lazy answer sees a skim of the folder: every file longer than SKIM_LINES lines is cut to its first SKIM_LINES
// lines, so the model cannot read deeply even when it ignores the hurry note. Its citations are scored on the real files.
const SKIM_LINES = 60;
function skim(root) {
  for (const rel of listTree(root)) {
    const p = path.join(root, rel);
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    if (lines.length > SKIM_LINES) fs.writeFileSync(p, `${lines.slice(0, SKIM_LINES).join('\n')}\n`);
  }
}

// A model of a third family answers the request twice on a copy of the fixture, once with care and once in a hurry on
// a skim of it; the changed files become the batch's answers/<id>/alt and answers/<id>/lazy (paid; the mechanical
// ones from lib/answers.js are free).
function variants(s, id, only) {
  const b = s.brief(id);
  const task = s.readJson(path.join(s.dir, `${id}.json`));
  const fixture = path.join(s.dir, 'fixtures', id);
  const out = {};
  for (const [name, hurry] of [['alt', ''], ['lazy', HURRY]].filter(([n]) => !only || n === only)) {
    const cwd = s.work(`${id}-${name}`);
    const base = s.work(`${id}-${name}-base`);
    for (const d of [cwd, base]) fs.rmSync(d, { recursive: true, force: true });
    fs.cpSync(fixture, base, { recursive: true });
    if (name === 'lazy') skim(base);
    fs.cpSync(base, cwd, { recursive: true });
    const prompt = fs.readFileSync(path.join(s.dir, 'prompts/answer.md'), 'utf8').replace('{{HURRY}}', () => hurry).replace('{{PROMPT}}', () => task.prompt);
    const r = s.call(b.answerer, cwd, prompt, `${id}.${name}`);
    s.logCall(id, `${name} answer`, b.answerer, r);
    out[name] = overlayOf(cwd, base, s.cfg.answerDir(id, name));
  }
  return out;
}

// Owner rule: a task named in a row of HAND-EDITS.md (the kept tasks' table) carries `handEdited`.
function handEditedIds(dir) {
  const file = path.join(dir, 'HAND-EDITS.md');
  if (!fs.existsSync(file)) return new Set();
  const kept = fs.readFileSync(file, 'utf8').split('## Dropped')[0];
  return new Set([...kept.matchAll(/^\| (t8-[a-z0-9-]+(?:, t8-[a-z0-9-]+)*) \|/gm)].flatMap((m) => m[1].split(', ')));
}

function buildTask(s, id) {
  const b = s.brief(id);
  const draft = s.readJson(s.work(id, 'task-draft.json'));
  const disposition = s.workJson(`${id}.disposition.json`, {});
  const mapped = s.workJson(`${id}.map.json`, s.NO_MAPPING);
  // A negative control has no target by definition: what the mapper proposed becomes the loads that must not happen.
  const negative = b.controlKind === 'negative';
  const mapping = negative ? s.NO_MAPPING : mapped;
  if (negative) b.mustNotLoad = [...mapped.targetSkills, ...(mapped.targetSop ? [mapped.targetSop] : [])];
  const rev = s.workJson(`${id}.review.json`);
  // Authors guess seconds of work; an agent needs minutes to read a folder of logs. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits.softSec, b.softSec || 600);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = s.SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(s.YES_SENTENCE) ? `${draft.prompt} ${s.YES_SENTENCE}` : draft.prompt;
  return {
    id, class: 'hard', version: b.version || 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: s.withExpertRubric(draft.rubric, b.expertKey),
    ...(b.expertKey ? { expertKey: b.expertKey } : {}),
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: s.mustNotLoad(b, mapping) },
    effectSubset: false, tiers: ['full'],
    authorship: { family: s.FAMILY[b.author], model: b.author, date: b.date || s.today(), source: b.source },
    ...(rev ? { review: { family: s.FAMILY[rev.model], date: s.today(), verdicts: rev.verdicts.filter((v) => s.REVIEW_CHECKS.has(v.check)).map((v) => s.reviewed(v, disposition)) } } : {}),
    ...(handEditedIds(s.dir).has(id) ? { handEdited: { family: 'claude', editor: 'kirocrew-mate-worker (T8 worker session)', log: 'HAND-EDITS.md' } } : {}),
    pilot: null, lockedAt: null,
  };
}

module.exports = {
  dir: __dirname,
  prompt: { render },
  stage: {
    authEnv: 'T8_AUTH',
    reviewSkip: ['gen'],
    buildTask,
    layout: (s, id) => [
      [s.work(id, 'fixture'), path.join(s.dir, 'fixtures', id)],
      [s.work(id, 'hidden'), path.join(s.dir, 'hidden', id)],
      [s.work(id, 'solution'), path.join(s.dir, 'solutions', id)],
      [s.work(id, 'gen'), path.join(s.dir, 'authoring', id, 'gen')],
    ],
    commands: { normalize, variants },
  },
};
