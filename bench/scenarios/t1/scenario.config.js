// SPDX-License-Identifier: Apache-2.0
'use strict';

// T1's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t1/scenario.config.js [id ...] [--record] [--json]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t1/scenario.config.js <id> [data|key]
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t1/scenario.config.js map|review|fix|answers|recheck|log-author|assemble <id>   (needs T1_AUTH)
// The dry run also scores the free shallow answer (the reference's docs, config and tests without its code changes;
// gate 40 or less) and drops a hung test into a copy of the hidden dir (the canary). Python tasks name the shared bridge
// and timeout helper (bench/scenarios/lib/hidden) in .bench-lib.json.
// Stage steps after the author call: map (a third family tags the task from skill descriptions only), review (another
// family), fix (one fix round from the review and the dry run: write the dry run's --json output to work/<id>.dry.json),
// answers (a third family writes a lazy and an alternative answer), recheck (a non-Claude checklist re-review of a
// hand-edited task), log-author <id> [step], assemble. Every model call appends its credits to AUTHORING-LOG.md.
// `dry-run.js --record` writes pilot.dryRun; its lazy figure is the higher of the lazy and the shallow answer.

const fs = require('node:fs');
const path = require('node:path');
const { shallowOverlay } = require('../lib/answers.js');

const DIR = __dirname;
const helper = (name) => fs.readFileSync(path.join(DIR, '..', 'lib', 'hidden', name), 'utf8');

const STACKS = {
  node: {
    stack: 'Node.js 24, CommonJS or ES modules as the project already uses, no dependencies and no install step. Tests use node:test and node:assert and run with `node --test`.',
    hidden: 'Hidden tests are `hidden/*.test.js` files using node:test and node:assert.',
    testCmd: '`node --test --test-timeout=15000 hidden/*.test.js`',
  },
  python: {
    stack: 'Python 3.12, standard library only, no install step. Tests use unittest and run with `python3 -m unittest`.',
    hidden: () => `Hidden tests are unittest modules \`hidden/py/test_*.py\` that subclass \`TimedCase\` from \`hidden/py/timeouts.py\` instead of unittest.TestCase (a per-test time limit). Add the paths your tests need to sys.path yourself; the repository root is on PYTHONPATH. Also write these two bench-provided files exactly as shown, so you can run the tests; do not change them.\n\n\`hidden/py/timeouts.py\`:\n\n\`\`\`python\n${helper('timeouts.py')}\`\`\`\n\n\`hidden/py_bridge.test.js\`:\n\n\`\`\`js\n${helper('py_bridge.test.js')}\`\`\`\n\nThe bridge runs the Python tests once and makes node:test see one test per Python test. To run your hidden tests yourself use \`node --test hidden/py_bridge.test.js\` from the repository root (fixture plus solution).`,
    testCmd: '`python3 -c "import sys; assert sys.version_info[:2] == (3, 12)" && node --test --test-timeout=15000 hidden/py_bridge.test.js`',
  },
};

// Same wording as an original idea or a public source; `step` is a step of the two-step author flow (data, then key).
const sourceText = (src) => `Public inspiration: ${src === 'original' ? 'none (original idea)' : `${src.url} (licence ${src.licence}). Use the idea only.`}`;

function render(id, lib, step = null) {
  const { read } = lib;
  const b = lib.brief(id);
  const s = STACKS[b.stack];
  const hidden = typeof s.hidden === 'function' ? s.hidden() : s.hidden;
  const brief = `${b.brief}\n\n${sourceText(b.source)}`;
  const economy = b.economy ? '\n\nScope limit: keep the fixture near the low end of the file range, keep the hidden tests and the solution compact, write each file once, verify at most twice, and finish within about 45 tool calls. A call that runs long is stopped.' : '';
  const expert = b.phase === 'nfr' ? '\n\nThis task also needs an `expertKey` in `task-draft.json`: `{ "items": [ { "id", "text" } ], "weakAnswers": [ ... ] }` with 4 to 5 items and 3 to 5 weak answers. Items are what a careful engineer would also say or show in the final message beyond what the hidden tests already check (causes found, how the limits were measured, trade-offs, what was left out), each one a sentence a reviewer can look for. weakAnswers are what a shallow answer would say. Do not repeat anything a hidden test checks.' : '';
  const fill = { BRIEF: brief, SIZE: b.size, STACK: s.stack, HIDDEN: hidden, TESTCMD: s.testCmd, ID: b.id };
  if (step === 'data' || step === 'key') return read(`prompts/author-${step}.md`).replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k]) + (b.onFixture && step === 'data' ? '\n\nThis task runs on an existing repository: `fixture/` is already in the current directory. Do not change it; write only `task-draft.json`.' : '');
  if (b.onFixture) return read('prompts/twin.md').replace(/\{\{(\w+)\}\}/g, (_, k) => ({ BRIEF: b.brief, HIDDEN: hidden, TESTCMD: s.testCmd, ID: b.id })[k]);
  return read('prompts/author.md').replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k]) + economy + expert;
}

