// SPDX-License-Identifier: Apache-2.0
'use strict';

// T10's (long multi-phase, idea to ship) batch config for the shared scenario tools (bench/scenarios/lib/config.js
// lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t10/scenario.config.js [id ...]
//   node bench/scenarios/lib/answers.js --config bench/scenarios/t10/scenario.config.js lazy|alt [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t10/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t10/scenario.config.js prepare|audit|log-author|normalize|map|review|assemble <id> [step]   (needs T10_AUTH)
// Brief kinds: phased (a product ask, a design note, the build with tests and CI, a rollout plan and release note; scored
// by hidden behaviour tests, a key over the design note's closing JSON block, a key over the rollout plan's, other
// checks, and an expert key for the judges) and small (the negative control: a small clear change in a big repository,
// a few plain hidden tests). A brief with `twoStep: true` is written by the second family in two calls: `prepare <id>
// fixture` (repository, request, PLANTED.md), then `prepare <id> key` (hidden tests, keys, reference solution).

const fs = require('node:fs');
const path = require('node:path');
const { buildHidden, helper } = require('./lib/selfcheck.js');

const STACKS = {
  cjs: 'Plain JavaScript (CommonJS), Node 24, no dependencies, no install step, no bundler. Tests use node:test and node:assert, live in `test/` and run with `node --test` (no path argument: Node finds the `*.test.js` files).',
  esm: 'Plain JavaScript ES modules (`"type": "module"` in package.json), Node 24, no dependencies, no install step, no bundler. Tests use node:test and node:assert, live in `test/` and run with `node --test` (no path argument: Node finds the `*.test.js` files).',
  ts: 'TypeScript source written with erasable syntax only (no enums, namespaces or parameter properties), run directly by Node 24 type stripping: import paths end in `.ts`. No compiler, no dependencies, no install step. Tests use node:test and node:assert, live in `test/` as `*.test.ts`, and run with `node --test` (no path argument: Node finds the `*.test.js` files).',
};

const stepOf = (b, step) => step || (b.twoStep ? 'fixture' : 'all');

function render(id, lib, step) {
  const { read, fill } = lib;
  const b = lib.brief(id);
  const brief = `${b.brief}\n\n${lib.sourceLine(b.source, 'Use the idea only; write every word and number fresh.')}`;
  const vars = {
    BRIEF: brief, ID: id, SIZE: b.size || '50 to 70', STACK: STACKS[b.stack || 'cjs'],
    VOICE: b.voice || 'a product or engineering colleague who owns the service, writing to the engineer who will do the work',
    NTESTS: b.ntests || '16 to 20', NTRAP: String(b.ntrap || 5), NDESIGN: b.ndesign || '6 to 8', NROLLOUT: b.nrollout || '5 to 6',
    NEXPERT: b.nexpert || '6 to 8', NNEWTESTS: String(b.nnewtests || 6),
  };
  if (b.kind === 'small') return fill(read('prompts/head.md') + read('prompts/kind-small.md'), vars);
  const s = stepOf(b, step);
  if (s === 'fixture') return fill(read('prompts/head-fixture.md') + read('prompts/part-fixture.md') + read('prompts/part-planted.md') + '\nIn step A, `task-draft.json` holds only `id` (`{{ID}}`) and `prompt`. Do not write `hidden/`, `solution/` or any key. Verify before you finish: run the fixture\'s own tests, check that every place named in PLANTED.md exists and shows the trap, and that nothing in the fixture describes a trap or the requested design. Keep everything plain, original and free of internal names, host paths, usernames or secrets. Print a short list of what you verified.\n', vars);
  if (s === 'key') return fill(read('prompts/head-key.md') + read('prompts/part-key.md'), vars);
  return fill(read('prompts/head.md') + read('prompts/part-fixture.md') + read('prompts/part-key.md'), vars);
}

// Creates the author's working dir: kit/ (the self-check and the helpers it builds from) and the prompt. Step `key` keeps
// the work dir that step `fixture` wrote.
function prepare(s, id, step) {
  const b = s.brief(id);
  const st = stepOf(b, step);
  const w = s.work(id);
  if (st !== 'key') fs.rmSync(w, { recursive: true, force: true });
  fs.mkdirSync(path.join(w, 'kit'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'lib', 'selfcheck.js'), path.join(w, 'kit', 'selfcheck.js'));
  for (const name of ['block-key.js', 'block.test.js']) fs.copyFileSync(helper(name), path.join(w, 'kit', name));
  const { helpers } = require('../lib/prompt.js');
  const out = s.work(`${id}.author${st === 'all' || st === 'fixture' ? '' : `-${st}`}.prompt.txt`);
  fs.writeFileSync(out, s.cfg.prompt.render(id, helpers(s.cfg), st));
  return { id, step: st, author: b.author, prompt: out };
}

