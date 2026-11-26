// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plugin registry: the one list of the parts the bench can run. It holds the built-ins the caller passes in, then
// every bench/plugins/<name>/plugin.json, then the plugin folders under each BENCH_PLUGIN_PATH root (pluginPathRoots).
// Core code asks the registry for a part instead of naming a runtime. This
// module requires nothing from the bench, so any layer can load it.
//
// A plugin folder holds plugin.json: { "benchApi": 1, "kind": "harness", "name", "version", "meta", "entry" }.
// `meta` is a frozen descriptor file with no requires (harness/CONTRACT.md, "Descriptor"); `entry` is the harness
// module. An optional "parts": [{ "kind", "meta", "entry" }] adds parts of other kinds under the same name, so one
// runtime folder can hold its harness and its judge backend (B-014); the plugin is still recorded once. A plugin with another benchApi, an unknown kind or a bad manifest is listed as refused, with its reason, and
// never loaded. Two parts with one name is an error.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** The major version of the plugin interface this core accepts. */
const PLUGIN_API = 1;
// `judge-backend` parts are read by judge/backends.js (FW-14), `check-type` parts by runner/lib/check-types.js,
// `plant` plugins by runner/lib/plant/kinds.js (B-003).
const KINDS = Object.freeze(['harness', 'judge-backend', 'check-type', 'plant']);
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

// Kinds whose meta is a JSON file with no `id` (plant folders, B-003 step 3b), so only the folder name ties the two.
// Such a kind is a plugin of its own, never a part of another.
const META_WITHOUT_ID = Object.freeze(['plant']);
const PART_KINDS = Object.freeze(KINDS.filter((k) => !META_WITHOUT_ID.includes(k)));

/** Why the manifest `m` of folder `dir` cannot load as one of `kinds`, or null when it can. */
function manifestProblem(m, dir, kinds) {
  if (!m || typeof m !== 'object') return 'plugin.json is not a JSON object';
  if (m.benchApi !== PLUGIN_API) return `benchApi ${JSON.stringify(m.benchApi)} is not ${PLUGIN_API}, the plugin API this bench speaks`;
  if (!kinds.includes(m.kind)) return `kind ${JSON.stringify(m.kind)} is not one of ${kinds.join(', ')}`;
  for (const k of ['name', 'version', 'meta', 'entry']) if (typeof m[k] !== 'string' || !m[k]) return `"${k}" must be a non-empty string`;
  if (m.name !== path.basename(dir)) return `name "${m.name}" must equal its folder name "${path.basename(dir)}"`;
  const fileProblem = (p) => {
    for (const k of ['meta', 'entry']) {
      if (typeof p[k] !== 'string' || !p[k]) return `"${k}" must be a non-empty string`;
      const file = path.resolve(dir, p[k]);
      if (path.relative(dir, file).startsWith('..')) return `"${k}" must stay inside the plugin folder`;
      if (!fs.existsSync(file)) return `"${k}" file ${p[k]} does not exist`;
    }
    return null;
  };
  const main = fileProblem(m);
  if (main) return main;
  if (m.parts === undefined) return null;
  if (!Array.isArray(m.parts)) return '"parts" must be a list of { kind, meta, entry }';
  const used = [m.kind];
  for (const [i, p] of m.parts.entries()) {
    if (!PART_KINDS.includes(p?.kind)) return `parts[${i}]: kind ${JSON.stringify(p?.kind)} is not one of ${PART_KINDS.join(', ')}`;
    if (used.includes(p.kind)) return `parts[${i}]: kind "${p.kind}" is already a part of this plugin`;
    used.push(p.kind);
    const why = fileProblem(p);
    if (why) return `parts[${i}]: ${why}`;
  }
  return null;
}

/**
 * One plugin folder, read: { plugin: {name, kind, version, benchApi, sha256, dir, meta, entry, parts} } when it loads,
 * else { refused: {dir, why} }. `meta` and `entry` (absolute path) are the main part's; `parts` is every part,
 * main first, each { kind, meta, entry }. `kinds` are the kinds the main part may have: the plugin kinds, or `['plant']`
 * for a plant folder (the plant reader in runner/lib/plant/kinds.js).
 */
