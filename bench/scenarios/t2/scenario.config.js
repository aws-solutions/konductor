// SPDX-License-Identifier: Apache-2.0
'use strict';

// T2's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t2/scenario.config.js [id ...] [--record]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t2/scenario.config.js <id>
// Answers scored by the dry run, all made here from the fixture and the reference with no model call:
//   lazy  a shallow fake review: one generic remark at each changed file (its first added line) or each top-level
//         section of a design document (its first subsection); it names real places but finds nothing;
//   alt   the reference findings in reverse order, with a line range for code or "Section N" for a document, wrapped
//         as {"findings": [...]} after an unrelated json block;
//   dump  every added line, or every subsection, flagged medium: the long-list baseline (gate: 55 or less).
// Hidden dirs name the findings grader in .bench-lib.json (bench/scenarios/lib/hidden), never a copy.

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const FENCE = '```';

// ---------------------------------------------------------------- answers

const reviewMd = (items, intro) => `# Review\n\n${intro}\n\n${FENCE}json\n${JSON.stringify(items, null, 1)}\n${FENCE}\n`;

function addedLines(root) {
  const pr = path.join(root, 'pr');
  const diffs = fs.existsSync(pr) ? fs.readdirSync(pr).map((d) => path.join(pr, d, 'changes.diff')).filter((f) => fs.existsSync(f)) : [];
  const out = [];
  for (const f of diffs) {
    let file = null, line = 0;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/^\+\+\+ b\/(.*)$/);
      if (m) { file = m[1]; continue; }
      const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (h) { line = Number(h[1]); continue; }
      if (!file) continue;
      if (l.startsWith('+')) out.push(`${file}:${line++}`);
      else if (!l.startsWith('-')) line++;
    }
  }
  return out;
}

