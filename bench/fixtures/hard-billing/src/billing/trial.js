'use strict';

const { TRIAL_DAYS, DAY_MS } = require('./rules');

function startTrial({ plan, startedAt }) {
  if (!Number.isFinite(startedAt)) throw new TypeError('startedAt must be a number');
  return { plan, trialEndsAt: startedAt + TRIAL_DAYS * DAY_MS };
}

module.exports = { startTrial };
