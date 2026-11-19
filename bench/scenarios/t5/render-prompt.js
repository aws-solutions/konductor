#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Renders the author prompt of one T5 task from prompts/*.md and briefs/<id>.json.
// Usage: node render-prompt.js <task-id>   (prints the prompt)

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');

const STACKS = {
  docs: { stack: 'Markdown documents only, no code, no package file and no install step.', runner: 'node', mutcmd: '', pycfg: '' },
  node: { stack: 'Node.js 24, CommonJS, no dependencies and no install step. Tests use node:test and node:assert and run with `node --test`.', runner: 'node', mutcmd: 'node --test --test-timeout=4000 test/*.test.js', pycfg: '' },
  python: { stack: 'Python 3.12, standard library only, no install step. Tests use unittest, live under `tests/` (files `test_*.py`) and run with `python3 -m unittest discover -s tests`. The repository root is on PYTHONPATH.', runner: 'python', mutcmd: '', pycfg: '"pattern": "test*.py", "perTestSec": 5, ' },
};

const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));

function render(id) {
  const b = JSON.parse(read(`briefs/${id}.json`));
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
    BRIEF: `${b.brief}\n\nPublic inspiration: ${b.source.url} (licence ${b.source.licence}). Use the idea only.`,
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

if (require.main === module) process.stdout.write(render(process.argv[2]));
module.exports = { render };
