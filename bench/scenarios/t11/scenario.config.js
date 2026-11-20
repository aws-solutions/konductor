// SPDX-License-Identifier: Apache-2.0
'use strict';

// T11's (konductor plumbing: resume, merge, media and docx inputs, wide change, repo guide) batch config for the
// shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t11/scenario.config.js [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t11/scenario.config.js <id> [step]
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t11/scenario.config.js prepare|audit|log-author|normalize|map|review|assemble <id> [step]   (needs T11_AUTH)
// Brief kinds: code (hidden behaviour tests), doc (a document ending in a JSON block, graded by the shared block key),
// twin (same fixture as twinOf, a plain ask). `fixture: git` gives the fixture its own repository (fixtures/<id>/dotgit),
// `media: png|docx` an image or Word input made by a generator kept under authoring/<id>/gen. A brief with
// `twoStep: true` (the second author family) is written in two calls: step1 writes the fixture and the request,
// step2 the hidden checks and the answers. An answer dir holding APPLY.sh does git work (lib/modes.js).

const fs = require('node:fs');
const path = require('node:path');
const { modesOf, GIT_ENV } = require('./lib/modes.js');
const { buildHidden } = require('./lib/hidden.js');
const { helpers } = require('../lib/prompt.js');

const STACK = 'Node.js 24, CommonJS, no dependencies and no install step. Tests use node:test and node:assert, live in `test/` and run with `node --test test/`.';

function render(id, lib, step = 'author') {
  const { read, fill } = lib;
  const b = lib.brief(id);
  const brief = `${b.brief}\n\n${lib.sourceLine(b.source, 'Use the idea only; write every word, name and number fresh.')}`;
  if (b.kind === 'twin') return fill(read('prompts/author-twin.md'), { BRIEF: brief, ID: id });
  const vars = {
    BRIEF: brief, BRIEFLINE: b.briefLine || b.brief.split('. ').slice(0, 2).join('. '), ID: id, SIZE: b.size, STACK: b.stack || STACK,
    VOICE: b.voice || 'a developer who owns the repository, writing to a colleague',
    NTESTS: b.ntests || '10 to 16', NTRAP: String(b.ntrap || 3),
    OUTFILE: b.outFile || '', BLOCKFIELDS: b.blockFields || '', NITEMS: b.nItems || '12 to 18',
    EXTRAKEYS: b.kind === 'doc' ? '- `blockKey`: the key, as the kind section describes.' : '',
    GITRULE: b.fixture === 'git' ? read('prompts/rule-git.md') : '',
    MEDIARULE: b.media ? read(`prompts/rule-${b.media}.md`) : '',
  };
  vars.KIND = fill(read(`prompts/kind-${b.kind}.md`), vars);
  vars.ANSWERS = fill(read('prompts/answers-and-task.md'), vars);
  const head = `${fill(read('prompts/intro.md'), vars)}\n${fill(read('prompts/fixture-rules.md'), vars)}`;
  if (step === 'step1') return `${head}\n${fill(read('prompts/step1.md'), vars)}`;
  if (step === 'step2') return fill(read('prompts/step2.md'), vars);
  return `${head}\n${vars.KIND}\n${vars.ANSWERS}`;
}

// The author's working dir: kit/ (the self-check and the PNG renderer), the twin's fixture, the prompt of the step.
// step2 keeps what step1 wrote.
function prepare(s, id, step = s.brief(id).twoStep ? 'step1' : 'author') {
  const b = s.brief(id);
  const w = s.work(id);
  if (step !== 'step2') fs.rmSync(w, { recursive: true, force: true });
  fs.mkdirSync(path.join(w, 'kit'), { recursive: true });
  const lib = path.join(__dirname, 'lib');
  fs.writeFileSync(path.join(w, 'kit', 'selfcheck.js'), `// Runs the bench's free dry run over this folder.\nconst { check } = require(${JSON.stringify(path.join(lib, 'selfcheck.js'))});\nconsole.log(JSON.stringify(check(require('node:path').join(__dirname, '..')), null, 2));\n`);
  fs.copyFileSync(path.join(lib, 'render-png.cjs'), path.join(w, 'kit', 'render-png.cjs'));
  if (b.twinOf && step !== 'step2') fs.cpSync(path.join(s.dir, 'fixtures', b.twinOf), path.join(w, 'fixture'), { recursive: true });
  const prompt = s.cfg.prompt.render(id, helpers(s.cfg), step);
  fs.writeFileSync(s.work(`${id}.${step}.prompt.txt`), prompt);
  return { id, step, author: b.author, prompt: s.work(`${id}.${step}.prompt.txt`) };
}