function fix(s, id) {
  const b = s.brief(id);
  const rev = s.readJson(s.work(`${id}.review.json`));
  const fails = rev.verdicts.filter((v) => v.verdict === 'fail').map((v) => `- ${v.check}: ${v.note}`);
  // The free dry run's findings, when it ran: which checks failed on the reference and how the stub scored.
  const dryFile = s.work(`${id}.dry.json`);
  const dry = fs.existsSync(dryFile) && fs.statSync(dryFile).size ? s.readJson(dryFile) : null;
  // dry.json is the --json output of bench/scenarios/lib/dry-run.js for this task (a list of one result).
  const d = Array.isArray(dry) ? dry[0] : dry;
  const dryLines = d ? (d.failing?.reference || []).map((c) => `- dry run, reference: check failed (${c})`) : [];
  if (d && d.scores.stub > 20) dryLines.push(`- dry run: the untouched fixture scores ${d.scores.stub} (must be 20 or less)`);
  const problems = [...dryLines, ...fails, ...(rev.reference?.failingChecks || []).map((c) => `- reference run: ${c}`), ...(rev.fixes || []).map((f) => `- suggested fix: ${f}`)].join('\n');
  const w = s.work(id);
  fs.rmSync(`${w}.v1`, { recursive: true, force: true });
  fs.cpSync(w, `${w}.v1`, { recursive: true });
  const extra = `\n\n## Fix round\n\nThe files you wrote are in the current directory. A reviewer ran them and found these problems:\n\n${problems}\n\nFix them in place and delete any stray or abandoned files (a solution overlay must contain only files that belong in the finished change; hidden tests must find the code they import without help from the environment, for example by adding the source folder to sys.path or requiring it by relative path). Then verify again from a scratch folder: existing tests pass on fixture plus solution, every hidden test and every check passes on fixture plus solution, and at most 20% of hidden tests pass on the plain fixture. Finish within about 30 tool calls. Keep the same task id and the same file layout.`;
  const prompt = require('../lib/prompt.js').render(s.cfg, id) + extra;
  const r = s.call(b.author, w, prompt, `${id}.fix`);
  s.logCall(id, 'fix', b.author, r);
  const { credits } = r;
  return { credits };
}

// An author guesses its own time; a developer task gets at least 600 s soft and twice that hard (limits are re-set after the pilot).
const limitsOf = (l) => { const softSec = Math.max(l.softSec, 600); return { softSec, hardSec: Math.max(l.hardSec, softSec * 2) }; };

// The answer writer is never the author's family: a gpt-written task gets glm-5 (qwen3-coder-next wrote lazy answers as complete as its alternatives), any other gets gpt-5.6-luna.
const answerModel = (author) => (author === 'gpt-5.6-luna' ? 'glm-5' : 'gpt-5.6-luna');

