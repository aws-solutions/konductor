// SPDX-License-Identifier: Apache-2.0
'use strict';

// The check types a task may use: the eight built-ins, then the `check-type` plugins from bench/plugins and the
// BENCH_PLUGIN_PATH roots (docs/history/check-type-plugin-design-2026-11-24.md, step 2). A plugin type reads files
// only: its entry exports `evaluate(file, check)`, which gets the check's file already resolved inside the workspace
// and free of symlinks by evalCheck, and `shapeErrors(check)`, the problems the validator will report. A plugin can
// never take a built-in name, so `cmd`, `tests` and `fixture_unchanged` always stay core.

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { createRegistry, pluginPathRoots } = require('../../core/registry.js');

// The built-in ids, in the order the validator prints them (check-matcher.js CHECK_TYPES).
const BUILTIN_TYPES = Object.freeze(['file_exists', 'contains', 'not_contains', 'min_matches', 'fixture_unchanged', 'cmd', 'labelled_findings', 'tests']);
const PLUGINS_DIR = path.resolve(__dirname, '..', '..', 'plugins');

/** The plugin part `p` with its entry functions, or a throw naming the one it lacks. */
function loadPluginType(p) {
  const mod = require(p.plugin.entry);
  for (const fn of ['evaluate', 'shapeErrors']) {
    if (typeof mod[fn] !== 'function') throw new Error(`check type ${p.name}: its entry module exports no ${fn} function`);
  }
  return Object.freeze({ name: p.name, meta: p.meta, plugin: p.plugin, evaluate: mod.evaluate, shapeErrors: mod.shapeErrors });
}

/**
 * The check types over the built-ins and the check-type plugins under `pluginRoots` (default bench/plugins and the
 * BENCH_PLUGIN_PATH roots). Throws when a plugin takes a built-in's name or its entry lacks a function. Returns
 * `ids()` built-ins first, `plugin(id)` the loaded plugin type (undefined for a built-in or an unknown id),
 * `refused()` the refused plugin folders and `record()` the loaded plugins for run-config.json.
 */
function checkTypeRegistry(pluginRoots = [PLUGINS_DIR, ...pluginPathRoots()]) {
  const builtins = BUILTIN_TYPES.map((id) => ({ kind: 'check-type', meta: Object.freeze({ id }) }));
  const reg = createRegistry({ builtins, pluginRoots });
  const parts = reg.parts('check-type');
  const plugins = new Map(parts.filter((p) => p.source === 'plugin').map((p) => [p.name, loadPluginType(p)]));
  return Object.freeze({
    ids: () => parts.map((p) => p.name),
    plugin: (id) => plugins.get(id),
    plugins: () => [...plugins.values()],
    refused: () => reg.refused(),
    record: () => reg.record().filter((r) => r.kind === 'check-type'),
  });
}

let defaultRegistry = null;
/** The check types from the default plugin roots, read once per process on first use. */
const defaultCheckTypes = () => (defaultRegistry ??= checkTypeRegistry());

/**
 * The task schema `schema` with the plugin types of `reg` added: each plugin id joins the check `type` enum and its
 * meta `fields` join the check properties, so the schema's additionalProperties rule lets them through. Returns
 * `schema` itself when `reg` holds no plugin; otherwise a copy, so the cached schema is never changed. Throws when a
 * plugin field has the name of a core field or of another plugin's field with a different schema. A plugin's
 * `required` fields are checked by `pluginShapeErrors`, because the schema subset has no per-type rule.
 */
function withPluginTypes(schema, reg = defaultCheckTypes()) {
  const plugins = reg.plugins();
  if (!plugins.length) return schema;
  const items = schema.properties.checks.items;
  const core = items.properties;
  const added = {};
  const owner = {};
  for (const p of plugins) {
    for (const [name, sub] of Object.entries(p.meta.fields ?? {})) {
      if (name in core && !isDeepStrictEqual(core[name], sub)) throw new Error(`check type ${p.name}: field "${name}" clashes with the core field of that name`);
      if (name in added && !isDeepStrictEqual(added[name], sub)) throw new Error(`check type ${p.name}: field "${name}" clashes with check type ${owner[name]}`);
      if (!(name in core)) { added[name] = sub; owner[name] = p.name; }
    }
  }
  const type = { ...core.type, enum: [...core.type.enum, ...plugins.map((p) => p.name)] };
  const checks = { ...schema.properties.checks, items: { ...items, properties: { ...core, type, ...added } } };
  return { ...schema, properties: { ...schema.properties, checks } };
}

/** The problems with `check` for the plugin type `plugin`: each missing meta `required` field, then its own `shapeErrors`. */
function pluginShapeErrors(plugin, check) {
  const missing = (plugin.meta.required ?? []).filter((f) => check[f] === undefined).map((f) => `${f} is required`);
  try {
    return [...missing, ...plugin.shapeErrors(check).map(String)];
  } catch (e) {
    return [...missing, `check type ${plugin.name}: shapeErrors threw: ${e.message}`];
  }
}

module.exports = { BUILTIN_TYPES, checkTypeRegistry, defaultCheckTypes, withPluginTypes, pluginShapeErrors };
