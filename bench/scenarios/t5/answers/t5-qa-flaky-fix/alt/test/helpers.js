// Changes for this request; see the commit message for the reasoning.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RateLimiter } = require('../src/rate-limiter');

function tempDirectory(prefix = 'daymark-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDirectory(directory) {
  return fs.promises.rm(directory, { recursive: true, force: true });
}

function testLimiter() {
  return new RateLimiter(2, 1000);
}

module.exports = { tempDirectory, removeDirectory, testLimiter };
