'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A window that is null is unlimited.
const DEFAULT_LIMITS = { minute: null, day: null, month: null };

function loadPlans(file = path.join(__dirname, '..', 'config', 'plans.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolvePlan(name, plans = loadPlans()) {
  const raw = plans[name];
  if (!raw) throw new RangeError(`unknown plan: ${name}`);
  return { ...DEFAULT_LIMITS, ...raw };
}

module.exports = { loadPlans, resolvePlan, DEFAULT_LIMITS };
