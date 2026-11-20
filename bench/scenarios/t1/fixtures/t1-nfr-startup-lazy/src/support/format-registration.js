'use strict';
const fs = require('node:fs');
if (process.env.ATLAS_FORMAT_MARKER) {
  fs.writeFileSync(process.env.ATLAS_FORMAT_MARKER, 'format-registration\n');
}
globalThis.atlasFormatRegistered = true;