const docOf = (task) => task.checks.find((c) => c.type === 'fixture_unchanged').path;
const subsections = (root, task) => [...fs.readFileSync(path.join(root, docOf(task)), 'utf8').matchAll(/^#+\s*(\d+(?:\.\d+)+)/gm)].map((m) => m[1]);
const places = (root, task) => (task.class === 'design' ? subsections(root, task) : addedLines(root));

function dump(task) {
  return (ws) => fs.writeFileSync(path.join(ws, 'REVIEW.md'),
    reviewMd(places(ws, task).map((location) => ({ location, severity: 'medium', issue: 'check this', fix: 'review' })), 'Every changed place, flagged.'));
}

function lazy(task) {
  return (ws) => {
    const seen = new Set();
    const items = places(ws, task).filter((loc) => {
      const k = task.class === 'design' ? loc.split('.')[0] : loc.split(':')[0];
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((location) => ({ location, severity: 'medium', issue: 'This part needs more error handling and tests.', fix: 'add tests and handle errors' }));
    fs.writeFileSync(path.join(ws, 'REVIEW.md'), reviewMd(items, 'Overall this looks reasonable; a few general points.'));
  };
}

function alt(task) {
  return (ws) => {
    const ref = fs.readFileSync(path.join(DIR, 'solutions', task.id, 'REVIEW.md'), 'utf8');
    const list = JSON.parse([...ref.matchAll(new RegExp(`^${FENCE}json[ \\t]*\\n([\\s\\S]*?)^${FENCE}[ \\t]*$`, 'gim'))].pop()[1]);
    const findings = list.reverse().map((f) => {
      const loc = String(f.location);
      const code = loc.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/);
      return { ...f, location: code ? `${code[1]}:${code[2]}-${Number(code[2]) + 2}` : `Section ${loc}` };
    });
    fs.writeFileSync(path.join(ws, 'REVIEW.md'),
      `# Review\n\nNotes first.\n\n${FENCE}json\n{"verdict": "changes requested"}\n${FENCE}\n\nFindings:\n\n${FENCE}json\n${JSON.stringify({ findings }, null, 1)}\n${FENCE}\n`);
  };
}

function modes(task, cfg) {
  return [
    { name: 'reference', overlay: cfg.solutionDir(task.id), repeat: true },
    { name: 'stub', overlay: null, repeat: true },
    { name: 'lazy', overlay: lazy(task) },
    { name: 'alt', overlay: alt(task) },
    { name: 'dump', overlay: dump(task) },
    ...(fs.existsSync(cfg.answerDir(task.id, 'other')) ? [{ name: 'other', overlay: cfg.answerDir(task.id, 'other') }] : []),
  ];
}

// The reference in another valid style must score 90 (the default is 80), and the dump 55 or less.
const gates = (out, d) => ({ ...d, alt: out.scores.alt >= 90, dump: out.scores.dump <= 55 });

// ---------------------------------------------------------------- author prompt

const STACKS = {
  node: { name: 'Node.js 24 project with no dependencies and no install step; tests use node:test and node:assert', testCmd: 'node --test' },
  python: { name: 'Python 3.12 project, standard library only, no install step; tests use unittest', testCmd: 'python3 -m unittest discover -s tests' },
};

const PR_TREE = (b) => `   - A ${STACKS[b.stack].name}, ${b.size} files (no dependency directories): source, tests that pass, \`.github/workflows/ci.yml\`, README, \`docs/\`, CHANGELOG, a package or project file, config or data files. Vary file sizes and include some awkward old code a real project has.
   - The tree is the project at the head of an open pull request. \`pr/${b.pr}/description.md\` holds the PR title and the author's description (what, why, how it was tested). \`pr/${b.pr}/changes.diff\` holds the exact unified diff of the PR against its base, as \`git diff\` writes it. Build it honestly: make a git repository in a scratch folder, commit the base, commit the PR on a branch (2 to 4 commits), and write \`git diff <base>..<pr>\` without the \`pr/\` folder itself. Do not leave a \`.git\` folder in \`fixture/\`. The PR changes 4 to 10 files and 150 to 500 lines, tests included.
   - The existing tests pass on the fixture (\`${STACKS[b.stack].testCmd}\` from the fixture root).
   - Every planted item is in lines the PR adds or changes, or in old code the PR now uses in a way that breaks. Line numbers are those of the file in the fixture (the PR's head).`;

function CODE_KEY(b) {
  return {
    ITEMSHAPE: '{ "id": "k1", "file": "src/path/file.ext", "line": 41, "endLine": 44, "severity": "high", "fix": ["word", "phrase"], "finding": "one sentence" }',
    DECOYSHAPE: '{ "id": "d1", "file": "src/path/file.ext", "line": 88, "endLine": 90, "why": "why it is correct here" }',
    DECOYRULE: '- `decoys`: 1 or 2 places in the PR\'s changed lines that look wrong at a glance but are correct in this project (say why in `why`), at least 8 lines away from any item. A reviewer who flags them is wrong. No two files in the project may share a file name (the grader also accepts a bare file name).',
    LOCFORMAT: '`path/to/file.ext:LINE`, with line numbers of the file as it is in the project',
    EXTRAVERIFY: `Also check, in a scratch copy of the fixture with \`git init\`, that \`git apply -R --check pr/${b.pr}/changes.diff\` succeeds, and that the existing tests pass. `,
  };
}

const KINDS = {
  pr: (b) => ({ FIXTURE: PR_TREE(b), ...CODE_KEY(b) }),
  gaps: (b) => ({
    FIXTURE: `${PR_TREE(b)}
   - \`pr/${b.pr}/review.md\` holds a review a teammate already posted: 4 to 7 comments with file:line, in a believable voice. Two or three are right and point at real problems (those are NOT in your key), some are style points, one is slightly wrong. It approves "with nits". Your key holds only what that review missed, and none of its items may sit within 5 lines of a comment in it.`,
    ...CODE_KEY(b),
  }),
  design: (b) => ({
    FIXTURE: `   - A design review packet of ${b.size} files: the document under review at \`${b.doc}\`, with numbered sections and subsections (\`## 3. ...\`, \`### 3.2 ...\`), 1,800 to 3,500 words, written by a capable team that missed some things; and the context a reviewer needs (for example the current architecture, service targets, traffic and growth numbers, cost or budget figures, constraints from other teams, a past incident summary, a glossary). Add a README that says what the packet is and who wrote it. Some context files may be CSV, YAML or JSON.
   - Every planted item sits in one subsection of the document (a \`3.2\`-style number, never a bare top-level number) and is a gap, a wrong number, a contradiction with a context file, or a failure case the design does not handle. At least three need a context file to see. No two items share a subsection.`,
    ITEMSHAPE: '{ "id": "k1", "section": "3.2", "severity": "high", "fix": ["word", "phrase"], "finding": "one sentence" }',
    DECOYSHAPE: '',
    DECOYRULE: '- `decoys` stays an empty list.',
    LOCFORMAT: 'the section number of the document, like `3.2`',
    EXTRAVERIFY: 'Also check that every `section` in your key is a heading number in the document. ',
  }),
};

// Two-step authoring (second-family authors): step "fixture" writes the project, the prompt and PLANTED.md (each
// planted problem and decoy in prose); a separate call, step "key", reads them and writes the key and the reference.
const PLANTED = `2. \`PLANTED.md\` (outside \`fixture/\`): one short paragraph per planted problem, saying the file and line range (or the section number), what is wrong, why it matters in this project, how to fix it, and how severe it is (critical, high, medium, low or nit); then one paragraph per decoy (correct code or text that looks wrong) with its file and lines and why it is correct. Plant {{ITEMCOUNT}} problems. Another person writes the grading key from this file and the fixture alone, so every place must be exact.
`;
const FIXTURE_VERIFY = '4. Verify before you finish: run the existing tests of the fixture, check that every place named in PLANTED.md exists and shows the problem, and that nothing in the fixture names a planted problem. {{EXTRAVERIFY}}Do not write `key.json` or `solution/`. Delete any scratch folder and print a short list of what you verified.\n';

function fixtureStep(text) {
  const two = text.indexOf('2. `key.json`'), four = text.indexOf('4. `task-draft.json`'), five = text.indexOf('5. Verify before you finish.'), end = text.indexOf('\n\nKeep everything plain');
  return text.slice(0, two) + PLANTED + text.slice(four, five).replace('4. `task-draft.json`', '3. `task-draft.json`') + FIXTURE_VERIFY + text.slice(end + 1);
}

/** The author prompt of `id`; `step` is all (one call), fixture or key (the two calls of the two-step method). */
function render(id, lib, step = 'all') {
  const b = lib.brief(id);
  const brief = `${b.brief}\n\n${lib.sourceLine(b.source, 'Use the idea only; copy no text or code.')}`;
  if (b.kind === 'twin') return lib.fill(lib.read('prompts/author-twin.md'), { BRIEF: brief, ID: b.id, OUTPUT: b.output });
  const vars = { BRIEF: brief, ID: b.id, ITEMCOUNT: '6 to 8', EXPERT: b.kind === 'design' ? lib.read('prompts/expert-key.md').trimEnd() : '', ...KINDS[b.kind](b) };
  const tpl = step === 'key' ? lib.read('prompts/author-key.md') : step === 'fixture' ? fixtureStep(lib.read('prompts/author.md')) : lib.read('prompts/author.md');
  return lib.fill(tpl, vars, { strict: true });
}

module.exports = { dir: DIR, modes, gates, prompt: { render } };
