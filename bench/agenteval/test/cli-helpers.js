// SPDX-License-Identifier: Apache-2.0
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'agenteval.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const SAMPLE = path.join(FIXTURES, 'strands-sample.json');
const RULES = path.join(FIXTURES, 'rules.json');
const TOOLS = ['lookup_order', 'check_refund_policy', 'issue_refund', 'send_email', 'escalate_to_human'];

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agenteval-test-'));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

function cli(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// A stand-in for strands-evals: a node script that records its argv and environment flags, then behaves as FAKE_MODE says.
const FAKE_SOURCE = (execPath) => `#!${execPath}
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  if (process.env.FAKE_VERSION_FAIL) process.exit(1);
  console.log('strands-evals 9.9.9');
  process.exit(0);
}
const out = args[args.indexOf('-o') + 1];
fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args, secretSeen: process.env.AWS_SECRET_ACCESS_KEY === 'SECRET-VALUE-123' }));
console.error('fake generator running');
console.log('fake generator stdout noise');
const mode = process.env.FAKE_MODE || 'ok';
if (mode === 'fail') process.exit(3);
if (mode === 'nowrite') process.exit(0);
if (mode === 'invalid') fs.writeFileSync(out, '{"not": "an experiment"}');
else if (mode === 'notjson') fs.writeFileSync(out, 'oops');
else fs.writeFileSync(out, JSON.stringify({ cases: [
  { name: 'a', input: 'Where is my order #ORD-1? It is late.', expected_output: 'It ships today.', expected_trajectory: null },
  { name: 'b', input: 'Please refund order #ORD-2, it arrived broken.', expected_output: 'Refund issued.', expected_trajectory: null },
], evaluators: [{ evaluator_type: 'OutputEvaluator', rubric: 'Be right.' }] }));
`;

function writeFakeBin(dir) {
  const file = path.join(dir, 'fake-strands-evals');
  fs.writeFileSync(file, FAKE_SOURCE(process.execPath), { mode: 0o755 });
  return file;
}

module.exports = { writeFakeBin, CLI, FIXTURES, SAMPLE, RULES, TOOLS, tmpDir, cleanup, cli };
