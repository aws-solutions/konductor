const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
test('command line rejects invalid examples', { skip: process.env.INTEGRATION !== '1' }, () => { const result = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'whistleline.js'), path.join(__dirname, '..', 'examples', 'broken.wlf')], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(result.stderr, /line 2/); });
