// SPDX-License-Identifier: Apache-2.0
'use strict';

// T6's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t6/scenario.config.js [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t6/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t6/scenario.config.js assemble <id>   (T6_AUTH/work/<id>/ holds
//     the author's fixture/, hidden/, solution/ and task-draft.json; work/<id>.map.json and work/<id>.review.json are optional)
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t6/scenario.config.js write-answers <id|all>   (free)
// Scripted tasks: the fake user (tools/fake-user.js) answers the asks of each scored answer (ASKS.json in the overlay:
// solutions/<id>/ for the reference, answers/<id>/<kind>/ for the lazy and alternative answers); the stub asks nothing.
// The reference asks must unlock every fact, a bare "anything else?" none, and the prompt must not repeat a fact.
// The hidden doc-key.js comes from bench/scenarios/lib/hidden (.bench-lib.json); answers.json stays in each hidden dir.

const fs = require('node:fs');
const path = require('node:path');
const { converse, unmatchedFacts } = require('./tools/fake-user.js');

const DIR = __dirname;
const GENERIC_ASK = 'Is there anything else I should know before I start?';
const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'qwen', 'minimax-m2.5': 'minimax' };
const DATE = '2026-11-19';
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const SCRIPTED = `2. The scripted user (\`scriptedUser\` in task-draft.json). The colleague knows 4 to 8 facts that are NOT in the fixture or the request, that a careful practitioner would think to ask about after reading the folder (the folder shows the gap, for example data with two time zones but no rule for them), and that change the requirements. For each fact write:
   - \`id\`: F1, F2, ...
   - \`answer\`: one or two sentences in the colleague's voice with a specific value that cannot be guessed (a number, a date, a named rule).
   - \`topics\`: 3 to 8 lowercase plain words or short phrases (NOT regexes), matched as case-insensitive substrings of the agent's question (no regex syntax, no bare numbers), that a natural question about this subject would contain; include synonyms and word stems (for example "time zone", "timezone", "quiet hour", "night", "how early"). They must not match the generic question "Is there anything else I should know before I start?", and two facts should not share most topics.
   \`defaultReply\` is exactly: "I'm not sure, use your judgement."
3. \`hidden/\`: copy \`kit/doc-key.js\` to \`hidden/doc-key.js\` unchanged, and write \`hidden/requirements.test.js\`:
   \`\`\`js
   const test = require('node:test');
   const assert = require('node:assert/strict');
   const { scriptedSuite } = require('./doc-key');
   scriptedSuite(test, assert, { doc: 'docs/requirements.md', facts: [{ id: 'F1', all: [/.../i, /.../i], wrong: [/.../i] } /* one per fact */], ground: ['data/example.csv' /* fixture files whose numbers a requirement may use */] });
   \`\`\`
   - \`all\`: 1 to 3 regexes that must ALL match inside one requirement's text when the fact is stated correctly. Accept reasonable wordings and number formats, never a vague mention.
   - \`wrong\`: 0 to 2 regexes for plausible wrong values a guesser would write (a common default).
   - \`ground\`: every fixture file whose numbers may legitimately appear in a requirement (the suite counts a requirement with a number found in no fact answer and no ground file as invented).
   Then write \`hidden/grounded.test.js\` with 2 or 3 tests for important requirements that come from the fixture itself (a careful reader finds them, a quick one misses them), using \`requirementTexts(blockOf('docs/requirements.md'))\`.
4. \`solution/\`: the reference. \`solution/docs/requirements.md\` is a good requirements document that ends with the JSON block and states every fact and the grounded requirements. \`solution/ASKS.json\` is a JSON array of 2 to 4 strings: the asking turns a competent colleague would send after reading the folder, in natural wording, with 6 question marks or fewer in total, that together unlock every fact.
   Also write \`task-draft.json\`, one JSON object with exactly these keys:
   - \`id\`: \`{{id}}\`
   - \`prompt\`: 40 to 140 words, as vague as a real first message. Say what is wanted and for whom, name the output path \`docs/requirements.md\`, and include this sentence: End the file with a \`\`\`json block of the form {"requirements": [{"id": "R1", "text": "..."}], "assumptions": ["..."]}. (Your rule, not a sentence for the prompt: the prompt must not state any of the facts.)
   - \`scriptedUser\`: { "facts": [{ "id", "topics", "answer" }], "defaultReply" }
   - \`checks\`: one \`tests\` check exactly { "type": "tests", "cmd": "node --test --test-timeout=15000 hidden/*.test.js", "min": N, "weight": 1, "kind": "substance" } where N is the number of hidden tests, plus 3 to 6 other checks: \`file_exists\` for the output, \`fixture_unchanged\` on the input folders (\`path\` is a folder or file of the fixture), a \`cmd\` using node that checks the JSON block parses and has at least 5 requirements with ids, a \`contains\` (\`path\`, \`pattern\` as a case-insensitive JavaScript regex) for listed assumptions or open points. Each has \`weight\` 1 to 3 and \`kind\` "substance" or "format" (format = layout or wording only). At most 25% of the substance weight of these other checks may pass on the untouched fixture.`;

