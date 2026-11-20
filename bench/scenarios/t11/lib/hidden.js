// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds the scoring kit of a T11 draft's hidden dir. A document task's draft carries `blockKey` ({outputFile, items},
// item types in bench/scenarios/lib/hidden/block-key.js): it becomes hidden/block-kit/key.json, and the shared
// block.test.js and block-key.js are named in hidden/.bench-lib.json, so the tests check copies them in at run time
// and no task commits a copy.

const fs = require('node:fs');
const path = require('node:path');
const { MANIFEST } = require('../../../runner/lib/hidden-lib.js');

function buildHidden(draftDir, draft) {
  const hidden = path.join(draftDir, 'hidden');
  fs.mkdirSync(hidden, { recursive: true });
  if (!draft.blockKey) return hidden;
  fs.mkdirSync(path.join(hidden, 'block-kit'), { recursive: true });
  fs.writeFileSync(path.join(hidden, 'block-kit', 'key.json'), `${JSON.stringify(draft.blockKey, null, 2)}\n`);
  const file = path.join(hidden, MANIFEST);
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  Object.assign(map, { 'block-kit/block-key.js': 'block-key.js', 'block.test.js': 'block.test.js' });
  fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(Object.entries(map).sort()), null, 2)}\n`);
  return hidden;
}

module.exports = { buildHidden };
