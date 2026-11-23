// SPDX-License-Identifier: Apache-2.0
'use strict';

// The arm's exact wheels (DEBT D-179): one list, bench/physical/gateway-wheels.json, quoted by the docs; and the
// runner refuses a release whose `wheels` differ from the plant Python's before the first trial. Fake interpreters are
// shell scripts that print what a real one would.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rig, suiteOf } = require('./plant-run-rig.js');
const { GATEWAY_WHEELS } = require('../lib/python-pin.js');

const BENCH = path.join(__dirname, '..', '..');

/** A fake plant Python at <dir>/python that reports `versions` ({name: version|null}) for any wheel list. */
function fakePython(dir, versions) {
  const file = path.join(dir, 'python');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\necho '${JSON.stringify(versions)}'\n`, { mode: 0o755 });
  return file;
}

test('a release that pins wheels refuses a plant Python with other or missing wheels, before any trial', () => {
  const r = rig({ manifest: { wheels: { ...GATEWAY_WHEELS } } });
  try {
    const wrong = fakePython(path.join(r.root, 'wrong'), { ...GATEWAY_WHEELS, mujoco: '3.12.0', numpy: null });
    assert.throws(() => suiteOf(r, { opts: { 'plant-python': wrong } }), /other wheels than the release pins: mujoco 3\.12\.0 \(the release pins 3\.13\.0\), numpy missing \(the release pins 2\.5\.5\); pip install /);
    const right = fakePython(path.join(r.root, 'right'), { ...GATEWAY_WHEELS });
    assert.equal(suiteOf(r, { opts: { 'plant-python': right } }).python, right);
  } finally { r.cleanup(); }
});

test('a release with no wheels is not checked', () => {
  const r = rig();
  try {
    const any = fakePython(path.join(r.root, 'any'), {});
    assert.equal(suiteOf(r, { opts: { 'plant-python': any } }).python, any);
  } finally { r.cleanup(); }
});

test('the docs quote the one wheel list', () => {
  const line = `pip install ${['mujoco', 'numpy', 'cedarpy'].map((k) => `${k}==${GATEWAY_WHEELS[k]}`).join(' ')}`;
  for (const doc of ['docs/physical-ai.md', 'docs/reference.md']) assert.ok(fs.readFileSync(path.join(BENCH, doc), 'utf8').includes(line), `${doc} has "${line}"`);
});
