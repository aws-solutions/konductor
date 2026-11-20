// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a mutant-scored task, copied next to `mutation-kit/` at the top of the hidden dir.
// One test per mutant: it passes when the agent's tests kill that mutant and pass on the real code and on every safe
// refactor, so the share of passing tests is the share of mutants killed by a suite that does not pin internals.
// One test per safe refactor (the suite must pass a behaviour-preserving rewrite) and, when the kit sets maxTests, one
// test that the suite stays within that size budget.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { prepare, runOne, runRefactor, refactorsPass, countTests, cleanup } = require('./mutation-kit/mutants.js');

const kit = path.join(__dirname, 'mutation-kit');
const cfg = JSON.parse(fs.readFileSync(path.join(kit, 'mutants.json'), 'utf8'));
const clean = (s) => s.replace(/\u2139/g, 'i');
let ctx;
// The refactor and size tests only count for a suite that adds tests, so the untouched fixture earns neither.
const added = () => {
  const n = countTests(ctx);
  assert.ok(n > (cfg.baseTests || 0), `the suite has ${n} test definitions, no more than the ${cfg.baseTests || 0} it started with`);
  return n;
};

describe('mutants', () => {
  before(() => { ctx = prepare(__dirname, kit); });
  after(() => { if (ctx) cleanup(ctx); });
  for (const r of cfg.refactors || []) {
    test(`passes safe refactor ${r.id}`, () => {
      assert.ok(ctx.realPass, `the tests must pass on the real code: ${clean(ctx.realTail)}`);
      added();
      const res = runRefactor(ctx, r);
      assert.ok(res.passed, `refactor ${r.id} (${r.note || 'same behaviour, new internals'}): ${clean(res.detail)}`);
    });
  }
  if (cfg.maxTests) {
    test(`suite stays within ${cfg.maxTests} tests`, () => {
      assert.ok(ctx.realPass, 'the tests must pass on the real code');
      const n = added();
      assert.ok(n <= cfg.maxTests, `${n} test definitions; the budget is ${cfg.maxTests}: protect each rule once, through the public interface`);
    });
  }
  for (const m of cfg.mutants) {
    test(`kills ${m.id}`, () => {
      assert.ok(ctx.realPass, `the tests must pass on the real code: ${clean(ctx.realTail)}`);
      assert.ok(refactorsPass(ctx), 'the tests fail on a safe refactor, so a kill does not show the suite tells right from wrong');
      const r = runOne(ctx, m);
      assert.ok(r.killed, `mutant ${m.id} survived`);
    });
  }
});
