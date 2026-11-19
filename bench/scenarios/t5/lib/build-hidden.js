#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Adds the shared T5 scoring kit to a task's hidden dir (bench/scenarios/t5/hidden/<id>).
// Usage: node build-hidden.js <hiddenDir> mutants
//   copies mutants.js and mutation.test.js; the author supplies <hiddenDir>/mutation-kit/{mutants.json,pristine,mutants}.
// Usage: node build-hidden.js <hiddenDir> findings <outputFile>
//   copies findings.test.js and findings-key.js and writes findings-kit/key.json from the findingsKey argument (the task's key).

const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const ROOT = path.resolve(here, '../../../..');

function main([hidden, kind, outputFile], findingsKey) {
  if (kind === 'mutants') {
    fs.mkdirSync(path.join(hidden, 'mutation-kit'), { recursive: true });
    fs.copyFileSync(path.join(here, 'mutants.js'), path.join(hidden, 'mutation-kit/mutants.js'));
    fs.copyFileSync(path.join(here, 'mutation.test.js'), path.join(hidden, 'mutation.test.js'));
    return;
  }
  if (kind === 'findings') {
    const kit = path.join(hidden, 'findings-kit');
    fs.mkdirSync(kit, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'bench/runner/lib/findings-key.js'), path.join(kit, 'findings-key.js'));
    fs.copyFileSync(path.join(here, 'findings.test.js'), path.join(hidden, 'findings.test.js'));
    fs.writeFileSync(path.join(kit, 'key.json'), JSON.stringify({ outputFile, findingsKey }, null, 2));
    return;
  }
  throw new Error('usage: build-hidden.js <hiddenDir> mutants | findings <outputFile>');
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { main };
