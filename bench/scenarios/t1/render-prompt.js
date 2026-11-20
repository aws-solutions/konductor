#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Renders the author prompt of one T1 task from prompts/author.md and briefs/<id>.json.
// Usage: node render-prompt.js <task-id>   (prints the prompt)

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');

const STACKS = {
  node: {
    stack: 'Node.js 24, CommonJS or ES modules as the project already uses, no dependencies and no install step. Tests use node:test and node:assert and run with `node --test`.',
    hidden: 'Hidden tests are `hidden/*.test.js` files using node:test and node:assert.',
    testCmd: '`node --test --test-timeout=15000 hidden/*.test.js`',
  },
  python: {
    stack: 'Python 3.12, standard library only, no install step. Tests use unittest and run with `python3 -m unittest`.',
    hidden: () => `Hidden tests are unittest modules \`hidden/py/test_*.py\` that subclass \`TimedCase\` from \`hidden/py/timeouts.py\` instead of unittest.TestCase (a per-test time limit). Add the paths your tests need to sys.path yourself; the repository root is on PYTHONPATH. Also write these two bench-provided files exactly as shown, so you can run the tests; do not change them.\n\n\`hidden/py/timeouts.py\`:\n\n\`\`\`python\n${read('lib/py-timeouts.py')}\`\`\`\n\n\`hidden/py_bridge.test.js\`:\n\n\`\`\`js\n${read('lib/py-bridge.test.js')}\`\`\`\n\nThe bridge runs the Python tests once and makes node:test see one test per Python test. To run your hidden tests yourself use \`node --test hidden/py_bridge.test.js\` from the repository root (fixture plus solution).`,
    testCmd: '`python3 -c "import sys; assert sys.version_info[:2] == (3, 12)" && node --test --test-timeout=15000 hidden/py_bridge.test.js`',
  },
};

function render(id, step = null) {
  const b = JSON.parse(read(`briefs/${id}.json`));
  const s = STACKS[b.stack];
  const hidden = typeof s.hidden === 'function' ? s.hidden() : s.hidden;
  const brief = `${b.brief}\n\nPublic inspiration: ${b.source === 'original' ? 'none (original idea)' : `${b.source.url} (licence ${b.source.licence}). Use the idea only.`}`;
  const economy = b.economy ? '\n\nScope limit: keep the fixture near the low end of the file range, keep the hidden tests and the solution compact, write each file once, verify at most twice, and finish within about 45 tool calls. A call that runs long is stopped.' : '';
  const expert = b.phase === 'nfr' ? '\n\nThis task also needs an `expertKey` in `task-draft.json`: `{ "items": [ { "id", "text" } ], "weakAnswers": [ ... ] }` with 4 to 5 items and 3 to 5 weak answers. Items are what a careful engineer would also say or show in the final message beyond what the hidden tests already check (causes found, how the limits were measured, trade-offs, what was left out), each one a sentence a reviewer can look for. weakAnswers are what a shallow answer would say. Do not repeat anything a hidden test checks.' : '';
  const fill = { BRIEF: brief, SIZE: b.size, STACK: s.stack, HIDDEN: hidden, TESTCMD: s.testCmd, ID: b.id };
  if (step === 'data' || step === 'key') return read(`prompts/author-${step}.md`).replace(/\{\{(\w+)\}\}/g, (_, k) => ({ BRIEF: `${b.brief}\n\nPublic inspiration: ${b.source === 'original' ? 'none (original idea)' : `${b.source.url} (licence ${b.source.licence}). Use the idea only.`}`, SIZE: b.size, STACK: s.stack, HIDDEN: hidden, TESTCMD: s.testCmd, ID: b.id })[k]) + (b.onFixture && step === 'data' ? '\n\nThis task runs on an existing repository: `fixture/` is already in the current directory. Do not change it; write only `task-draft.json`.' : '');
  if (b.onFixture) return read('prompts/twin.md').replace(/\{\{(\w+)\}\}/g, (_, k) => ({ BRIEF: b.brief, HIDDEN: hidden, TESTCMD: s.testCmd, ID: b.id })[k]);
  return read('prompts/author.md').replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k]) + economy + expert;
}

if (require.main === module) process.stdout.write(render(process.argv[2], process.argv[3] || null));
module.exports = { render };
