const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!config.timeZone || !config.rateLimit || config.rateLimit.limit < 1) {
  console.error('default configuration is incomplete');
  process.exitCode = 1;
} else {
  console.log(`configuration ok for ${config.timeZone}`);
}
