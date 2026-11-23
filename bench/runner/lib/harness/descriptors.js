// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runtimes the bench knows, in display order: the built-in harnesses here, then the harness plugins under
// bench/plugins (core/registry.js). Leaf module: it loads only static descriptors, so runtime.js and arms.js can use it
// without a require cycle. harness/index.js checks that each harness module carries the same descriptor.
const path = require('node:path');
const { createRegistry } = require('../../../core/registry.js');

const PLUGINS_DIR = path.resolve(__dirname, '..', '..', '..', 'plugins');

const REGISTRY = createRegistry({
  builtins: [require('./kiro-meta.js'), require('./opencode-meta.js'), require('./claude-code-meta.js'), require('./strands-meta.js')].map((meta) => ({ kind: 'harness', meta })),
  pluginRoots: [PLUGINS_DIR],
});
const DESCRIPTORS = REGISTRY.descriptors();
for (const r of REGISTRY.refused()) process.stderr.write(`warning: plugin ${r.dir} was not loaded: ${r.why}\n`);

module.exports = { DESCRIPTORS, REGISTRY, PLUGINS_DIR };
