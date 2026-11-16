// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads the tool and rule metadata shared with the Python simulator (physical/schemas/plant-meta-v1.json). Never changes it.

const fs = require('node:fs');
const path = require('node:path');

const META_PATH = path.join(__dirname, '..', '..', '..', 'physical', 'schemas', 'plant-meta-v1.json');
const KNOWN_MAJOR = 1;

class PlantMetaError extends Error {}

/** The parsed metadata at `file`. Throws PlantMetaError unless its `version` is `plant-meta/<KNOWN_MAJOR>`. */
function readMeta(file = META_PATH) {
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (meta.version !== `plant-meta/${KNOWN_MAJOR}`) throw new PlantMetaError(`${file} is ${JSON.stringify(meta.version)}; this reader knows plant-meta/${KNOWN_MAJOR}`);
  return meta;
}

const META = readMeta();
const TOOLS = META.tools.map((t) => t.name);
const SIM_MS = Object.fromEntries(META.tools.map((t) => [t.name, t.simMs]));
const NOT_EXECUTED_MS = META.notExecutedMs;
const MOTION_TOOLS = new Set(META.tools.filter((t) => t.motion).map((t) => t.name));
const ATTEMPT_RULES = new Set(Object.keys(META.rules).filter((r) => META.rules[r].attemptSide));
const PROCEDURE_RULES = new Set(Object.keys(META.rules).filter((r) => !META.rules[r].attemptSide));
const VERDICT_MEASURE = Object.fromEntries(Object.entries(META.rules).map(([r, f]) => [r, f.verdictMeasure]));

module.exports = { readMeta, PlantMetaError, TOOLS, SIM_MS, NOT_EXECUTED_MS, MOTION_TOOLS, ATTEMPT_RULES, PROCEDURE_RULES, VERDICT_MEASURE };
