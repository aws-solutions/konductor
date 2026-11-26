// SPDX-License-Identifier: Apache-2.0
'use strict';

// One record per plant kind: the Node side's per-kind facts in one place (docs/history/plant-plugin-design-2026-11-24.md).
// meta.js, agent-file.js, python-pin.js and report/plant-controls.js build their tables from it. Since B-003 step 3a
// each record is read from `bench/plants/<kind>/plant.json`, so no file here names a kind.
// shortcut: the folder is fixed to bench/plants and not read through core/registry.js; the design's later step adds
// the registry kind `plant`.

const fs = require('node:fs');
const path = require('node:path');
const { folderHash } = require('../../../core/registry.js');

const PLANTS_DIR = path.join(__dirname, '..', '..', '..', 'plants');
const PLANT_API = 1;

/**
 * Reads and checks `<dir>/plant.json`. Throws an Error naming the file and the bad field.
 * Returns the frozen record { metaFile, pythonFile (both absolute), prompt, gatewayModules, sharedControls, order },
 * keyed later by `name`. `pythonFile` is the kind file the gateway's kinds.py loads (B-003 step 3b).
 */
function readPlantManifest(dir) {
  const file = path.join(dir, 'plant.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fail = (why) => { throw new Error(`${file}: ${why}`); };
  if (m.benchApi !== PLANT_API) fail(`benchApi must be ${PLANT_API}`);
  if (m.kind !== 'plant') fail('kind must be "plant"');
  if (m.name !== path.basename(dir)) fail(`name ${JSON.stringify(m.name)} must equal its folder name`);
  if (!Number.isInteger(m.order)) fail('order must be an integer (report order)');
  const metaFile = typeof m.meta === 'string' && m.meta ? path.resolve(dir, m.meta) : null;
  if (!metaFile || !fs.existsSync(metaFile)) fail(`meta ${JSON.stringify(m.meta)} must name a file that exists`);
  const pythonFile = typeof m.python === 'string' && m.python ? path.resolve(dir, m.python) : null;
  if (!pythonFile || !fs.existsSync(pythonFile)) fail(`python ${JSON.stringify(m.python)} must name the kind file, which must exist`);
  if (typeof m.prompt !== 'string' || !m.prompt) fail('prompt must be a non-empty string');
  if (!Array.isArray(m.gatewayModules) || !m.gatewayModules.every((x) => typeof x === 'string')) fail('gatewayModules must be a list of module names');
  const sc = m.sharedControls;
  if (typeof sc?.prefix !== 'string' || !Array.isArray(sc.names)) fail('sharedControls must be { prefix, names }');
  return Object.freeze({
    name: m.name,
    order: m.order,
    metaFile,
    pythonFile,
    prompt: m.prompt,
    gatewayModules: Object.freeze([...m.gatewayModules]),
    sharedControls: Object.freeze({ prefix: sc.prefix, names: Object.freeze([...sc.names]) }),
  });
}

/**
 * Per kind (the `environment.kind` a task writes), in manifest `order` (report order):
 * - `metaFile`: the plant metadata file meta.js reads (absolute path);
 * - `pythonFile`: the kind file the gateway loads (absolute path; the gateway reads plant.json itself);
 * - `prompt`: the one-line operator prompt of the plant agent;
 * - `gatewayModules`: the Python modules the kind's gateway imports;
 * - `sharedControls`: controls that reuse the conveyor's expectations under `<prefix><name>` (empty for the conveyor).
 */
const PLANT_KINDS = Object.freeze(Object.fromEntries(
  fs.readdirSync(PLANTS_DIR)
    .filter((d) => fs.existsSync(path.join(PLANTS_DIR, d, 'plant.json')))
    .map((d) => readPlantManifest(path.join(PLANTS_DIR, d)))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ name, order, ...rec }) => [name, Object.freeze(rec)]),
));

/** `fn(record)` for every kind, as an object keyed by kind in PLANT_KINDS order. */
const byKind = (fn) => Object.fromEntries(Object.entries(PLANT_KINDS).map(([kind, rec]) => [kind, fn(rec)]));

/**
 * [{ name, sha256 }] of each plant folder, in PLANT_KINDS order, for the plant block of run-config.json, so a result
 * names the plant code that made it (same hash as harness plugins, core/registry.js `folderHash`).
 * shortcut: the shared simulator in physical/sim is not in a plant folder, so only the bench commit pins it.
 */
function plantRecord() {
  return Object.keys(PLANT_KINDS).map((name) => ({ name, sha256: folderHash(path.join(PLANTS_DIR, name)) }));
}

module.exports = { PLANT_KINDS, PLANTS_DIR, byKind, plantRecord, readPlantManifest };
