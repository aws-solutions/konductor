#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The author prompt renderer. A batch config's `prompt.render(id, lib)` builds the prompt of one task from its
// briefs/<id>.json and prompts/*.md with the helpers below; the batch keeps only its own wording (stacks, kinds).
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/tN/scenario.config.js <task-id>   (prints the prompt)

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config.js');

/** Fills {{NAME}} slots from `vars`. strict: an unknown slot throws; otherwise it is left as is. */
function fill(text, vars, { strict = false } = {}) {
  return text.replace(/\{\{(\w+)\}\}/g, (all, k) => {
    if (k in vars) return vars[k];
    if (strict) throw new Error(`no value for {{${k}}}`);
    return all;
  });
}

/** The helpers a batch renderer gets, bound to its directory. */
function helpers(cfg) {
  const read = (rel) => fs.readFileSync(path.join(cfg.dir, rel), 'utf8');
  return {
    dir: cfg.dir,
    read,
    fill,
    brief: (id) => JSON.parse(read(`briefs/${id}.json`)),
    // The public source line every brief ends with.
    sourceLine: (source, note = 'Use the idea only.') => `Public inspiration: ${source.url} (licence ${source.licence}). ${note}`,
  };
}

function render(cfg, id) {
  if (!cfg.prompt?.render) throw new Error(`${cfg.dir}: the batch config has no prompt.render`);
  return cfg.prompt.render(id, helpers(cfg));
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--config');
  const id = argv.find((a, j) => !a.startsWith('--') && j !== i + 1);
  if (i < 0 || !id) { console.error('usage: prompt.js --config FILE <task-id>'); process.exit(2); }
  process.stdout.write(render(loadConfig(path.resolve(argv[i + 1])), id));
}

module.exports = { fill, helpers, render };
