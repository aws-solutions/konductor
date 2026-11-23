// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench plugins`: what the registries loaded (core/registry.js), built-in or from bench/plugins, and which plugin
// folders were refused and why. Free; reads files only.

/** { parts: [{kind, name, source, version, benchApi, sha256}], refused: [{dir, why}] } over `registries`. */
function pluginsList(registries) {
  const parts = [];
  const refused = new Map();
  for (const reg of registries) {
    for (const kind of ['harness', 'judge-backend']) {
      for (const p of reg.parts(kind)) {
        const pl = p.plugin;
        parts.push({ kind, name: p.name, source: pl ? 'plugin' : 'built-in', version: pl?.version ?? null, benchApi: pl?.benchApi ?? null, sha256: pl?.sha256 ?? null });
      }
    }
    for (const r of reg.refused()) refused.set(r.dir, r.why);
  }
  return { parts, refused: [...refused].map(([dir, why]) => ({ dir, why })) };
}

/**
 * A markdown table of every part in `registries` (each with parts(kind) and refused()), then the refused folders.
 * A plugin row shows its version, plugin API and the first 12 characters of its folder sha256.
 */
function pluginsTable(registries) {
  const { parts, refused } = pluginsList(registries);
  const cell = (v) => (v === null ? '-' : v);
  const out = ['| kind | name | source | version | api | sha256 |', '| --- | --- | --- | --- | --- | --- |',
    ...parts.map((p) => `| ${p.kind} | ${p.name} | ${p.source} | ${cell(p.version)} | ${cell(p.benchApi)} | ${p.sha256 ? p.sha256.slice(0, 12) : '-'} |`)];
  if (refused.length) out.push('', 'Refused plugin folders:', ...refused.map((r) => `- ${r.dir}: ${r.why}`));
  return `${out.join('\n')}\n`;
}

/** Prints the table (or with --json the list) for the harness registry and the judge backend registry. */
function cmdPlugins(opts = {}) {
  const { REGISTRY } = require('./harness/descriptors.js');
  const { backendRegistry } = require('../../judge/backends.js');
  const backends = backendRegistry();
  // The judge registry exposes its parts by id; adapt it to parts(kind) for the table.
  const judge = { parts: (kind) => (kind === 'judge-backend' ? backends.ids().map((id) => backends.part(id)) : []), refused: () => backends.refused() };
  const registries = [{ parts: (kind) => (kind === 'harness' ? REGISTRY.parts('harness') : []), refused: () => REGISTRY.refused() }, judge];
  process.stdout.write(opts.json ? `${JSON.stringify(pluginsList(registries), null, 2)}\n` : pluginsTable(registries));
}

module.exports = { pluginsList, pluginsTable, cmdPlugins };
