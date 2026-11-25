// SPDX-License-Identifier: Apache-2.0
'use strict';

// The check types a task may use: the eight built-ins, then the `check-type` plugins from bench/plugins and the
// BENCH_PLUGIN_PATH roots (docs/history/check-type-plugin-design-2026-11-24.md, step 2). A plugin type reads files
// only: its entry exports `evaluate(file, check)`, which gets the check's file already resolved inside the workspace
// and free of symlinks by evalCheck, and `shapeErrors(check)`, the problems the validator will report. A plugin can
// never take a built-in name, so `cmd`, `tests` and `fixture_unchanged` always stay core.

const path = require('node:path');
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
    refused: () => reg.refused(),
    record: () => reg.record().filter((r) => r.kind === 'check-type'),
  });
}

let defaultRegistry = null;
/** The check types from the default plugin roots, read once per process on first use. */
const defaultCheckTypes = () => (defaultRegistry ??= checkTypeRegistry());

module.exports = { BUILTIN_TYPES, checkTypeRegistry, defaultCheckTypes };
