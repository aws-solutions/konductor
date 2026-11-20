const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCueFile, writeCueFile } = require('../src/io');
test('round trips a cue file when integration is enabled', { skip: process.env.INTEGRATION !== '1' }, () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whistleline-')); try { const file = path.join(dir, 'roundtrip.wlf'); writeCueFile(file, '00:00:01 Intro'); assert.equal(readCueFile(file), '00:00:01 Intro\n'); } finally { fs.rmSync(dir, { recursive: true, force: true }); } });