function normalize(s, id) {
  const w = s.work(id);
  if (!fs.existsSync(path.join(w, 'fixture'))) throw new Error(`${id}: the author wrote no fixture/`);
  if (fs.existsSync(path.join(w, 'fixture', '.git'))) fs.renameSync(path.join(w, 'fixture', '.git'), path.join(w, 'fixture', 'dotgit'));
  buildHidden(w, s.readJson(path.join(w, 'task-draft.json')));
}

// Owner rule: a task named in a row of HAND-EDITS.md (the kept tasks' table) carries `handEdited`.
function handEditedIds(dir) {
  const file = path.join(dir, 'HAND-EDITS.md');
  if (!fs.existsSync(file)) return new Set();
  const kept = fs.readFileSync(file, 'utf8').split('## Dropped')[0];
  return new Set([...kept.matchAll(/^\| (t11-[a-z0-9-]+) \|/gm)].map((m) => m[1]));
}

function buildTask(s, id) {
  const b = s.brief(id);
  const draft = s.readJson(s.work(id, 'task-draft.json'));
  const disposition = s.workJson(`${id}.disposition.json`, {});
  const mapping = s.workJson(`${id}.map.json`, s.NO_MAPPING);
  const rev = s.workJson(`${id}.review.json`);
  // Authors guess seconds of work; an agent needs minutes to read a repository. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits?.softSec || 0, b.softSec || 900);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = s.SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(s.YES_SENTENCE) ? `${draft.prompt} ${s.YES_SENTENCE}` : draft.prompt;
  return {
    id, class: 'hard', version: 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: b.twinOf || id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: draft.rubric || [],
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: s.mustNotLoad(b, mapping) },
    effectSubset: false, tiers: ['full'],
    authorship: { family: s.FAMILY[b.author], model: b.author, date: b.date || s.today(), source: b.source, ...(b.twoStep ? { note: 'two-step: step 1 wrote the fixture and the request, step 2 (a separate call) the hidden checks and answers' } : {}) },
    ...(rev ? { review: { family: s.FAMILY[rev.model], date: s.today(), verdicts: rev.verdicts.filter((v) => s.REVIEW_CHECKS.has(v.check)).map((v) => s.reviewed(v, disposition)) } } : {}),
    ...(handEditedIds(s.dir).has(id) ? { handEdited: { family: 'claude', editor: 'kirocrew-mate-worker (T11 worker session)', log: 'HAND-EDITS.md' } } : {}),
    pilot: null, lockedAt: null,
  };
}

module.exports = {
  dir: __dirname,
  env: GIT_ENV,
  modes: (task, cfg) => modesOf({ solution: cfg.solutionDir(task.id), lazy: cfg.answerDir(task.id, 'lazy'), alt: cfg.answerDir(task.id, 'alt') }),
  prompt: { render },
  stage: {
    authEnv: 'T11_AUTH',
    reviewSkip: ['gen', 'design.md'],
    buildTask,
    layout: (s, id) => [
      ...(s.brief(id).twinOf ? [] : [[s.work(id, 'fixture'), path.join(s.dir, 'fixtures', id)]]),
      [s.work(id, 'hidden'), path.join(s.dir, 'hidden', id)],
      [s.work(id, 'solution'), path.join(s.dir, 'solutions', id)],
      [s.work(id, 'lazy'), path.join(s.dir, 'answers', id, 'lazy')],
      [s.work(id, 'alt'), path.join(s.dir, 'answers', id, 'alt')],
      [s.work(id, 'gen'), path.join(s.dir, 'authoring', id, 'gen')],
    ],
    commands: { prepare, normalize },
  },
};
