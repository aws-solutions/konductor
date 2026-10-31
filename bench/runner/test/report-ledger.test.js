// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, write } = require('./helpers.js');
const { generateRunReport } = require('../../report/generate.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { LEDGER_FILE } = require('../lib/credit-ledger.js');

test('the full report states the study ledger totals beside the spend table', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const d = makeRun(path.join(root, 'r'), bench, [{ arm: 'vanilla' }, { arm: 'a' }]);
    write(path.join(d, LEDGER_FILE), `${[{ kind: 'run', credits: 2 }, { kind: 'run', credits: 3 }, { kind: 'judge', credits: 1.5 }].map((e) => JSON.stringify(e)).join('\n')}\n`);
    const res = generateRunReport({ run: loadRun(d), tasks: loadTasks(bench), baseline: 'vanilla', out: path.join(root, 'o'), detail: 'full', format: 'md', defaultDir: d });
    const text = fs.readFileSync(res.written.find((w) => w.endsWith('report.md')), 'utf8');
    assert.match(text, /Credit ledger \(credit-ledger\.jsonl\): 6\.50 credits in 3 call\(s\): runs 5\.00, judge 1\.50/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('without a ledger file the report says the run predates it and invents no total', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const d = makeRun(path.join(root, 'r'), bench, [{ arm: 'vanilla' }, { arm: 'a' }]);
    const res = generateRunReport({ run: loadRun(d), tasks: loadTasks(bench), baseline: 'vanilla', out: path.join(root, 'o'), detail: 'full', format: 'md', defaultDir: d });
    const text = fs.readFileSync(res.written.find((w) => w.endsWith('report.md')), 'utf8');
    assert.match(text, /No credit ledger in this run directory/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
