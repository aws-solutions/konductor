// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recheck, rescoreOne } = require('../../report/recheck-load.js');

const lc = (must, loaded) => ({
  source: 'loadCheck', firstWriteAt: 10,
  loaded: loaded.map((u) => ({ unit: u, kind: u.startsWith('k-') ? 'agent' : 'skill', firstAt: 2, beforeFirstWrite: true })),
  mustLoad: must.map((u) => ({ unit: u, loaded: loaded.includes(u), beforeFirstWrite: loaded.includes(u) })),
  mustLoadBeforeWrite: null, mustNotLoaded: [],
});

test('rescoreOne: the fairness rules move the needed units; what loaded is unchanged', () => {
  const v2 = rescoreOne({ taskId: 't2-dr-rate-limits', agent: 'konductor', loadCheck: lc(['k-existing-design-review', 'backend-development'], ['k-architect']) });
  assert.deepEqual(v2.mustLoad, [{ unit: 'k-architect', loaded: true, beforeFirstWrite: true }]);
  assert.equal(v2.mustLoadBeforeWrite, true);
  assert.equal(rescoreOne({ taskId: 't12-cmux-parallel-merge', agent: 'konductor', loadCheck: lc([], []) }), null, 'excluded task');
});

test('recheck: writes loadCheck.v2.json under the out dir, never beside result.json, and old and new totals per arm', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  try {
    const runs = path.join(root, 'runs');
    const put = (rel, r) => { fs.mkdirSync(path.join(runs, rel), { recursive: true }); fs.writeFileSync(path.join(runs, rel, 'result.json'), JSON.stringify(r)); };
    put('r1/t9/konductor/t9-impl-cart-summary/1', { taskId: 't9-impl-cart-summary', armId: 'konductor', agent: 'konductor', loadCheck: lc(['backend-development', 'code-review'], []) });
    put('r1/t12/konductor/t12-cmux-parallel-merge/1', { taskId: 't12-cmux-parallel-merge', armId: 'konductor', agent: 'konductor', loadCheck: lc(['mux-dispatch'], []) });
    put('r1/t9/vanilla/t9-impl-cart-summary/1', { taskId: 't9-impl-cart-summary', armId: 'vanilla', agent: 'kiro_default', loadCheck: null });
    const out = path.join(root, 'out');
    const s = recheck({ runs, out });
    assert.deepEqual(s.arms.konductor.old, { runs: 2, needed: 3, loaded: 0, beforeWrite: 0 });
    assert.deepEqual(s.arms.konductor.new, { runs: 1, needed: 1, loaded: 0, beforeWrite: 0 });
    assert.ok(fs.existsSync(path.join(out, 'r1/t9/konductor/t9-impl-cart-summary/1/loadCheck.v2.json')));
    assert.ok(!fs.existsSync(path.join(runs, 'r1/t9/konductor/t9-impl-cart-summary/1/loadCheck.v2.json')));
    assert.ok(fs.existsSync(path.join(out, 'summary.md')));
    assert.throws(() => recheck({ runs, out: path.join(runs, 'x') }), /inside the runs dir/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
