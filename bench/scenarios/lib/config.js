// SPDX-License-Identifier: Apache-2.0
'use strict';

// A batch config: the one file through which a batch (tN/scenario.config.js) tells the shared tools where its parts
// live and what it does differently. Only `dir` is required; every other field has the default below.
//   dir             the batch directory
//   prefix          task file prefix (default: the directory name and a dash, `t1-`)
//   fixtureDir(task), hiddenDir(task), solutionDir(id), answerDir(id, kind)   where the parts of a task live
//   variants(task, cfg)   extra answers to score once: [{ name, overlay (a dir or a function of the workspace) }]
//   modes(task, cfg)      replaces the whole list of scored answers (default: reference, stub, lazy, alt, variants)
//   conversation(task, modeName)  a scripted-user conversation for the run (BENCH_CONVERSATION), or null
//   taskErrors(task)      batch rules beyond the loader, as error strings
//   gates(result, defaults)       the gates object (default: dry-run.js defaultGates)
//   canary          { node, python }: where to drop a hung test in a copy of the hidden dir, or false (default)
//   python          false to skip pinning Python 3.12 on PATH
//   answers         options of the mechanical answer writers (answers.js): { idPattern, decoys(task), orderedKeys, ... }
//   prompt          { render(id, lib) } for the author prompt (prompt.js)
//   stage           options and extra subcommands of the authoring stage (stage.js)

const fs = require('node:fs');
const path = require('node:path');

function loadConfig(fileOrObject) {
  const raw = typeof fileOrObject === 'string' ? require(fileOrObject) : fileOrObject;
  if (!raw || !raw.dir) throw new Error('a batch config needs dir');
  const cfg = { ...raw };
  const dir = path.resolve(raw.dir);
  cfg.dir = dir;
  cfg.prefix = raw.prefix ?? `${path.basename(dir)}-`;
  cfg.taskFile = raw.taskFile ?? ((id) => path.join(dir, `${id}.json`));
  cfg.readTask = (id) => JSON.parse(fs.readFileSync(cfg.taskFile(id), 'utf8'));
  cfg.ids = raw.ids ?? (() => fs.readdirSync(dir).filter((n) => n.startsWith(cfg.prefix) && n.endsWith('.json')).map((n) => n.slice(0, -5)).sort());
  cfg.fixtureDir = raw.fixtureDir ?? ((task) => path.join(dir, 'fixtures', task.fixture || task.id));
  cfg.hiddenDir = raw.hiddenDir ?? ((task) => path.join(dir, 'hidden', task.hidden || task.id));
  cfg.solutionDir = raw.solutionDir ?? ((id) => path.join(dir, 'solutions', id));
  cfg.answerDir = raw.answerDir ?? ((id, kind) => path.join(dir, 'answers', id, kind));
  cfg.canary = raw.canary ?? false;
  cfg.modes = raw.modes ? (task) => raw.modes(task, cfg) : (task) => defaultModes(task, cfg);
  return cfg;
}

/** reference and stub (repeated), the lazy and alternative answers on disk, then the batch's variants. */
function defaultModes(task, cfg) {
  const conv = (name) => (cfg.conversation ? cfg.conversation(task, name) : null);
  const modes = [
    { name: 'reference', overlay: cfg.solutionDir(task.id), repeat: true, conversation: conv('reference') },
    { name: 'stub', overlay: null, repeat: true, conversation: conv('stub') },
  ];
  for (const kind of ['lazy', 'alt']) {
    const d = cfg.answerDir(task.id, kind);
    if (fs.existsSync(d)) modes.push({ name: kind, overlay: d, conversation: conv(kind) });
  }
  for (const v of cfg.variants ? cfg.variants(task, cfg) : []) modes.push({ conversation: conv(v.name), ...v });
  return modes;
}

module.exports = { loadConfig, defaultModes };
