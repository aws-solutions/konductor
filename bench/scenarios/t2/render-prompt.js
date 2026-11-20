#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Renders the author prompt of one T2 task from prompts/author.md (or prompts/author-twin.md) and briefs/<id>.json.
// Usage: node render-prompt.js <task-id>   (prints the prompt)

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');

const STACKS = {
  node: { name: 'Node.js 24 project with no dependencies and no install step; tests use node:test and node:assert', testCmd: 'node --test' },
  python: { name: 'Python 3.12 project, standard library only, no install step; tests use unittest', testCmd: 'python3 -m unittest discover -s tests' },
};

const PR_TREE = (b) => `   - A ${STACKS[b.stack].name}, ${b.size} files (no dependency directories): source, tests that pass, \`.github/workflows/ci.yml\`, README, \`docs/\`, CHANGELOG, a package or project file, config or data files. Vary file sizes and include some awkward old code a real project has.
   - The tree is the project at the head of an open pull request. \`pr/${b.pr}/description.md\` holds the PR title and the author's description (what, why, how it was tested). \`pr/${b.pr}/changes.diff\` holds the exact unified diff of the PR against its base, as \`git diff\` writes it. Build it honestly: make a git repository in a scratch folder, commit the base, commit the PR on a branch (2 to 4 commits), and write \`git diff <base>..<pr>\` without the \`pr/\` folder itself. Do not leave a \`.git\` folder in \`fixture/\`. The PR changes 4 to 10 files and 150 to 500 lines, tests included.
   - The existing tests pass on the fixture (\`${STACKS[b.stack].testCmd}\` from the fixture root).
   - Every planted item is in lines the PR adds or changes, or in old code the PR now uses in a way that breaks. Line numbers are those of the file in the fixture (the PR's head).`;

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

function CODE_KEY(b) {
  return {
    ITEMSHAPE: '{ "id": "k1", "file": "src/path/file.ext", "line": 41, "endLine": 44, "severity": "high", "fix": ["word", "phrase"], "finding": "one sentence" }',
    DECOYSHAPE: '{ "id": "d1", "file": "src/path/file.ext", "line": 88, "endLine": 90, "why": "why it is correct here" }',
    DECOYRULE: '- `decoys`: 1 or 2 places in the PR\'s changed lines that look wrong at a glance but are correct in this project (say why in `why`), at least 8 lines away from any item. A reviewer who flags them is wrong. No two files in the project may share a file name (the grader also accepts a bare file name).',
    LOCFORMAT: '`path/to/file.ext:LINE`, with line numbers of the file as it is in the project',
    EXTRAVERIFY: `Also check, in a scratch copy of the fixture with \`git init\`, that \`git apply -R --check pr/${b.pr}/changes.diff\` succeeds, and that the existing tests pass. `,
  };
}

// Two-step authoring (second-family authors): step "fixture" writes the project, the prompt and PLANTED.md (each
// planted problem and decoy in prose); a separate call, step "key", reads them and writes the key and the reference.
const PLANTED = `2. \`PLANTED.md\` (outside \`fixture/\`): one short paragraph per planted problem, saying the file and line range (or the section number), what is wrong, why it matters in this project, how to fix it, and how severe it is (critical, high, medium, low or nit); then one paragraph per decoy (correct code or text that looks wrong) with its file and lines and why it is correct. Plant {{ITEMCOUNT}} problems. Another person writes the grading key from this file and the fixture alone, so every place must be exact.
`;
const FIXTURE_VERIFY = '4. Verify before you finish: run the existing tests of the fixture, check that every place named in PLANTED.md exists and shows the problem, and that nothing in the fixture names a planted problem. {{EXTRAVERIFY}}Do not write `key.json` or `solution/`. Delete any scratch folder and print a short list of what you verified.\n';

function renderStep(text, step) {
  if (step !== 'fixture') return text;
  const two = text.indexOf('2. `key.json`'), four = text.indexOf('4. `task-draft.json`'), five = text.indexOf('5. Verify before you finish.'), end = text.indexOf('\n\nKeep everything plain');
  return text.slice(0, two) + PLANTED + text.slice(four, five).replace('4. `task-draft.json`', '3. `task-draft.json`') + FIXTURE_VERIFY + text.slice(end + 1);
}

function render(id, step = 'all') {
  const b = JSON.parse(read(`briefs/${id}.json`));
  const brief = `${b.brief}\n\nPublic inspiration: ${b.source.url} (licence ${b.source.licence}). Use the idea only; copy no text or code.`;
  if (b.kind === 'twin') return read('prompts/author-twin.md').replace(/\{\{(\w+)\}\}/g, (_, k) => ({ BRIEF: brief, ID: b.id, OUTPUT: b.output })[k]);
  const fill = { BRIEF: brief, ID: b.id, ITEMCOUNT: '6 to 8', EXPERT: b.kind === 'design' ? read('prompts/expert-key.md').trimEnd() : '', ...KINDS[b.kind](b) };
  const tpl = step === 'key' ? read('prompts/author-key.md') : renderStep(read('prompts/author.md'), step);
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in fill)) throw new Error(`no value for {{${k}}}`);
    return fill[k];
  });
}

if (require.main === module) process.stdout.write(render(process.argv[2], process.argv[3]));
module.exports = { render };
