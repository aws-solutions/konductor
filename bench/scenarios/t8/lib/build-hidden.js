#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Adds the shared T8 scoring kit to a task's hidden dir.
//   block:   writes block-kit/key.json from the task's blockKey ({outputFile, items}) and copies block-key.js and block.test.js
//   regress: copies regress.test.js (the author's own check runs on the copies); the author supplies regress-kit/config.json and regress-kit/original/
const fs = require('node:fs');
const path = require('node:path');

// The helpers live in bench/scenarios/lib/hidden; an author's kit/ copy carries them beside this file instead.
// `stage.js assemble` folds the copies back into .bench-lib.json, so no task commits them.
const helper = (name) => [path.join(__dirname, name), path.join(__dirname, '..', '..', 'lib', 'hidden', name)].find((p) => fs.existsSync(p));

function addBlockKit(hidden, blockKey) {
  const kit = path.join(hidden, 'block-kit');
  fs.mkdirSync(kit, { recursive: true });
  fs.copyFileSync(helper('block-key.js'), path.join(kit, 'block-key.js'));
  fs.copyFileSync(helper('block.test.js'), path.join(hidden, 'block.test.js'));
  fs.writeFileSync(path.join(kit, 'key.json'), `${JSON.stringify(blockKey, null, 2)}\n`);
}

function addRegressKit(hidden) {
  fs.mkdirSync(path.join(hidden, 'regress-kit'), { recursive: true });
  fs.copyFileSync(helper('regress.test.js'), path.join(hidden, 'regress.test.js'));
}

module.exports = { addBlockKit, addRegressKit };
