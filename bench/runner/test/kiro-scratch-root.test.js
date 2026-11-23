// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Kiro host-skill guard (DEBT D-36): a scratch root with a .kiro/skills/ws-* skill at or above it is refused.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { checkScratchRoot } = require('../../plugins/kiro-cli/harness.js');

test('a scratch root below a .kiro/skills/ws-* skill is refused; other skills and a clean tree pass', () => {
  const root = tmp();
  try {
    const scratch = path.join(root, 'a', 'b');
    fs.mkdirSync(scratch, { recursive: true });
    assert.equal(checkScratchRoot(scratch), fs.realpathSync(scratch));
    fs.mkdirSync(path.join(root, '.kiro', 'skills', 'plan-review'), { recursive: true });
    assert.equal(checkScratchRoot(scratch), fs.realpathSync(scratch), 'a non-ws skill is not loaded by the ws-* glob');
    fs.mkdirSync(path.join(root, 'a', '.kiro', 'skills', 'ws-notes'), { recursive: true });
    assert.throws(() => checkScratchRoot(scratch), /holds ws-notes; the konductor agents load \.kiro\/skills\/ws-\* skills/);
    fs.mkdirSync(path.join(scratch, '.kiro', 'skills'), { recursive: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
