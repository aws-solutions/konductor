'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
async function tempDir(prefix = 'sieve-test-') { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function removeDir(dir) { await fs.rm(dir, { recursive: true, force: true }); }
module.exports = { tempDir, removeDir };
