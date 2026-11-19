// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a mutant-scored task, copied next to `mutation-kit/` at the top of the hidden dir.
// One test per mutant: it passes when the agent's tests kill that mutant and pass on the real code,
// so the share of passing tests is the share of mutants killed.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { prepare, runOne, cleanup } = require('./mutation-kit/mutants.js');

const kit = path.join(__dirname, 'mutation-kit');
const mutants = JSON.parse(fs.readFileSync(path.join(kit, 'mutants.json'), 'utf8')).mutants;
let ctx;

describe('mutants', () => {
  before(() => { ctx = prepare(__dirname, kit); });
  after(() => { if (ctx) cleanup(ctx); });
  for (const m of mutants) {
    test(`kills ${m.id}`, () => {
      assert.ok(ctx.realPass, `the tests must pass on the real code: ${ctx.realTail.replace(/\u2139/g, 'i')}`);
      const r = runOne(ctx, m);
      assert.ok(r.killed, `mutant ${m.id} survived`);
    });
  }
});
