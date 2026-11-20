// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests of the blindness audit (bench/scenarios/lib/stage.js auditStream) and overlayOf (lib/workspace.js),
// on a T8 layout.
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
    const { auditStream } = require('../../scenarios/lib/stage.js');
    const line = (p) => JSON.stringify({ sessionUpdate: 'tool_call', rawInput: { path: p } });
    const stream = path.join(auth, 'work', 'x.author.out');
    fs.writeFileSync(stream, [
      line(`${auth}/work/x/fixture/a.log`),
      line(`${root}/t8/bench/scenarios/t8/lib/block-key.js`),
      line(`${root}/t5auth/work/y/task-draft.json`),
      line('/var/tmp/repo/skills/some-skill/SKILL.md'),
      JSON.stringify({ text: `${root}/t5auth/not-a-tool-call` }),
    ].join('\n'));
    const r = auditStream(stream, auth);
    assert.deepStrictEqual(r.unitReads, ['/var/tmp/repo/skills/some-skill/SKILL.md']);
    assert.deepStrictEqual(r.otherBatch, [`${root}/t5auth/work/y/task-draft.json`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlayOf copies only the files an answer added or changed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-overlay-'));
  try {
    const { overlayOf } = require('../../scenarios/lib/workspace.js');
    const fixture = path.join(root, 'fixture');
    const ws = path.join(root, 'ws');
    fs.mkdirSync(path.join(fixture, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'logs/a.log'), 'same\n');
    fs.writeFileSync(path.join(fixture, 'README.md'), 'old\n');
    fs.cpSync(fixture, ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'README.md'), 'new\n');
    fs.mkdirSync(path.join(ws, 'docs'));
    fs.writeFileSync(path.join(ws, 'docs/report.md'), 'answer\n');
    const to = path.join(root, 'overlay');
    assert.strictEqual(overlayOf(ws, fixture, to), 2);
    assert.ok(fs.existsSync(path.join(to, 'docs/report.md')));
    assert.ok(fs.existsSync(path.join(to, 'README.md')));
    assert.ok(!fs.existsSync(path.join(to, 'logs/a.log')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