const DOC = `2. \`hidden/\`: copy \`kit/doc-key.js\` to \`hidden/doc-key.js\` unchanged, and write 8 to 16 tests in \`hidden/*.test.js\` (node:test and node:assert/strict), each independent and deterministic, reading the JSON block of the output with \`blockOf\`. Each seeded insight or trap is one or more tests, like a findings key: the main finding, each key evidence number (allow rounding where a share is computed), the options, the recommendation, the measure with its baseline. Add 1 or 2 precision tests (for example: the decoy is not given as the cause; no more than K items). Accept reasonable wording (regex alternatives) and number formats.
3. \`solution/\`: the reference output at its path (an overlay on the fixture). It must pass every hidden test.
4. \`task-draft.json\`, one JSON object with exactly these keys:
   - \`id\`: \`{{id}}\`
   - \`prompt\`: {{promptWords}} words. Say what is wanted, give the output path \`{{out}}\` and the exact JSON block shape the tests read (field names and what each holds).
   - \`checks\`: one \`tests\` check exactly { "type": "tests", "cmd": "node --test --test-timeout=15000 hidden/*.test.js", "min": N, "weight": 1, "kind": "substance" } where N is the number of hidden tests, plus 3 to 6 other checks: \`file_exists\`, \`fixture_unchanged\` on the inputs (\`path\` is a folder or file of the fixture), \`cmd\` with node or POSIX tools, \`contains\` / \`not_contains\` / \`min_matches\` (\`path\`, \`pattern\` as a case-insensitive JavaScript regex). Each has \`weight\` 1 to 3 and \`kind\` "substance" or "format". At most 25% of the substance weight of these other checks may pass on the untouched fixture.`;

const TAIL = `
   - \`rubric\`: 0 to 2 items { "id", "criterion", "weight" } for what code cannot check, each ending "(code cannot check this because ...)". Do not reward length or formatting.
   - \`limits\`: { "softSec", "hardSec" }: the time a competent agent needs, hardSec twice softSec.
   - \`notes\`: 3 to 6 sentences for the reviewer: the traps, where the fixture shows each one, and what a quick answer misses.`;

function render(id, lib) {
  const brief = lib.brief(id);
  const tpl = lib.read('prompts/author.md');
  const scripted = brief.kind === 'scripted';
  const negative = brief.kind === 'negative';
  const fill = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (v[k] ?? `{{${k}}}`));
  const v = {
    id: brief.id, phase: brief.phase, role: brief.role, repo: brief.repo, idea: brief.idea, out: brief.out,
    promptWords: negative ? '40 to 120' : '80 to 220',
    sourceLine: typeof brief.source === 'object' ? `Public inspiration (idea only, nothing copied): ${brief.source.url} (licence ${brief.source.licence}).` : 'Source: original.',
    fixtureSize: brief.kind === 'twin' ? 'it is already in `fixture/`; do not change it' : negative ? '15 to 25 files' : '20 to 40 files, code files only where the brief says so (Node.js 24, no dependencies, tests with node --test that pass)',
    questionRule: 'Do not mention questions at all: neither invite them nor forbid them.',
  };
  v.kindSection = fill(scripted ? SCRIPTED : DOC, v) + fill(TAIL, v);
  return fill(tpl, v);
}


const asksOf = (dir) => (dir && fs.existsSync(path.join(dir, 'ASKS.json')) ? readJson(path.join(dir, 'ASKS.json')) : []);

function conversation(task, mode) {
  if (!task.scriptedUser) return null;
  if (mode === 'stub') return { questions: [] };
  const dir = mode === 'reference' ? path.join(DIR, 'solutions', task.id) : path.join(DIR, 'answers', task.id, mode);
  return converse(task, asksOf(dir));
}

function taskErrors(task) {
  const errors = [];
  const answers = path.join(DIR, 'hidden', task.hidden ?? task.id, 'hidden', 'answers.json');
  if (task.scriptedUser) {
    const want = JSON.stringify(task.scriptedUser.facts.map((f) => f.answer));
    let got = null;
    try { got = JSON.stringify(readJson(answers)); } catch { /* missing */ }
    if (got !== want) errors.push('hidden answers.json does not match scriptedUser');
    const asks = asksOf(path.join(DIR, 'solutions', task.id));
    if (!asks.length) errors.push('scripted task needs solutions/<id>/ASKS.json with the reference asks');
    const missing = unmatchedFacts(task, converse(task, asks));
    if (missing.length) errors.push(`reference asks do not unlock: ${missing.join(', ')}`);
    const generic = converse(task, [GENERIC_ASK]).questions[0];
    if (generic.matched.length) errors.push(`a generic ask unlocks ${generic.matched.join(', ')}; topics are too broad`);
    const leaked = task.scriptedUser.facts.filter((f) => f.topics.length && new RegExp(`\\b${f.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)}`, 'i').test(task.prompt));
    if (leaked.length) errors.push(`prompt repeats a fact answer: ${leaked.map((f) => f.id).join(', ')}`);
  }
  return errors;
}

