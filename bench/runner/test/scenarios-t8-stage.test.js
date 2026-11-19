// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit test of the T8 blindness audit (bench/scenarios/t8/stage.js auditStream).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('auditStream flags unit reads and other batches, not the authoring dir', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 't8-audit-')));
  try {
    const auth = path.join(root, 't8auth');
    fs.mkdirSync(path.join(auth, 'work'), { recursive: true });
    process.env.T8_AUTH = auth;
    const { auditStream } = require('../../scenarios/t8/stage.js');
    const line = (p) => JSON.stringify({ sessionUpdate: 'tool_call', rawInput: { path: p } });
    const stream = path.join(auth, 'work', 'x.author.out');
    fs.writeFileSync(stream, [
      line(`${auth}/work/x/fixture/a.log`),
      line(`${root}/t8/bench/scenarios/t8/lib/block-key.js`),
      line(`${root}/t5auth/work/y/task-draft.json`),
      line('/var/tmp/repo/skills/some-skill/SKILL.md'),
      JSON.stringify({ text: `${root}/t5auth/not-a-tool-call` }),
    ].join('\n'));
    const r = auditStream(stream);
    assert.deepStrictEqual(r.unitReads, ['/var/tmp/repo/skills/some-skill/SKILL.md']);
    assert.deepStrictEqual(r.otherBatch, [`${root}/t5auth/work/y/task-draft.json`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
