// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the README and playbook document the backend, and their judge commands use flags the CLI accepts', () => {
  const { checkArgs } = require('../lib/cli-flags.js');
  const { OPENCODE_MODELS, JUDGE_SYSTEM_PROMPT } = require('../../judge/backends.js');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('### Judge backends'), readme.indexOf('## Calibration'));
  assert.ok(section.length > 500, 'README has a Judge backends section');
  for (const re of [/--judge-backend opencode/, /--budget-usd/, /cannot run at temperature 0/, /One backend per results directory/, /same-named|may also differ from the model kiro serves/, /7\.2k to 11\.4k tokens/, /stdin/]) assert.match(section, re);
  assert.ok(section.includes(JUDGE_SYSTEM_PROMPT));
  for (const [logical, m] of Object.entries(OPENCODE_MODELS)) assert.ok(section.includes(`| ${logical} | ${m.bedrockId} |`), `${logical} row`);
  assert.match(read('CAP-PLAYBOOK.md'), /## Judge backends/);
  for (const doc of [section, read('CAP-PLAYBOOK.md')]) {
    const cmds = doc.split('\n').filter((l) => l.startsWith('node bench/runner/bench.js judge') || l.startsWith('node bench/runner/bench.js report'));
    assert.ok(cmds.length >= 2);
    for (const c of cmds) {
      const tokens = c.split(/\s+/).slice(1);
      const opts = { _: [] };
      for (let i = 2; i < tokens.length; i++) if (tokens[i].startsWith('--')) opts[tokens[i].slice(2)] = tokens[i + 1] && !tokens[i + 1].startsWith('--') ? tokens[i + 1] : true;
      assert.equal(checkArgs(tokens[1], opts), null, c);
    }
  }
  assert.doesNotMatch(section, /[—–]/);
});
