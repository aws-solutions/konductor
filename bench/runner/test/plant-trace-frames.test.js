// SPDX-License-Identifier: Apache-2.0
'use strict';

// plant-trace's still frames of an arm trial's key moments (DEBT D-29): drawn by plants/arm-sim/sim/arm_frames.py with the arm
// Python, embedded as data: images; a conveyor trial gets none, and a host that cannot draw says why.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { framesFor } = require('../../report/plant-trace/frames.js');
const { pageFor } = require('../../report/plant-trace/index.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'plant-trace');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea7d6a4a80000000049454e44ae426082', 'hex');

/** A copy of the conveyor fixture whose world log carries arm poses, so it reads as an arm trial. */
function armTrial(root) {
  const dir = path.join(root, 'arm');
  fs.cpSync(path.join(FIXTURES, 'allowall'), dir, { recursive: true });
  write(path.join(dir, 'plant', 'world.jsonl'), `${JSON.stringify({ cause: 'tick', state: { block_mm: [0, 0, 0] }, poses: { t_ms: [0], qpos: [[0]] } })}\n`);
  return dir;
}

/** A fake arm Python that prints `out` as the frames JSON, whatever it is asked. */
function fakePython(root, out) {
  const file = path.join(root, 'python');
  write(file, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(out)}\nJSON\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

test('a conveyor trial has no frames and its page has no image', () => {
  assert.equal(framesFor(path.join(FIXTURES, 'allowall'), { python: '/nonexistent' }), null);
});

test('an arm trial gets one captioned data: image per key moment, and the page allows data: images only', () => {
  const root = tmp();
  try {
    const dir = armTrial(root);
    const python = fakePython(root, { frames: [{ cause: 'c2', why: 'unsafe try R3, denied', t_ms: 100, png_base64: PNG.toString('base64') }] });
    const f = framesFor(dir, { python });
    assert.deepEqual(f.frames.map((x) => [x.cause, x.why, x.t_ms]), [['c2', 'unsafe try R3, denied', 100]]);
    const html = pageFor([dir], { python });
    assert.match(html, /<figure class="frame"><img alt="arm at c2: unsafe try R3, denied" src="data:image\/png;base64,[A-Za-z0-9+/=]+"><figcaption>c2 at 0\.1 s: unsafe try R3, denied<\/figcaption><\/figure>/);
    assert.match(html, /img-src data:/);
    assert.doesNotMatch(html, /https?:\/\//);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a host that cannot draw, or has no arm Python, says so instead of showing frames', () => {
  const root = tmp();
  try {
    const dir = armTrial(root);
    const html = pageFor([dir], { python: fakePython(root, { frames: [], unavailable: 'no GL' }) });
    assert.match(html, /frames not drawn: no GL/);
    assert.match(pageFor([dir], { python: null }), /frames not drawn: no arm Python/);
    assert.match(framesFor(dir, { python: path.join(root, 'missing') }).unavailable, /could not run/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
