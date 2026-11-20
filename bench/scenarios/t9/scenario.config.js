// SPDX-License-Identifier: Apache-2.0
'use strict';

// T9's (frontend) batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t9/scenario.config.js [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t9/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t9/scenario.config.js prepare|audit|log-author|normalize|map|review|assemble <id>   (needs T9_AUTH)
// Brief kinds: impl, bugfix, refactor (hidden behaviour tests; bugfix adds the regress kit), mutants and findings (the
// T5 kinds: tests written by the agent are scored by seeded mutants, a review by a findings key), twin (same fixture
// as twinOf, a plain non-UI ask). A brief with `browser: n` adds n browser tests (hidden/browser.test.js, headless
// Chromium through lib/hidden/bench-browser.js). Hidden dirs are laid over the workspace root as they are.

const fs = require('node:fs');
const path = require('node:path');
const { buildHidden, helper } = require('./lib/selfcheck.js');

const STACKS = {
  node: 'Plain JavaScript ES modules (`"type": "module"` in package.json), Node 24, no dependencies, no install step, no bundler. Tests use node:test and node:assert, live in `test/`, and run with `node --test test/`. The logic is DOM-free (stores, view-models, formatters, validators) and the tests call it directly.',
  ts: 'TypeScript source written with erasable syntax only (no enums, namespaces or parameter properties), run directly by Node 24 type stripping: import paths end in `.ts`. No compiler, no dependencies, no install step. Tests use node:test and node:assert, live in `test/` as `*.test.ts`, and run with `node --test test/`. The logic is DOM-free and the tests call it directly.',
  browser: 'A static web app: `index.html` loads ES modules from `src/` with `<script type="module">`, plus CSS. No bundler, no dependencies, no install step, no network at run time (no CDN, no web fonts). Node 24 runs the repository\'s own tests with node:test and node:assert, in `test/`, with `node --test test/`; they cover the DOM-free logic modules only, because no DOM library is installed.',
};
const PLAIN = 'node --test --test-timeout=30000';

function render(id, lib) {
  const { read, fill } = lib;
  const b = lib.brief(id);
  const brief = `${b.brief}\n\n${lib.sourceLine(b.source, 'Use the idea only; write every word and number fresh.')}`;
  if (b.kind === 'twin') return fill(read('prompts/author-twin.md'), { BRIEF: brief, ID: id });
  const browser = Number(b.browser || 0);
  const files = b.kind === 'mutants' ? 'mutation.test.js' : b.kind === 'findings' ? 'findings.test.js'
    : `hidden-behaviour.test.js${browser ? ' browser.test.js' : ''}${b.kind === 'bugfix' ? ' regress.test.js' : ''}`;
  const nmut = b.nmut || 10;
  const nkey = b.nkey || 8;
  const vars = {
    BRIEF: brief, ID: id, SIZE: b.size, STACK: STACKS[b.stack],
    VOICE: b.voice || 'a front-end developer who owns the repository, talking to a colleague',
    QUESTIONS_NOTE: b.questionsNote || '', EXTRAKEYS: b.kind === 'findings' ? '- `findingsKey` (the key, as the kind section describes) and `findingsFile` (the document path the request names).' : '',
    TESTFILE: 'hidden-behaviour.test.js', NTESTS: b.ntests || '10 to 14', NTRAP: String(b.ntrap || 3), NDECOY: String(b.ndecoy || 2), NBROWSER: String(browser),
    TESTCMD: `${PLAIN} ${files}`, TESTMIN: b.kind === 'findings' ? String(2 * nkey + 1) : b.kind === 'mutants' ? String(nmut) : 'the exact number of tests in the listed files',
    NMUT: String(nmut), SURVIVE: String(nmut - 2), RUNNER: 'node', MUTCMD: 'node --test --test-timeout=4000 test/', PYCFG: '',
    NKEY: String(nkey), EXTRA: b.keyExtra || 'Give each item a different location.',
  };
  vars.BROWSER = browser ? fill(read('prompts/kind-browser.md'), vars) : '';
  const kindFile = { impl: 'prompts/kind-impl.md', bugfix: 'prompts/kind-bugfix.md', refactor: 'prompts/kind-refactor.md', mutants: '../t5/prompts/kind-mutants.md', findings: '../t5/prompts/kind-findings.md' }[b.kind];
  vars.KIND = fill(read(kindFile), vars);
  return fill(read('prompts/author-common.md'), vars);
}

