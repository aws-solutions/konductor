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

// The helpers live in bench/scenarios/lib/hidden; an author's kit copy carries them beside this file instead. The
// stage's assemble step folds the copies back into .bench-lib.json, so no task commits them.
const helper = (name) => [path.join(__dirname, name), path.join(__dirname, '..', '..', 'lib', 'hidden', name)].find((p) => fs.existsSync(p));

function main([hidden, kind, outputFile], findingsKey) {
  if (kind === 'mutants') {
    fs.mkdirSync(path.join(hidden, 'mutation-kit'), { recursive: true });
    fs.copyFileSync(helper('mutants.js'), path.join(hidden, 'mutation-kit/mutants.js'));
    fs.copyFileSync(helper('mutation.test.js'), path.join(hidden, 'mutation.test.js'));
    return;
  }
  if (kind === 'findings') {
    const kit = path.join(hidden, 'findings-kit');
    fs.mkdirSync(kit, { recursive: true });
    fs.copyFileSync(helper('findings-key.cjs'), path.join(kit, 'findings-key.js'));
    fs.copyFileSync(helper('findings.test.js'), path.join(hidden, 'findings.test.js'));
    fs.writeFileSync(path.join(kit, 'key.json'), JSON.stringify({ outputFile, findingsKey }, null, 2));
    return;
  }
  throw new Error('usage: build-hidden.js <hiddenDir> mutants | findings <outputFile>');
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { main };
