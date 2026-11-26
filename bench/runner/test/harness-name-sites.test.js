// SPDX-License-Identifier: Apache-2.0
// FW-18 step 6 (DEBT D-212): core sites that named a runtime now read the registry or a descriptor field. These pin
// that the lookups give what the names gave. No agent is started.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const harnesses = require('../lib/harness/index.js');
const { DEFAULT_RUNTIME } = require('../lib/harness/runtime.js');
const sandbox = require('../lib/sandbox.js');
const { canAuditFetches } = require('../lib/contamination.js');

test('harness/index.js names no harness: each is reached by id through HARNESSES or harnessFor (B-014 step 3)', () => {
  assert.deepEqual(Object.keys(harnesses).sort(), ['HARNESSES', 'harnessFor', 'registry', 'runtimeOf']);
  assert.equal(harnesses.harnessFor({}), harnesses.HARNESSES[DEFAULT_RUNTIME], 'no runtime is the default runtime');
});

test('the kiro-cli binary name is one constant, and only a harness with a listing check has listingMismatch', () => {
  assert.equal(sandbox.KIRO_BIN, 'kiro-cli');
  const withCheck = Object.keys(harnesses.HARNESSES).filter((id) => harnesses.HARNESSES[id].listingMismatch);
  assert.deepEqual(withCheck, ['claude-code']);
});

test('the fetch audit covers the runtimes with the kiro-cli stream format, and no unknown one', () => {
  assert.equal(canAuditFetches('kiro-cli'), true);
  for (const id of ['opencode', 'claude-code', 'strands', 'no-such-runtime', undefined]) assert.equal(canAuditFetches(id), false, String(id));
});

test('the opencode judge backend id is one constant, and opencode config sits under HOME/.config/opencode', () => {
  const { OPENCODE_BACKEND, DEFAULT_BACKEND, backendRegistry } = require('../../judge/backends.js');
  const { maxPromptBytes } = require('../../judge/config.js');
  assert.equal(backendRegistry().part(OPENCODE_BACKEND).meta.costUnit, 'usd');
  assert.equal(maxPromptBytes(OPENCODE_BACKEND), 400000);
  assert.equal(maxPromptBytes(DEFAULT_BACKEND), 120000);
  assert.equal(harnesses.HARNESSES.opencode.CONFIG_REL, require('node:path').join('.config', 'opencode'));
});