// Creates the author's working dir: kit/ (the self-check and the helpers it builds from), the twin's fixture, the prompt.
function prepare(s, id) {
  const b = s.brief(id);
  const w = s.work(id);
  fs.rmSync(w, { recursive: true, force: true });
  fs.mkdirSync(path.join(w, 'kit'), { recursive: true });
  for (const name of ['selfcheck.js']) fs.copyFileSync(path.join(__dirname, 'lib', name), path.join(w, 'kit', name));
  for (const name of ['regress.test.js', 'mutants.js', 'mutation.test.js', 'findings-key.cjs', 'findings.test.js', 'bench-browser.js']) fs.copyFileSync(helper(name), path.join(w, 'kit', name));
  if (b.twinOf) fs.cpSync(path.join(s.dir, 'fixtures', b.twinOf), path.join(w, 'fixture'), { recursive: true });
  const { render: renderPrompt } = require('../lib/prompt.js');
  fs.writeFileSync(s.work(`${id}.author.prompt.txt`), renderPrompt(s.cfg, id));
  return { id, author: b.author, prompt: s.work(`${id}.author.prompt.txt`) };
}

function normalize(s, id) {
  const w = s.work(id);
  const draft = s.readJson(path.join(w, 'task-draft.json'));
  if (!fs.existsSync(path.join(w, 'fixture'))) throw new Error(`${id}: the author wrote no fixture/`);
  buildHidden(w, draft);
}

function buildTask(s, id) {
  const b = s.brief(id);
  const draft = s.readJson(s.work(id, 'task-draft.json'));
  const disposition = s.workJson(`${id}.disposition.json`, {});
  const mapped = s.workJson(`${id}.map.json`, s.NO_MAPPING);
  // A twin has no target by definition of its control: it keeps the mapping, and must not load its source's units.
  const mapping = mapped;
  const rev = s.workJson(`${id}.review.json`);
  // Authors guess seconds of work; an agent needs minutes to read a repository. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits.softSec, b.softSec || 600);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = s.SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(s.YES_SENTENCE) ? `${draft.prompt} ${s.YES_SENTENCE}` : draft.prompt;
  return {
    id, class: 'hard', version: 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: b.twinOf || id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: draft.rubric || [],
    ...(draft.findingsKey ? { findingsKey: draft.findingsKey } : {}),
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: s.mustNotLoad(b, mapping) },
    effectSubset: false, tiers: ['full'],
    authorship: { family: s.FAMILY[b.author], model: b.author, date: b.date || s.today(), source: b.source },
    ...(rev ? { review: { family: s.FAMILY[rev.model], date: s.today(), verdicts: rev.verdicts.filter((v) => s.REVIEW_CHECKS.has(v.check)).map((v) => s.reviewed(v, disposition)) } } : {}),
    pilot: null, lockedAt: null,
  };
}

module.exports = {
  dir: __dirname,
  prompt: { render },
  stage: {
    authEnv: 'T9_AUTH',
    buildTask,
    layout: (s, id) => [
      ...(s.brief(id).twinOf ? [] : [[s.work(id, 'fixture'), path.join(s.dir, 'fixtures', id)]]),
      [s.work(id, 'hidden'), path.join(s.dir, 'hidden', id)],
      [s.work(id, 'solution'), path.join(s.dir, 'solutions', id)],
      [s.work(id, 'lazy'), path.join(s.dir, 'answers', id, 'lazy')],
      [s.work(id, 'alt'), path.join(s.dir, 'answers', id, 'alt')],
    ],
    commands: { prepare, normalize },
  },
};
