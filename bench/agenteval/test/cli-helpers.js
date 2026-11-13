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

module.exports = { CLI, FIXTURES, SAMPLE, RULES, TOOLS, tmpDir, cleanup, cli };
