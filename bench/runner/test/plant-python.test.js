// SPDX-License-Identifier: Apache-2.0
'use strict';

// The release wheel check (DEBT D-179): before the first trial the plant Python must hold the wheel versions the
// release manifest pins, and arm-wheels.json is the one copy of the arm pins.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkReleaseWheels } = require('../lib/plant/plant-python.js');
const { ReleaseRefused } = require('../lib/plant/manifest.js');
const { mkScratch } = require('./scratch.js');

const release = (wheels) => ({ manifest: wheels ? { wheels } : {} });

/** A fake python that prints `versions` (the JSON the probe prints) and exits 0. */
function fakePython(versions) {
  const f = path.join(mkScratch('plant-py-'), 'python');
  fs.writeFileSync(f, `#!/bin/sh\necho '${JSON.stringify(versions)}'\n`, { mode: 0o755 });
  return f;
}

test('a release with no wheel pins runs nothing, so a conveyor release needs no wheels', () => {
  let ran = false;
  checkReleaseWheels({ python: 'python3', release: release(), run: () => { ran = true; } });
  assert.equal(ran, false);
});

test('a wheel version other than the manifest pin is refused; "*" only needs the wheel installed', () => {
  const pins = { mujoco: '3.13.0', numpy: '*', cedarpy: '*' };
  checkReleaseWheels({ python: fakePython({ mujoco: '3.13.0', numpy: '2.5.5', cedarpy: '4.12.2' }), release: release(pins) });
  assert.throws(() => checkReleaseWheels({ python: fakePython({ mujoco: '3.12.0', numpy: '2.5.5', cedarpy: '4.12.2' }), release: release(pins) }),
    (e) => e instanceof ReleaseRefused && /mujoco 3\.12\.0, but the release pins 3\.13\.0/.test(e.message));
  assert.throws(() => checkReleaseWheels({ python: fakePython({ mujoco: '3.13.0', numpy: null, cedarpy: '4.12.2' }), release: release(pins) }), /numpy is not installed/);
});

test('a Python that does not run is refused with its path', () => {
  assert.throws(() => checkReleaseWheels({ python: '/no/such/python', release: release({ mujoco: '3.13.0' }) }), /plant Python \/no\/such\/python did not run/);
});

test('arm-wheels.json is the one copy of the arm pins: python-pin, the stub release and the docs say the same versions', () => {
  const pins = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'physical', 'arm-wheels.json'), 'utf8'));
  delete pins._comment;
  const { GATEWAY_WHEELS } = require('../lib/python-pin.js');
  assert.deepEqual({ ...GATEWAY_WHEELS }, pins);
  const line = Object.entries(pins).map(([k, v]) => `${k}==${v}`).join(' ');
  for (const doc of ['physical-ai.md', 'reference.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', doc), 'utf8');
    for (const m of text.matchAll(/pip install (mujoco==\S+ numpy==\S+ cedarpy==\S+)/g)) assert.equal(m[1], line, doc);
    assert.ok(text.includes(line), `${doc} quotes ${line}`);
  }
  const stub = fs.readFileSync(path.join(__dirname, '..', '..', 'physical', 'test', 'arm_release_stub.py'), 'utf8');
  assert.match(stub, /arm-wheels\.json/);
  assert.doesNotMatch(stub, /"mujoco": "\d/);
});