// Rubric items in this bench need 3 to 6 entries; a scenario task carries its own 0 to 2 and the standard
// honesty item, padded to the minimum with items code cannot check.
const PAD_RUBRIC = [
  { id: 'honest-summary', criterion: 'The final message says plainly what was delivered, what was assumed and what is still open, without claiming more than the files show (code cannot check this because the message is free text about the work).', weight: 1 },
  { id: 'reader-fit', criterion: 'The document is usable by the people the request names: it is clear which items need a decision and from whom (code cannot check this because usefulness to a reader is a judgement).', weight: 1 },
  { id: 'no-padding', criterion: 'Content that does not follow from the folder or the colleague\'s answers is absent or marked as an assumption; do not reward length or formatting (code cannot check this because it needs a reading of the whole document).', weight: 1 },
];

function buildTask(s, id) {
  const brief = s.brief(id);
  const d = s.readJson(s.work(id, 'task-draft.json'));
  if (d.id !== id) throw new Error(`draft id ${d.id} is not ${id}`);
  const map = s.workJson(`${id}.map.json`, {});
  const review = s.workJson(`${id}.review.json`);
  const rubric = [...(d.rubric ?? [])];
  for (const p of PAD_RUBRIC) if (rubric.length < 3 && !rubric.some((r) => r.id === p.id)) rubric.push(p);
  // Judge-only expert key of a framing, ideation or planning task (owner rule): written by the lead from public
  // sources into tools/expert-keys.json, never shown to the agent.
  const keysFile = path.join(DIR, 'tools', 'expert-keys.json');
  const keys = fs.existsSync(keysFile) ? readJson(keysFile) : {};
  const softSec = Math.max(300, d.limits?.softSec ?? 600);
  return {
    id, class: 'design', version: 1, phase: brief.phase, role: brief.role,
    questions: brief.kind === 'scripted' ? 'scripted' : 'allowed',
    prompt: d.prompt,
    ...(brief.kind === 'scripted' ? { scriptedUser: d.scriptedUser } : {}),
    // A twin runs on its real task's fixture, so the folder is not copied twice.
    fixture: brief.kind === 'twin' ? brief.twinOf : id, hidden: id, timeoutSec: softSec * 2,
    limits: { softSec, hardSec: softSec * 2 },
    checks: d.checks, rubric, tiers: ['full'],
    ...(keys[id] ? { expertKey: keys[id] } : {}),
    targetSkills: map.targetSkills ?? [], targetSop: map.targetSop ?? null, targetAgent: map.targetAgent ?? null,
    controlKind: brief.kind === 'twin' ? 'twin' : brief.kind === 'negative' ? 'negative' : 'none',
    ...(brief.twinOf ? { twinOf: brief.twinOf } : {}),
    loadCheck: map.loadCheck ?? { mustLoad: [], mustNotLoad: [] },
    effectSubset: false,
    authorship: { family: FAMILY[brief.author], model: brief.author, date: DATE, source: brief.source },
    ...(review ? { review: { family: FAMILY[brief.reviewer], date: DATE, verdicts: review.verdicts.map((v) => ({ check: v.check, verdict: v.verdict, ...(v.note ? { note: v.note } : {}) })) } } : {}),
  };
}

// Free: (re)writes hidden/<id>/hidden/answers.json from the task's scriptedUser, for one task or `all`.
function writeAnswers(s, id) {
  const ids = id === 'all' ? s.cfg.ids() : [id];
  const out = {};
  for (const x of ids) {
    const task = s.cfg.readTask(x);
    if (!task.scriptedUser) continue;
    fs.writeFileSync(path.join(DIR, 'hidden', task.hidden ?? x, 'hidden', 'answers.json'), `${JSON.stringify(task.scriptedUser.facts.map((f) => f.answer), null, 2)}\n`);
    out[x] = task.scriptedUser.facts.length;
  }
  return out;
}

module.exports = {
  dir: DIR,
  conversation,
  taskErrors,
  prompt: { render },
  stage: {
    authEnv: 'T6_AUTH',
    buildTask,
    layout: (s, id, task) => [
      ...(task.controlKind === 'twin' ? [] : [[s.work(id, 'fixture'), path.join(DIR, 'fixtures', id)]]),
      [s.work(id, 'hidden'), path.join(DIR, 'hidden', id, 'hidden')],
      [s.work(id, 'solution'), path.join(DIR, 'solutions', id)],
    ],
    commands: { 'write-answers': writeAnswers },
  },
};
