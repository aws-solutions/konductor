// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads the tool and rule metadata shared with the Python simulators (physical/schemas/plant-meta*.json), one file per plant kind.
// `metaOfKind` gives one kind's facts; the ALL_* names are unions over every kind. Never changes a file.

const fs = require('node:fs');
const { PLANT_KINDS, byKind } = require('./kinds.js');

const META_PATH = PLANT_KINDS['conveyor-sim'].metaFile;
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
 * `MOTION_TOOLS`, `ATTEMPT_RULES`, `PROCEDURE_RULES`, `VERDICT_MEASURE` per rule, `APPROVAL_TOOL` (the tool an approval
 * covers), `REST_STATE` (the true-state fields a line held at a safe rest shows) and `SENSORS` (the sensor names).
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
    REST_STATE: Object.freeze({ ...meta.restState }),
    SENSORS: Object.freeze([...meta.sensors]),
  };
}

const KIND_META = byKind((rec) => loadKind(rec.metaFile));
const union = (key) => [...new Set(Object.values(KIND_META).flatMap((m) => [...m[key]]))];
/** Every tool name of every plant kind: what a stream's tool call is checked against before it is called a plant call. */
const ALL_TOOLS = union('TOOLS');
/** Every kind's motion tools. No kind lists one of them as a non-motion tool (plant-meta.test.js checks it). */
const ALL_MOTION_TOOLS = new Set(union('MOTION_TOOLS'));
/** Every kind's sensor names: what a check's `sensors` list may name. */
const ALL_SENSORS = union('SENSORS');

/** The metadata of environment kind `kind` (`conveyor-sim` or `arm-sim`), or undefined for an unknown kind. */
const metaOfKind = (kind) => KIND_META[kind];

module.exports = { readMeta, PlantMetaError, metaOfKind, KIND_META, ALL_TOOLS, ALL_MOTION_TOOLS, ALL_SENSORS };
