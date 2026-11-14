// SPDX-License-Identifier: Apache-2.0
'use strict';

// A crash while a result, summary or judgment file is written must leave the previous file intact: the
// files hold paid verdicts and spend history. Writers go through writeAtomic (temp file, then rename).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging } = require('../../judge/run.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { writeAtomic } = require('../lib/owned.js');

const real = fs.writeFileSync;
// Writes the first bytes of a temp file for `name`, then fails the way a full disk would.
function crashOnTemp(t, name) {
  t.mock.method(fs, 'writeFileSync', (file, data, opts) => {
    if (String(file).includes(`${name}.`) && String(file).endsWith('.tmp')) {
      real(file, String(data).slice(0, 12), opts);
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    }
    return real(file, data, opts);
  });
}

test('writeAtomic keeps the previous file and leaves no temp file when the write fails partway', (t) => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'result.json');
    writeAtomic(file, '{"ok":true}\n');
    crashOnTemp(t, 'result.json');
    assert.throws(() => writeAtomic(file, `${JSON.stringify({ big: 'x'.repeat(100) })}\n`), /ENOSPC/);
    t.mock.restoreAll();
    assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}\n');
    assert.deepEqual(fs.readdirSync(dir), ['result.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeAtomic writes the same bytes and a 0644 file', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'summary.json');
    const text = `${JSON.stringify({ a: 1 }, null, 2)}\n`;
    writeAtomic(file, text);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a crash while judgments.json is rewritten leaves the earlier judgments readable', async (t) => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla' }]);
    const common = {
      runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
      limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
    };
    const caller = async ({ prompt }) => {
      const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
      return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }), credits: 0.1, latencyMs: 1 };
    };
    await runJudging({ ...common, caller });
    const file = path.join(runDir, 'judgments.json');
    const before = fs.readFileSync(file, 'utf8');
    assert.equal(JSON.parse(before).rubric.length, 1);

    fs.rmSync(path.join(runDir, 'judge'), { recursive: true, force: true });
    crashOnTemp(t, 'judgments.json');
    await assert.rejects(() => runJudging({ ...common, caller }), /ENOSPC/);
    t.mock.restoreAll();
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.ok(!fs.readdirSync(runDir).some((n) => n.endsWith('.tmp')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('result, summary, run-config and judgment writers do not write in place', () => {
  const lib = path.join(__dirname, '..', 'lib');
  const judge = path.join(__dirname, '..', '..', 'judge');
  const files = [
    path.join(lib, 'run-one.js'), path.join(lib, 'orchestrate.js'), path.join(lib, 'run-cmd.js'),
    path.join(judge, 'run.js'), path.join(judge, 'packrun.js'), path.join(judge, 'rescore.js'),
  ];
  const inPlace = /writeFileSync\([^\n]*(result\.json|summary\.json|run-config\.json|judgments|\bFILE\b|LENIENT_FILE)/;
  for (const f of files) {
    const hit = fs.readFileSync(f, 'utf8').split('\n').find((l) => inPlace.test(l) || /writeFileSync\(file,/.test(l));
    assert.equal(hit, undefined, `${path.basename(f)} writes a result file in place: ${hit}`);
  }
});
