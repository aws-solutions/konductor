// SPDX-License-Identifier: Apache-2.0
'use strict';

// The mapping catalog gives every SOP a description: its frontmatter one, else the first paragraph under ## Overview
// (DEBT D-162).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { catalog, overviewOf } = require('../../scenarios/t1/catalog-descriptions.js');

test('a SOP with no frontmatter description takes its first Overview paragraph; a frontmatter one wins', () => {
  const root = tmp();
  try {
    write(path.join(root, 'skills/s1/SKILL.md'), '---\nname: s1\ndescription: "Skill one."\n---\nbody\n');
    write(path.join(root, 'agent-sops/plain.sop.md'), '# Plain\n\n## Overview\n\nFast, read-only check\nof local changes.\n\nSecond paragraph.\n\n## Steps\n');
    write(path.join(root, 'agent-sops/fm.sop.md'), '---\ndescription: From frontmatter.\n---\n# Fm\n\n## Overview\n\nNot this.\n');
    write(path.join(root, 'agent-sops/none.sop.md'), '# None\n\n## Steps\n\n1. Go.\n');
    fs.mkdirSync(path.join(root, 'agents'));
    const by = Object.fromEntries(catalog(root).map((e) => [e.name, e.description]));
    assert.equal(by.plain, 'Fast, read-only check of local changes.');
    assert.equal(by.fm, 'From frontmatter.');
    assert.equal(by.none, '');
    assert.equal(by.s1, 'Skill one.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every SOP of this checkout reaches the mapper with a description', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const empty = catalog(root).filter((e) => e.kind === 'sop' && !e.description).map((e) => e.name);
  assert.deepEqual(empty, []);
  assert.equal(overviewOf('## Overview\n\nOne line.\n'), 'One line.');
});
