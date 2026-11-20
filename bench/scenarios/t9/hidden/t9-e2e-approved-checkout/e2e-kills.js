'use strict';

// Hidden key of t9-e2e-approved-checkout, shared by the three kills-*.test.js files. The mutation kit
// (mutation-kit/, built by fixture-src/build-e2e-kit.js) holds ten browser-visible regressions of the checkout page and
// one safe rewrite that renames every id and class. Each test runs the agent's end-to-end suite
// (`node --test e2e/*.e2e.test.js`) through the shared mutant runner: a regression counts as caught when the suite
// fails on it and passes on the real page and on the safe rewrite. The kills are split over three test files because
// one `tests` check has a fixed time limit and each suite run starts a browser.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { prepare, runOne, runRefactor, refactorsPass, countTests, cleanup } = require('./mutation-kit/mutants.js');

const kit = path.join(__dirname, 'mutation-kit');
const cfg = JSON.parse(fs.readFileSync(path.join(kit, 'mutants.json'), 'utf8'));
const clean = (s) => s.replace(/\u2139/g, 'i');

module.exports = function kills(ids, { withRefactor = false } = {}) {
  let ctx;
  describe('end-to-end suite catches checkout regressions', () => {
    before(() => { ctx = prepare(__dirname, kit); });
    after(() => { if (ctx) cleanup(ctx); });
    if (withRefactor) {
      for (const r of cfg.refactors) {
        test(`passes the safe rewrite ${r.id} and adds tests`, () => {
          assert.ok(ctx.realPass, `the suite must pass on the real page: ${clean(ctx.realTail)}`);
          const n = countTests(ctx);
          assert.ok(n > cfg.baseTests, `the suite has ${n} test definitions, no more than the ${cfg.baseTests} it started with`);
          const res = runRefactor(ctx, r);
          assert.ok(res.passed, `${r.note}: ${clean(res.detail)}`);
        });
      }
    }
    for (const m of cfg.mutants.filter((x) => ids.includes(x.id))) {
      test(`catches ${m.id}: ${m.note}`, () => {
        assert.ok(ctx.realPass, `the suite must pass on the real page: ${clean(ctx.realTail)}`);
        assert.ok(refactorsPass(ctx), 'the suite fails on a safe rewrite of the markup, so a failure does not show a regression');
        assert.ok(runOne(ctx, m).killed, `regression ${m.id} went unnoticed`);
      });
    }
  });
};
