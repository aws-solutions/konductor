#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Renders the author prompt of one T8 task from prompts/*.md and briefs/<id>.json.
// Usage: node render-prompt.js <task-id>   (prints the prompt)
// Brief kinds: doc (a document ending in a JSON block, graded by lib/block-key.js), bugfix (hidden behaviour tests
// plus lib/regress.test.js), small (negative control: a few plain hidden tests), twin (same fixture as twinOf, a plain ask).

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');
const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));

const STACKS = {
  ops: 'An ops folder: logs, metric CSVs, a deploy history, YAML or JSON config, alert definitions, Markdown docs and a few small shell or Python scripts. No package file and no install step.',
  node: 'Node.js 24, CommonJS, no dependencies and no install step. Tests use node:test and node:assert, live in `test/`, run with `node --test test/`, all pass today and finish in under 3 seconds. Include a CI config (`.github/workflows/ci.yml`), a changelog and a package.json.',
};

function render(id) {
  const b = JSON.parse(read(`briefs/${id}.json`));
  const brief = `${b.brief}\n\nPublic inspiration: ${b.source.url} (licence ${b.source.licence}). Use the idea only; write every word and number fresh.`;
  if (b.kind === 'twin') return fill(read('prompts/author-twin.md'), { BRIEF: brief, ID: id });
  const kindFile = { doc: 'kind-doc.md', bugfix: 'kind-bugfix.md', small: 'kind-small.md' }[b.kind];
  const vars = {
    BRIEF: brief, ID: id, SIZE: b.size, STACK: STACKS[b.stack], LOGLINES: String(b.loglines || 3000),
    VOICE: b.voice || 'an SRE or engineering lead who owns the service, writing to a colleague',
    TESTSRULE: 'One `tests` check exactly as the kind section gives it.',
    OUTFILE: b.outFile || '', BLOCKFIELDS: b.blockFields || '', NITEMS: b.nItems || '12 to 18', KINDEXTRA: b.kindExtra ? `- ${b.kindExtra}` : '',
    EXTRAKEYS: b.kind === 'doc' ? '- `blockKey`: the key, as the kind section describes.' : '',
  };
  vars.KIND = fill(read(`prompts/${kindFile}`), vars);
  return fill(read('prompts/author-common.md'), vars);
}

if (require.main === module) process.stdout.write(render(process.argv[2]));
module.exports = { render };
