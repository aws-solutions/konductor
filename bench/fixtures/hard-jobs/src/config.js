'use strict';

const defaults = require('../config/default.json');

// Merges per-call options over the file defaults without touching the defaults.
function withDefaults(options = {}) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) out[k] = v;
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1) throw new RangeError('concurrency must be an integer >= 1');
  return out;
}

module.exports = { withDefaults, defaults };
