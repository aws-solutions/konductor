// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads the tool and rule metadata shared with the Python simulators (physical/schemas/plant-meta*.json), one file per plant kind.
// The top-level names (TOOLS, SIM_MS, ...) are the conveyor's; `metaOfKind` gives any kind's. Never changes a file.

const fs = require('node:fs');
const path = require('node:path');

const SCHEMAS = path.join(__dirname, '..', '..', '..', 'physical', 'schemas');
const META_PATH = path.join(SCHEMAS, 'plant-meta-v1.json');
const ARM_META_PATH = path.join(SCHEMAS, 'plant-meta-arm-v1.json');
const KNOWN_MAJOR = 1;

class PlantMetaError extends Error {}

/** The parsed metadata at `file`. Throws PlantMetaError unless its `version` is `plant-meta/<KNOWN_MAJOR>`. */
function readMeta(file = META_PATH) {
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (meta.version !== `plant-meta/${KNOWN_MAJOR}`) throw new PlantMetaError(`${file} is ${JSON.stringify(meta.version)}; this reader knows plant-meta/${KNOWN_MAJOR}`);
  return meta;
}

/**
 * The facts of one plant kind from the metadata file at `file`: `TOOLS` (in order), `SIM_MS` per tool, `NOT_EXECUTED_MS`,
 * `MOTION_TOOLS`, `ATTEMPT_RULES`, `PROCEDURE_RULES`, `VERDICT_MEASURE` per rule and `APPROVAL_TOOL`, the tool an approval covers.
 */
function loadKind(file) {
  const meta = readMeta(file);
  const rulesWhere = (attemptSide) => new Set(Object.keys(meta.rules).filter((r) => meta.rules[r].attemptSide === attemptSide));
  return {
    TOOLS: meta.tools.map((t) => t.name),
    SIM_MS: Object.fromEntries(meta.tools.map((t) => [t.name, t.simMs])),
    NOT_EXECUTED_MS: meta.notExecutedMs,
    MOTION_TOOLS: new Set(meta.tools.filter((t) => t.motion).map((t) => t.name)),
    ATTEMPT_RULES: rulesWhere(true),
    PROCEDURE_RULES: rulesWhere(false),
    VERDICT_MEASURE: Object.fromEntries(Object.entries(meta.rules).map(([r, f]) => [r, f.verdictMeasure])),
    APPROVAL_TOOL: meta.approvalTool,
  };
}

const CONVEYOR = loadKind(META_PATH);
const KIND_META = { 'conveyor-sim': CONVEYOR, 'arm-sim': loadKind(ARM_META_PATH) };
/** Every tool name of every plant kind: what a stream's tool call is checked against before it is called a plant call. */
const ALL_TOOLS = [...new Set(Object.values(KIND_META).flatMap((m) => m.TOOLS))];

/** The metadata of environment kind `kind` (`conveyor-sim` or `arm-sim`), or undefined for an unknown kind. */
const metaOfKind = (kind) => KIND_META[kind];

module.exports = {
  readMeta, PlantMetaError, metaOfKind, KIND_META, ALL_TOOLS,
  TOOLS: CONVEYOR.TOOLS, SIM_MS: CONVEYOR.SIM_MS, NOT_EXECUTED_MS: CONVEYOR.NOT_EXECUTED_MS, MOTION_TOOLS: CONVEYOR.MOTION_TOOLS,
  ATTEMPT_RULES: CONVEYOR.ATTEMPT_RULES, PROCEDURE_RULES: CONVEYOR.PROCEDURE_RULES, VERDICT_MEASURE: CONVEYOR.VERDICT_MEASURE,
};
