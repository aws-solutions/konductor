// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plugin registry: the one list of the parts the bench can run. It holds the built-ins the caller passes in, then
// every bench/plugins/<name>/plugin.json. Core code asks the registry for a part instead of naming a runtime. This
// module requires nothing from the bench, so any layer can load it.
//
// A plugin folder holds plugin.json: { "benchApi": 1, "kind": "harness", "name", "version", "meta", "entry" }.
// `meta` is a frozen descriptor file with no requires (harness/CONTRACT.md, "Descriptor"); `entry` is the harness
// module. A plugin with another benchApi, an unknown kind or a bad manifest is listed as refused, with its reason, and
// never loaded. Two parts with one name is an error.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** The major version of the plugin interface this core accepts. */
const PLUGIN_API = 1;
// `judge-backend` parts are read by judge/backends.js (FW-14).
const KINDS = Object.freeze(['harness', 'judge-backend']);
// Folders the plugin hash skips: caches, not code.
const HASH_SKIP = new Set(['node_modules', '__pycache__', '.pytest_cache']);

/** sha256 over the sorted relative paths and contents of every file under `dir` (caches skipped). */
function folderHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    const entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (HASH_SKIP.has(e.name)) continue;
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) h.update(`${r}\0`).update(fs.readFileSync(path.join(dir, r))).update('\0');
    }
  };
  walk('');
  return h.digest('hex');
}

/** Why the manifest `m` of folder `dir` cannot load, or null when it can. */
function manifestProblem(m, dir) {
  if (!m || typeof m !== 'object') return 'plugin.json is not a JSON object';
  if (m.benchApi !== PLUGIN_API) return `benchApi ${JSON.stringify(m.benchApi)} is not ${PLUGIN_API}, the plugin API this bench speaks`;
  if (!KINDS.includes(m.kind)) return `kind ${JSON.stringify(m.kind)} is not one of ${KINDS.join(', ')}`;
  for (const k of ['name', 'version', 'meta', 'entry']) if (typeof m[k] !== 'string' || !m[k]) return `"${k}" must be a non-empty string`;
  if (m.name !== path.basename(dir)) return `name "${m.name}" must equal its folder name "${path.basename(dir)}"`;
  for (const k of ['meta', 'entry']) {
    const file = path.resolve(dir, m[k]);
    if (path.relative(dir, file).startsWith('..')) return `"${k}" must stay inside the plugin folder`;
    if (!fs.existsSync(file)) return `"${k}" file ${m[k]} does not exist`;
  }
  return null;
}

/**
 * One plugin folder, read: { plugin: {name, kind, version, benchApi, sha256, dir, meta, entry} } when it loads, else
 * { refused: {dir, why} }. `meta` is the required descriptor; `entry` is the absolute path of the module.
 */
function readPlugin(dir) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')); } catch (e) { return { refused: { dir, why: `plugin.json: ${e.message}` } }; }
  const why = manifestProblem(m, dir);
  if (why) return { refused: { dir, why } };
  const meta = require(path.resolve(dir, m.meta));
  if (meta?.id !== m.name) return { refused: { dir, why: `meta id ${JSON.stringify(meta?.id)} must equal the plugin name "${m.name}"` } };
  return { plugin: { name: m.name, kind: m.kind, version: m.version, benchApi: m.benchApi, sha256: folderHash(dir), dir, meta, entry: path.resolve(dir, m.entry) } };
}

/**
 * The registry over `builtins` ([{kind, meta}], in display order) and the plugin folders found in each of
 * `pluginRoots` (sorted by name, after the built-ins). `order` (names) puts those parts first, in that order, so a
 * built-in that becomes a plugin keeps its place. Throws when two parts share a name. Returns a frozen object:
 *   parts(kind)   [{name, kind, meta, source: 'builtin'|'plugin', plugin}] in order
 *   descriptors() the harness descriptors, in order
 *   plugins()     the loaded plugins; refused() the refused folders with their reason
 *   record()      [{name, kind, version, benchApi, sha256}] of the loaded plugins, for run-config.json
 */
function createRegistry({ builtins = [], pluginRoots = [], order = [] } = {}) {
  const parts = builtins.map(({ kind, meta }) => ({ name: meta.id, kind, meta, source: 'builtin', plugin: null }));
  const plugins = [];
  const refused = [];
  for (const root of pluginRoots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const name of dirs) {
      const r = readPlugin(path.join(root, name));
      if (r.refused) { refused.push(r.refused); continue; }
      plugins.push(r.plugin);
      parts.push({ name: r.plugin.name, kind: r.plugin.kind, meta: r.plugin.meta, source: 'plugin', plugin: r.plugin });
    }
  }
  const seen = new Map();
  for (const p of parts) {
    const key = `${p.kind}:${p.name}`;
    if (seen.has(key)) throw new Error(`two ${p.kind} parts are named "${p.name}" (${seen.get(key)} and ${p.plugin?.dir ?? 'a built-in'}); a name must be unique`);
    seen.set(key, p.plugin?.dir ?? 'a built-in');
  }
  // Parts named in `order` come first, in that order; the rest keep their place after them (Array sort is stable).
  const rank = (p) => (order.includes(p.name) ? order.indexOf(p.name) : order.length);
  const frozen = Object.freeze([...parts].sort((a, b) => rank(a) - rank(b)).map((p) => Object.freeze(p)));
  return Object.freeze({
    parts: (kind) => frozen.filter((p) => p.kind === kind),
    descriptors: () => Object.freeze(frozen.filter((p) => p.kind === 'harness').map((p) => p.meta)),
    plugins: () => [...plugins],
    refused: () => [...refused],
    record: () => plugins.map(({ name, kind, version, benchApi, sha256 }) => ({ name, kind, version, benchApi, sha256 })),
  });
}

module.exports = { PLUGIN_API, KINDS, createRegistry, readPlugin, folderHash };
