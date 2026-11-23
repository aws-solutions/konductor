// SPDX-License-Identifier: Apache-2.0
'use strict';

// The fields file plant-wave.sh signs into a plant release: one random six-digit seed per task and the Kiro CLI pin.

const fs = require('node:fs');

/**
 * Seeds for every <task>.json in dir, plus the pinned Kiro CLI version, written as the fields file.
 * @param {{tasksDir:string, out:string, version:string, sha256:string, rng?:() => number}} o
 *   tasksDir the release tasks dir; out the fields file to write; version and sha256 the installed kiro-cli;
 *   rng a [0, 1) source (Math.random by default; tests pass a fixed one)
 * @returns {object} the fields written
 */
function writeFields({ tasksDir, out, version, sha256, rng = Math.random }) {
  const seeds = {};
  for (const f of fs.readdirSync(tasksDir)) {
    if (f.endsWith('.json')) seeds[f.slice(0, -5)] = 100000 + Math.floor(rng() * 900000);
  }
  const fields = { seeds, versions: { kiroCli: { version, sha256, engine: 'v3' } } };
  fs.writeFileSync(out, `${JSON.stringify(fields, null, 1)}\n`);
  return fields;
}

module.exports = { writeFields };
