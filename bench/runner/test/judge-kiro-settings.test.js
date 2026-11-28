// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-279: the kiro judge call runs with auto compaction off, so a long bundle is never summarized mid-call.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { mkScratch } = require('./scratch.js');
const path = require('node:path');
const { makeKiroCaller } = require('../../judge/model.js');

test('the kiro judge scratch home turns chat auto compaction off', async () => {
  const root = mkScratch('kbench-judge-settings-');
  try {
    const probe = path.join(root, 'seen-settings.json');
    const bin = path.join(root, 'kiro-cli');
    fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const file = path.join(process.env.HOME, '.kiro/settings/cli.json');
fs.writeFileSync(${JSON.stringify(probe)}, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'missing');
process.exit(1);
`, { mode: 0o755 });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, '');
    const call = makeKiroCaller({ authDb, timeoutMs: 20000, scratchRoot: root, kiroBin: bin });
    const out = await call({ model: 'stub', prompt: 'hi' });
    assert.match(out.error, /kiro-cli exit 1/);
    // The auth copy adds app.disableAutoupdates to every scratch HOME (D-305) and keeps the judge's own setting.
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(probe, 'utf8')), { 'chat.disableAutoCompaction': true, 'app.disableAutoupdates': true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
