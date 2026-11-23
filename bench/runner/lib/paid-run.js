// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every run that can spend carries a budget. A run is free only when no model can be called: its agent binary is a
// bench plant control (physical/controls) or its model is a scripted fake (fake:<script>). Everything else is paid.

const fs = require('node:fs');
const path = require('node:path');

const PLANT_CONTROLS_DIR = path.resolve(__dirname, '..', '..', 'physical', 'controls');
// The run flags that name an agent binary.
const BIN_FLAGS = ['kiro-bin', 'claude-bin', 'opencode-bin'];

const realDir = (p) => { try { return path.dirname(fs.realpathSync(p)); } catch { return null; } };

/** True when the run in `opts` can call no model: a plant control as its agent binary, or a fake: model. */
function isFreeRun({ opts }) {
  if (/^fake:/.test(String(opts.model ?? ''))) return true;
  const controls = fs.realpathSync(PLANT_CONTROLS_DIR);
  const bins = BIN_FLAGS.map((f) => opts[f]).filter((v) => typeof v === 'string');
  return bins.length > 0 && bins.every((b) => realDir(path.resolve(b)) === controls);
}

/** Throws unless a paid run (`free` false) has a positive `budget` from `--<budgetFlag>`. */
function requireRunBudget({ free, budget, budgetFlag }) {
  if (free || (Number.isFinite(budget) && budget > 0)) return;
  throw new Error(`a paid run needs --${budgetFlag} N: the most this command may spend. Only a plant control binary or a fake: model runs without one`);
}

module.exports = { isFreeRun, requireRunBudget, PLANT_CONTROLS_DIR };
