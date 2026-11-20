// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pipeline scripts and their runbook are public files: no machine paths, accounts, session ids or study constants.
// Patterns are built from parts so this file does not match itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findMarker } = require('../../cap/public.js');

const BENCH = path.join(__dirname, '..', '..');
const FILES = [
  'scripts/run-real-pilot.sh',
  'scripts/run-after-capability.sh',
  'scripts/run-judging.sh',
  'scripts/monitor.sh',
  'scripts/state-dir.sh',
  'scripts/real-pilot-tasks.txt',
  'docs/RUNBOOK.md',
  'README.md',
  'docs/agents.md',
  'docs/skills.md',
  'docs/physical-ai.md',
  'docs/konductor-bench.md',
  'docs/repeat-it-yourself.md',
  'scripts/gen-docs.js',
  'scripts/check-doc-links.js',
  'runner/test/pipeline-scripts-hygiene.test.js',
  'runner/test/pipeline-scripts.test.js',
  'runner/test/pipeline-runbook.test.js',
  'runner/test/pipeline-helpers.js',
  'runner/test/pipeline-chain.test.js',
  'runner/test/pipeline-judging.test.js',
  'runner/test/pipeline-monitor.test.js',
];

const j = (...p) => p.join('');
const EXTRA = [
  { name: 'home path', re: new RegExp(`${j('/ho', 'me/')}`) },
  { name: 'session dir', re: new RegExp(`${j('sbox', '-session')}`, 'i') },
  { name: 'study commit or hash', re: new RegExp(`\\b(?:${j('ca445', 'adf')}|${j('6044', '8777')}|${j('129c', 'c2f8')}|${j('fa26', '98a5')}|${j('f0315', '34')}|${j('0304ff', 'dfc8ea')})\\b`) },
  { name: 'study seed or id', re: new RegExp(`${j('2026', '1102')}|${j('2026', '1101T')}|${j('2026', '1103')}`) },
  { name: 'study path', re: new RegExp(`${j('/tmp/konductor', '-bench/results')}|${j('credit', '-debug')}|${j('judge', '-replay')}|${j('wt-', 'orch-all')}`) },
  { name: 'study count', re: new RegExp(`\\b${j('15', '13')} tests`) },
  { name: 'assistant wording', re: new RegExp(`${j('ask the ', 'assistant')}`, 'i') },
  { name: 'chat session pid', re: new RegExp(`\\b${j('34375', '22')}\\b`) },
];

for (const rel of FILES) {
  test(`${rel} has no personal, internal or study-specific content`, (t) => {
    const file = path.join(BENCH, rel);
    if (!fs.existsSync(file)) { t.skip('not present yet'); return; }
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // `env -u AWS_...` unsets a variable name; it holds no secret.
      const hit = /\benv -u AWS_/.test(line) ? null : findMarker(line);
      assert.equal(hit, null, `${rel}:${i + 1} ${hit && hit.marker}: ${hit && hit.sample}`);
      for (const m of EXTRA) assert.doesNotMatch(line, m.re, `${rel}:${i + 1} ${m.name}`);
      assert.doesNotMatch(line, /[\u2013\u2014]/, `${rel}:${i + 1} em or en dash`);
    });
  });
}

test('the markers catch internal launcher names, and the bench docs name the launcher only generically', () => {
  const names = [['tool', 'box-exec'], ['aim', ' sandbox --client kiro-cli'], ['~/.tool', 'box/bin/kiro-cli']].map((p) => p.join(''));
  for (const n of names.slice(0, 2)) assert.equal(findMarker(`runs ${n} first`)?.marker, 'internal tool', n);
  for (const rel of ['README.md', 'docs/reference.md', 'docs/agents.md', 'docs/skills.md', 'docs/physical-ai.md', 'docs/konductor-bench.md', 'docs/repeat-it-yourself.md', 'DEBT.md', 'docs/history/STEP0-FINDINGS.md', 'runner/lib/plant/intake.js']) {
    const text = fs.readFileSync(path.join(BENCH, rel), 'utf8');
    for (const n of names) assert.equal(text.includes(n), false, `${rel} names ${n}`);
  }
});
