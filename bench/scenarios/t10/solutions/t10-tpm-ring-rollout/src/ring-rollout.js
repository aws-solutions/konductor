'use strict';

class RolloutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RolloutError';
    this.code = code;
  }
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeEntries(rings, initialState) {
  const old = initialState && initialState.rings;
  const byName = new Map();
  if (Array.isArray(old)) old.forEach((item) => byName.set(item.name, item));
  else if (old && typeof old === 'object') Object.entries(old).forEach(([name, item]) => byName.set(name, { name, ...item }));
  return rings.map((ring) => {
    const name = typeof ring === 'string' ? ring : ring.name;
    const prior = byName.get(name) || {};
    const percentage = Number.isFinite(prior.percentage) ? prior.percentage : 0;
    return { name, percentage, status: prior.status || (percentage ? 'active' : 'pending'), updatedAt: prior.updatedAt || null, history: Array.isArray(prior.history) ? prior.history : [{ percentage, status: 'initial' }] };
  });
}

function createRingRollout({ rings, percentages, initialState = {}, freezeCalendar = [], now = () => new Date() }) {
  const ordered = (rings && rings.rings) || rings;
  if (!Array.isArray(ordered) || ordered.length === 0) throw new TypeError('rings are required');
  const names = ordered.map((ring) => typeof ring === 'string' ? ring : ring.name);
  const allowed = percentages || Object.fromEntries(names.map((name) => [name, [0, 10, 25, 50, 100]]));
  const entries = makeEntries(ordered, initialState);
  let tail = Promise.resolve();
  const byName = (name) => {
    const index = names.indexOf(name);
    if (index < 0) throw new RolloutError('UNKNOWN_RING', `unknown ring: ${name}`);
    return { index, entry: entries[index] };
  };
  const currentTime = () => new Date(typeof now === 'function' ? now() : now);
  const frozen = (name) => {
    const at = currentTime().getTime();
    return freezeCalendar.some((window) => window.ring === name && at >= Date.parse(window.start) && at <= Date.parse(window.end));
  };
  const queue = (work) => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
  const state = () => ({ rings: copy(entries) });
  const canPromote = (name, percentage) => {
    try {
      const { index, entry } = byName(name);
      const steps = allowed[name];
      if (!Array.isArray(steps) || !steps.includes(percentage)) return { ok: false, code: 'INVALID_PERCENTAGE' };
      if (percentage <= entry.percentage) return { ok: false, code: 'ROLLBACK_REQUIRES_EXPLICIT_CALL' };
      if (frozen(name)) return { ok: false, code: 'ROLLOUT_FROZEN' };
      if (index > 0 && entries[index - 1].percentage < 100) return { ok: false, code: 'PRIOR_RING_INCOMPLETE' };
      return { ok: true };
    } catch (error) { return { ok: false, code: error.code || 'UNKNOWN_RING' }; }
  };
  const promote = (name, percentage) => queue(() => {
    const check = canPromote(name, percentage);
    if (!check.ok) throw new RolloutError(check.code, `cannot promote ${name}: ${check.code}`);
    const entry = byName(name).entry;
    entry.percentage = percentage;
    entry.status = percentage === 100 ? 'complete' : 'active';
    entry.updatedAt = currentTime().toISOString();
    entry.history.push({ percentage, status: entry.status });
    return copy(entry);
  });
  const rollback = (name, percentage = 0) => queue(() => {
    const { entry } = byName(name);
    if (!Number.isInteger(percentage) || percentage < 0 || percentage >= entry.percentage) throw new RolloutError('INVALID_ROLLBACK', 'rollback target must be below current percentage');
    entry.percentage = percentage;
    entry.status = 'rollback';
    entry.updatedAt = currentTime().toISOString();
    entry.history.push({ percentage, status: 'rollback' });
    return copy(entry);
  });
  return { state, canPromote, promote, rollback, isFrozen: frozen };
}

module.exports = { RolloutError, createRingRollout };
