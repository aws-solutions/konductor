// SPDX-License-Identifier: Apache-2.0
'use strict';

// One record per plant kind: the Node side's per-kind facts in one place (docs/history/plant-plugin-design-2026-11-24.md).
// meta.js, agent-file.js, python-pin.js and report/plant-controls.js build their tables from it. Since B-003 step 3a
// each record is read from `bench/plants/<kind>/plugin.json`, so no file here names a kind. Since step 3b the manifest
// is checked by core/registry.js `readPlugin` (kind `plant`); this module adds the plant fields.
// The plants are bench/plants, then the plant folders under each BENCH_PLUGIN_PATH root (loadPlantKinds).
// The gateway loads the folders this module names (plantFolders(), sent in BENCH_PLANT_DIRS by gateway-proc.js).

const fs = require('node:fs');
const path = require('node:path');
const { folderHash, pluginPathRoots, readPlugin } = require('../../../core/registry.js');

const PLANTS_DIR = path.join(__dirname, '..', '..', '..', 'plants');

/**
 * Reads and checks `<dir>/plugin.json`: the plugin fields through core/registry.js, then the plant fields. Throws an
 * Error naming the folder and the bad field.
 * Returns the frozen record { dir, metaFile, pythonFile (all absolute), prompt, gatewayModules, sharedControls, order },
 * keyed later by `name`. `pythonFile` is the kind file (`entry`) the gateway's kinds.py loads (B-003 step 3b).
 */
function readPlantManifest(dir) {
  const { plugin, refused } = readPlugin(dir, ['plant']);
  if (refused) throw new Error(`${dir}: ${refused.why}`);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
  const fail = (why) => { throw new Error(`${path.join(dir, 'plugin.json')}: ${why}`); };
  if (!Number.isInteger(m.order)) fail('order must be an integer (report order)');
  if (typeof m.prompt !== 'string' || !m.prompt) fail('prompt must be a non-empty string');
  if (!Array.isArray(m.gatewayModules) || !m.gatewayModules.every((x) => typeof x === 'string')) fail('gatewayModules must be a list of module names');
  const sc = m.sharedControls;
  if (typeof sc?.prefix !== 'string' || !Array.isArray(sc.names)) fail('sharedControls must be { prefix, names }');
  return Object.freeze({
    name: plugin.name,
    order: m.order,
    dir: path.resolve(dir),
    metaFile: path.resolve(dir, m.meta),
    pythonFile: plugin.entry,
    prompt: m.prompt,
    gatewayModules: Object.freeze([...m.gatewayModules]),
    sharedControls: Object.freeze({ prefix: sc.prefix, names: Object.freeze([...sc.names]) }),
  });
}

/**
 * Per kind (the `environment.kind` a task writes), in manifest `order` (report order):
 * - `dir`: the plant folder (absolute path);
 * - `metaFile`: the plant metadata file meta.js reads (absolute path);
 * - `pythonFile`: the kind file the gateway loads (absolute path; the gateway reads plugin.json itself);
 * - `prompt`: the one-line operator prompt of the plant agent;
 * - `gatewayModules`: the Python modules the kind's gateway imports;
 * - `sharedControls`: controls that reuse the conveyor's expectations under `<prefix><name>` (empty for the conveyor).
 */
const PLANT_KINDS = loadPlantKinds([PLANTS_DIR, ...pluginPathRoots()]);

/** The manifest kind of `<dir>/plugin.json`, or null when it has none or does not parse. */
function manifestKind(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'))?.kind ?? null; } catch { return null; }
}

/**
 * The plant records of every folder under `roots` whose plugin.json has kind `plant`, keyed by name and sorted by
 * `order`, then name. Folders of another kind, or with no or a broken plugin.json, are left to their own registries.
 * Throws when a plant manifest is bad (readPlantManifest) or two folders hold plants of one name.
 */
function loadPlantKinds(roots) {
  const recs = [];
  for (const root of roots) {
    for (const d of fs.readdirSync(root).sort()) {
      const dir = path.join(root, d);
      if (manifestKind(dir) !== 'plant') continue;
      const rec = readPlantManifest(dir);
      const twin = recs.find((r) => r.name === rec.name);
      if (twin) throw new Error(`two plants are named "${rec.name}" (${twin.dir} and ${rec.dir}); a name must be unique`);
      recs.push(rec);
    }
  }
  return Object.freeze(Object.fromEntries(
    recs.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map(({ name, order, ...rec }) => [name, Object.freeze(rec)]),
  ));
}

/** `fn(record)` for every kind, as an object keyed by kind in PLANT_KINDS order. */
const byKind = (fn) => Object.fromEntries(Object.entries(PLANT_KINDS).map(([kind, rec]) => [kind, fn(rec)]));

/**
 * [{ name, sha256 }] of each plant folder, in PLANT_KINDS order, for the plant block of run-config.json, so a result
 * names the plant code that made it (same hash as harness plugins, core/registry.js `folderHash`).
 * Each plant's own simulator modules are in its folder (`sim/`), so the hash covers them.
 * shortcut: the shared sim modules (physical/sim: faults.py, meta.py) are in no plant folder, so only the bench
 * commit pins them.
 */
function plantRecord() {
  return Object.entries(PLANT_KINDS).map(([name, rec]) => ({ name, sha256: folderHash(rec.dir) }));
}

/** The plant folders, in PLANT_KINDS order: the ones the gateway loads (BENCH_PLANT_DIRS, gateway-proc.js). */
const plantFolders = () => Object.values(PLANT_KINDS).map((rec) => rec.dir);

module.exports = { PLANT_KINDS, PLANTS_DIR, byKind, loadPlantKinds, plantFolders, plantRecord, readPlantManifest };
