'use strict';

const { buildManifest } = require('./lib/manifest');
const { publicDir } = require('./lib/paths');

function preview() {
  return buildManifest(publicDir).map(({ key }) => key);
}

if (require.main === module) process.stdout.write(`${JSON.stringify(preview(), null, 2)}\n`);

module.exports = { preview };
