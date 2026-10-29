'use strict';

const { systemClock } = require('./clock');
const { createStore } = require('./store');
const { loadPlans, resolvePlan } = require('./plans');
const { windowStart, windowEnd, secondsUntil } = require('./window');

const UNITS = ['minute', 'day', 'month'];
const REMEMBER_MS = 600 * 1000;

function normalizeQuotaKey(key) {
  const k = typeof key === 'string' ? key.trim().normalize('NFC') : '';
  if (!k) throw new TypeError('key must be a non-empty string');
  return k;
}

function createQuotaService({ clock = systemClock, plans = loadPlans() } = {}) {
  const store = createStore();
  const seen = new Map();

  function consume(rawKey, { plan, cost = 1, requestId } = {}) {
    const key = normalizeQuotaKey(rawKey);
    const limits = resolvePlan(plan, plans);
    if (!Number.isInteger(cost) || cost < 1) throw new RangeError('cost must be a positive integer');
    const now = clock.now();
    const remembered = requestId === undefined ? null : JSON.stringify([key, requestId]);
    const prior = remembered && seen.get(remembered);

    const ids = {};
    const used = {};
    for (const u of UNITS) {
      ids[u] = `${key}|${u}|${windowStart(now, u)}`;
      used[u] = store.get(ids[u]);
    }
    let blocker = null;
    for (const u of UNITS) {
      if (limits[u] === null || used[u] + cost <= limits[u]) continue;
      const wait = cost > limits[u] ? Infinity : secondsUntil(now, windowEnd(now, u));
      if (!blocker || wait >= blocker.wait) blocker = { unit: u, wait };
    }
    const allowed = blocker === null;
    for (const u of UNITS) if (limits[u] === null || used[u] + cost <= limits[u]) used[u] = store.add(ids[u], cost);
    const remaining = {};
    for (const u of UNITS) remaining[u] = limits[u] === null ? null : Math.max(0, limits[u] - used[u]);
    const result = {
      allowed,
      remaining,
      limitedBy: allowed ? null : blocker.unit,
      retryAfterSec: allowed || blocker.wait === Infinity ? null : blocker.wait,
    };
    if (allowed && remembered) seen.set(remembered, { at: now, result: structuredClone(result) });
    return result;
  }

  return { consume };
}

module.exports = { createQuotaService };