function answers(s, id) {
  const task = s.readJson(path.join(DIR, `${id}.json`));
  const model = answerModel(task.authorship.model);
  const cwd = s.work(`${id}-answers`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.mkdirSync(cwd, { recursive: true });
  fs.cpSync(path.join(DIR, 'fixtures', task.fixture || id), path.join(cwd, 'repo'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'request.md'), `${task.prompt}\n`);
  const r = s.call(model, cwd, fs.readFileSync(path.join(DIR, 'prompts', 'answers.md'), 'utf8'), `${id}.answers`);
  s.logCall(id, 'lazy+alt answers', model, r);
  const { credits } = r;
  for (const kind of ['lazy', 'alt']) {
    const from = path.join(cwd, kind);
    const to = path.join(DIR, 'answers', id, kind);
    fs.rmSync(to, { recursive: true, force: true });
    if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
  }
  return { model, credits };
}

function recheck(s, id) {
  const file = path.join(DIR, `${id}.json`);
  const task = s.readJson(file);
  const model = 'glm-5';
  const cwd = s.work(`${id}-recheck`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.mkdirSync(cwd, { recursive: true });
  fs.cpSync(path.join(DIR, 'fixtures', task.fixture || id), path.join(cwd, 'fixture'), { recursive: true });
  fs.cpSync(path.join(DIR, 'hidden', id, 'hidden'), path.join(cwd, 'hidden'), { recursive: true });
  fs.cpSync(path.join(DIR, 'solutions', id), path.join(cwd, 'solution'), { recursive: true });
  const { review, pilot, handEdited, ...shown } = task;
  fs.writeFileSync(path.join(cwd, 'task.json'), `${JSON.stringify(shown, null, 2)}\n`);
  const rows = fs.readFileSync(path.join(DIR, 'HAND-EDITS.md'), 'utf8').split('\n').filter((l) => l.startsWith(`| ${id} |`));
  fs.writeFileSync(path.join(cwd, 'edits.md'), `${rows.join('\n')}\n`);
  s.logCall(id, 'recheck', model, s.call(model, cwd, fs.readFileSync(path.join(DIR, 'prompts', 'recheck.md'), 'utf8'), `${id}.recheck`));
  const out = s.readJson(path.join(cwd, 'recheck.json'));
  task.review.recheck = { family: s.FAMILY[model], model, date: s.today(), items: out.items.map((i) => ({ check: i.check, verdict: i.verdict, note: i.note })) };
  fs.writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`);
  return task.review.recheck;
}

const sourceNote = (s) => (s === 'original' ? 'original (author-written; idea only)' : `${s.url} (${s.licence}; idea only, paraphrased)`);

function buildTask(s, id) {
  const b = s.brief(id);
  const draft = s.readJson(s.work(id, 'task-draft.json'));
  const mapping = s.workJson(`${id}.map.json`, s.NO_MAPPING);
  const rev = s.workJson(`${id}.review.json`);
  return {
    id: b.id,
    class: 'hard',
    version: 1,
    phase: b.phase,
    role: b.role,
    questions: 'allowed',
    prompt: draft.prompt,
    fixture: b.onFixture || b.id,
    hidden: b.id,
    timeoutSec: limitsOf(draft.limits).hardSec,
    limits: limitsOf(draft.limits),
    checks: draft.checks,
    rubric: draft.rubric.map((r) => ({ weight: 1, ...r })),
    targetSkills: mapping.targetSkills,
    targetSop: mapping.targetSop,
    targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none',
    ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    ...(draft.expertKey ? { expertKey: { items: draft.expertKey.items.map((i) => ({ id: i.id, text: i.text, source: i.source || sourceNote(b.source) })), weakAnswers: draft.expertKey.weakAnswers } } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: b.mustNotLoad || [] },
    tiers: ['full'],
    authorship: { family: s.FAMILY[b.author], model: b.author, date: b.date || s.today(), source: b.source === 'original' ? 'original' : b.source },
    ...(rev ? { review: { family: s.FAMILY[rev.model], date: s.today(), verdicts: rev.verdicts.map((v) => ({ check: v.check, verdict: v.verdict, note: v.note })) } } : {}),
  };
}

module.exports = {
  dir: DIR,
  canary: { node: 'hidden/zz-canary.test.js', python: 'hidden/py/test_zz_canary.py' },
  variants: (task, cfg) => [{ name: 'shallow', overlay: shallowOverlay(cfg.solutionDir(task.id)) }],
  prompt: { render },
  stage: {
    authEnv: 'T1_AUTH',
    // T1_RUN names a spend-checked wrapper to use instead of run.sh; a call stopped before it reported is logged at
    // its 15-credit abort limit, marked as an estimate.
    runEnv: 'T1_RUN',
    abortCredits: 15,
    logRow: (id, step, model, r) => `| ${id} | ${step} | ${model} | ${r.credits.toFixed(2)}${r.estimated ? ' (estimate: stopped before it reported; logged at the 15-credit abort limit)' : ''} |`,
    buildTask,
    layout: (s, id) => [
      ...(s.brief(id).onFixture ? [] : [[s.work(id, 'fixture'), path.join(DIR, 'fixtures', id)]]),
      [s.work(id, 'hidden'), path.join(DIR, 'hidden', id, 'hidden')],
      [s.work(id, 'solution'), path.join(DIR, 'solutions', id)],
    ],
    commands: { fix, answers, recheck },
  },
};