// Logs the credits of the second call of a two-step task (step B, the key writer: author-key stream, brief.keyAuthor).
function logKey(s, id) {
  const model = s.brief(id).keyAuthor;
  const { credits } = s.streamInfo(s.work(`${id}.author-key.out`));
  s.logCall(id, 'author-key', model, { credits, seconds: 0 });
  return { model, credits };
}

// A hand-edited task is re-checked by a non-Claude model against the owner's four-item checklist (work/<id>/EDITS.md says
// what changed); the answer becomes review.recheck in the task file.
function recheck(s, id) {
  const model = s.brief(id).reviewer;
  const cwd = s.work(`${id}-recheck`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.cpSync(s.work(id), cwd, { recursive: true });
  fs.rmSync(path.join(cwd, 'kit'), { recursive: true, force: true });
  const r = s.call(model, cwd, fs.readFileSync(path.join(s.dir, 'prompts', 'recheck.md'), 'utf8'), `${id}.recheck`);
  s.logCall(id, 'recheck', model, r);
  const file = path.join(cwd, 'recheck.json');
  const out = fs.existsSync(file) ? s.readJson(file) : s.jsonIn(r.finalText);
  fs.writeFileSync(s.work(`${id}.recheck.json`), `${JSON.stringify({ model, date: s.today(), ...out }, null, 2)}\n`);
  return out;
}

function normalize(s, id) {
  const w = s.work(id);
  if (!fs.existsSync(path.join(w, 'fixture'))) throw new Error(`${id}: the author wrote no fixture/`);
  buildHidden(w, s.readJson(path.join(w, 'task-draft.json')));
}

// Owner rule: a task named in a row of HAND-EDITS.md (the kept tasks' table) carries `handEdited`.
function handEditedIds(dir) {
  const file = path.join(dir, 'HAND-EDITS.md');
  if (!fs.existsSync(file)) return new Set();
  const kept = fs.readFileSync(file, 'utf8').split('## Dropped')[0];
  return new Set([...kept.matchAll(/^\| (t10-[a-z0-9-]+(?:, t10-[a-z0-9-]+)*) \|/gm)].flatMap((m) => m[1].split(', ')));
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
  const rc = s.workJson(`${id}.recheck.json`);
  // Authors guess seconds of work; a build from an idea needs half an hour or more. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits.softSec, b.softSec || 1800);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = s.SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(s.YES_SENTENCE) ? `${draft.prompt} ${s.YES_SENTENCE}` : draft.prompt;
  const expertKey = draft.expertKey && draft.expertKey.items ? draft.expertKey : null;
  return {
    id, class: 'hard', version: b.version || 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: s.withExpertRubric(draft.rubric, expertKey, 'the items are design judgment, not a pattern in the text'),
    ...(expertKey ? { expertKey } : {}),
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: s.mustNotLoad(b, mapping) },
    effectSubset: false, tiers: ['full'],
    authorship: { family: s.FAMILY[b.author], model: b.author, date: b.date || s.today(), source: b.source },
    ...(rev ? { review: { family: s.FAMILY[rev.model], date: s.today(), verdicts: rev.verdicts.filter((v) => s.REVIEW_CHECKS.has(v.check)).map((v) => s.reviewed(v, disposition)), ...(rc ? { recheck: { family: s.FAMILY[rc.model], model: rc.model, date: rc.date, items: rc.items.map(({ check, verdict, note }) => ({ check, verdict, ...(note ? { note } : {}) })) } } : {}) } } : {}),
    ...(handEditedIds(s.dir).has(id) ? { handEdited: { family: 'claude', editor: 'kirocrew-mate-worker (T10 worker session)', log: 'HAND-EDITS.md' } } : {}),
    pilot: null, lockedAt: null,
  };
}

// The reference's config files (JSON, YAML, CSV) are part of the build, not part of the answer: the lazy answer drops
// half of them, the alternative keeps them. Ordered lists in the documents' JSON blocks stay in order.
const answers = {
  codeExt: /\.(c?js|mjs|ts|py|sh|ya?ml|toml|sql|json|csv)$/i,
  orderedKeys: /path|order|chain|sequence|milestones|steps|timeline|phases|rings|stages/i,
};

module.exports = {
  dir: __dirname,
  answers,
  prompt: { render },
  stage: {
    authEnv: 'T10_AUTH',
    buildTask,
    layout: (s, id) => [
      [s.work(id, 'fixture'), path.join(s.dir, 'fixtures', id)],
      [s.work(id, 'hidden'), path.join(s.dir, 'hidden', id)],
      [s.work(id, 'solution'), path.join(s.dir, 'solutions', id)],
    ],
    commands: { prepare, normalize, recheck, 'log-key': logKey },
  },
};
