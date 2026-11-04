// SPDX-License-Identifier: Apache-2.0
'use strict';

// The README and playbook were checked by running their free commands; these tests keep the corrected statements true.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SUITE_NAMES } = require('../lib/tasks.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('the README lists every suite name that --suite accepts', () => {
  const line = read('README.md').split('\n').find((l) => l.startsWith('`--suite '));
  assert.ok(line, 'a line starting with --suite');
  for (const name of SUITE_NAMES) assert.ok(line.includes(name), `${name} missing from: ${line}`);
});

test('the README and playbook say cap plan needs --tasks when the registry links no lift task', () => {
  for (const f of ['README.md', 'CAP-PLAYBOOK.md']) assert.match(read(f), /pass `--tasks id,id` when the registry links no lift task/, f);
});

test('the README names the files each report command writes', () => {
  const doc = read('README.md');
  assert.match(doc, /prune-report\.md/);
  assert.match(doc, /contrast\.md/);
  assert.match(doc, /report\.md, report\.html, report\.json/);
});

test('the README documents the profiles, the ledger, the graded judge, the generator, the controls and the verdict', () => {
  const doc = read('README.md');
  for (const re of [/--profile quick\|detailed/, /credit-ledger\.jsonl/, /--mode graded/, /cap scenarios/, /cap controls/, /--verdict platform/, /calibration-sample\.json/, /orderDisagreement/, /exit code 3/]) assert.match(doc, re);
  assert.doesNotMatch(doc, /More than 10 planned runs need `--budget-credits`/);
});

test('the playbook documents the scenario, controls and verdict steps and the optional cap', () => {
  const doc = read('CAP-PLAYBOOK.md');
  for (const s of [/cap scenarios --cap ID --dry-run/, /cap controls --out DIR/, /report --verdict platform/, /A cap is optional/, /references\/NAME\.md/]) assert.match(doc, s);
  assert.doesNotMatch(doc, /Always pass `--budget-credits`/);
});

test('the shipped profiles match what the README table says', () => {
  const q = JSON.parse(read('profiles/quick.json'));
  const d = JSON.parse(read('profiles/detailed.json'));
  const doc = read('README.md');
  assert.match(doc, /\| replicates per cell \| 1 to 3 \(default 2\)/);
  assert.match(doc, /at least 5 \(default 5\)/);
  assert.deepEqual([q.replicates.min, q.replicates.max, q.replicates.default], [1, 3, 2]);
  assert.deepEqual([d.replicates.min, d.replicates.default], [5, 5]);
});

const { checkArgs } = require('../lib/cli-flags.js');
const op = require('../../report/orchpass.js');

// Commands in a doc section: lines that start with `node bench/runner/bench.js`, with trailing-backslash continuations joined.
function commandsIn(doc, heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `section "${heading}" not found`);
  const rest = doc.slice(start + 3);
  const end = rest.search(/\n## /);
  const body = (end < 0 ? rest : rest.slice(0, end)).replace(/\\\n\s*/g, ' ');
  return body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('node bench/runner/bench.js'));
}

test('the README documents the orchestrator study: gates, arm config, metrics, pass rule, GPT panel and the Claude Code gap', () => {
  const doc = read('README.md');
  for (const re of [
    /## Orchestrator study/, /isolation-gate\.json/, /exit code 4/, /--arm-config/, /orchestration\.mode=coordinator/, /empty\.md/, /CLAUDE_CONFIG_DIR/,
    /--verdict orchestrator-pass/, /reworks after a pass/i, /profiles\/phase-documents\.json/, /profiles\/orch-metrics\.json/, /--phases/, /pooled within-cell standard deviation/,
    /gpt-5\.6-sol/, /qwen3-coder-next/, /--changed-skills/, /Claude Code cell/,
  ]) assert.match(doc, re);
});

test('the README states the limits the code enforces', () => {
  const doc = read('README.md');
  assert.equal(op.COST_MAX, 2);
  assert.match(doc, /at most 2\.0x/);
  assert.match(doc, /fewer than 3 scored runs/);
  assert.match(doc, /A criterion whose effect is not larger than the drift/);
});

test('every command in the orchestrator study section of the README and the playbook uses flags the CLI accepts', () => {
  for (const f of ['README.md', 'CAP-PLAYBOOK.md']) {
    const heading = f === 'README.md' ? 'Orchestrator study: cells, gates, metrics and the pass rule' : 'Orchestrator study';
    const cmds = commandsIn(read(f), heading);
    assert.ok(cmds.length >= 4, `${f}: found ${cmds.length} commands`);
    for (const c of cmds) {
      const tokens = c.split(/\s+/).slice(1);
      const cmd = tokens[1];
      const opts = { _: [] };
      for (let i = 2; i < tokens.length; i++) if (tokens[i].startsWith('--')) { opts[tokens[i].slice(2)] = tokens[i + 1] && !tokens[i + 1].startsWith('--') ? tokens[i + 1] : true; }
      assert.equal(checkArgs(cmd, opts), null, `${f}: ${c}`);
    }
  }
});

test('the playbook has the orchestrator study section with the cell, arm and A/A advice', () => {
  const doc = read('CAP-PLAYBOOK.md');
  for (const re of [/## Orchestrator study/, /A\/A/, /--arm-config/, /orchestrator-pass/, /one cell per directory/i]) assert.match(doc, re);
});

test('the per-skill study is documented in the README and the playbook', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');
  const playbook = fs.readFileSync(path.join(__dirname, '..', '..', 'CAP-PLAYBOOK.md'), 'utf8');
  for (const re of [/cap skill-plan/, /cap skill-study/, /cap decide/, /--overlay skill:NAME=DIR/, /run-skill-bench\.sh/, /DELETE, PRUNE/, /NEEDS DATA/]) assert.match(readme, re);
  for (const re of [/Per-skill study: delete, prune or keep/, /cap skill-plan/, /run-skill-bench\.sh/, /What it cannot show/]) assert.match(playbook, re);
});

test('the README and playbook describe the side-by-side review page and its import', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');
  const playbook = fs.readFileSync(path.join(__dirname, '..', '..', 'CAP-PLAYBOOK.md'), 'utf8');
  for (const re of [/cap review --run DIR/, /cap review-import --ratings FILE/, /review-key\.json/, /opens no port/, /--sample-only/, /raters\/ID\//, /pooled/, /unless `--force`, so a second import never replaces the first/, /result\.prev\.json/, /raterKappa/, /calibration\/review-key\//, /`--key` is always\s+required/, /--run DIR/]) assert.match(readme, re);
  for (const re of [/cap review --run DIR/, /cap review-import/]) assert.match(playbook, re);
});