function readPlugin(dir, kinds = KINDS) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')); } catch (e) { return { refused: { dir, why: `plugin.json: ${e.message}` } }; }
  const why = manifestProblem(m, dir, kinds);
  if (why) return { refused: { dir, why } };
  const parts = [];
  for (const [i, p] of [m, ...(m.parts ?? [])].entries()) {
    const meta = require(path.resolve(dir, p.meta));
    if (meta?.id !== m.name && !(i === 0 && META_WITHOUT_ID.includes(m.kind))) return { refused: { dir, why: `${i ? `parts[${i - 1}]: ` : ''}meta id ${JSON.stringify(meta?.id)} must equal the plugin name "${m.name}"` } };
    parts.push(Object.freeze({ kind: p.kind, meta, entry: path.resolve(dir, p.entry) }));
  }
  const [{ meta, entry }] = parts;
  return { plugin: { name: m.name, kind: m.kind, version: m.version, benchApi: m.benchApi, sha256: folderHash(dir), dir, meta, entry, parts: Object.freeze(parts) } };
}

/**
 * The registry over `builtins` ([{kind, meta}], in display order) and the plugin folders found in each of
 * `pluginRoots` (sorted by name, after the built-ins). `order` (names) puts those parts first, in that order, so a
 * built-in that becomes a plugin keeps its place. Throws when two parts share a name. Returns a frozen object:
 *   parts(kind)   [{name, kind, meta, entry, source: 'builtin'|'plugin', plugin}] in order; `entry` is the part's
 *                 module path (null for a built-in)
 *   descriptors() the harness descriptors, in order
 *   plugins()     the loaded plugins; refused() the refused folders with their reason
 *   record()      [{name, kind, version, benchApi, sha256}] of the loaded plugins, for run-config.json
 */
function createRegistry({ builtins = [], pluginRoots = [], order = [] } = {}) {
  const parts = builtins.map(({ kind, meta }) => ({ name: meta.id, kind, meta, entry: null, source: 'builtin', plugin: null }));
  const plugins = [];
  const refused = [];
  for (const root of pluginRoots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const name of dirs) {
      const r = readPlugin(path.join(root, name));
      if (r.refused) { refused.push(r.refused); continue; }
      plugins.push(r.plugin);
      for (const part of r.plugin.parts) parts.push({ name: r.plugin.name, kind: part.kind, meta: part.meta, entry: part.entry, source: 'plugin', plugin: r.plugin });
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
  // An arm with no prefix belongs to the default runtime, so only one harness may have none.
  const bare = frozen.filter((p) => p.kind === 'harness' && p.meta.armPrefix === '').map((p) => p.name);
  if (bare.length > 1) throw new Error(`two harnesses have no arm prefix (${bare.join(', ')}); only the default runtime may have none`);
  return Object.freeze({
    parts: (kind) => frozen.filter((p) => p.kind === kind),
    descriptors: () => Object.freeze(frozen.filter((p) => p.kind === 'harness').map((p) => p.meta)),
    plugins: () => [...plugins],
    refused: () => [...refused],
    record: () => plugins.map(({ name, kind, version, benchApi, sha256 }) => ({ name, kind, version, benchApi, sha256 })),
  });
}

/**
 * The extra plugin roots named in `env.BENCH_PLUGIN_PATH`, a `path.delimiter` list of folders outside this repo
 * (B-015), each holding plugin folders as bench/plugins does. Empty entries are skipped. Throws on an entry that is
 * not absolute or not a folder: a plugin root the user named and the bench silently skipped would run without it.
 */
function pluginPathRoots(env = process.env) {
  const roots = [];
  for (const entry of (env.BENCH_PLUGIN_PATH || '').split(path.delimiter)) {
    if (!entry) continue;
    if (!path.isAbsolute(entry)) throw new Error(`BENCH_PLUGIN_PATH entry "${entry}" is not an absolute path`);
    if (!fs.statSync(entry, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`BENCH_PLUGIN_PATH entry "${entry}" is not a folder`);
    roots.push(path.resolve(entry));
  }
  return roots;
}

module.exports = { PLUGIN_API, KINDS, createRegistry, readPlugin, folderHash, pluginPathRoots };
