'use strict';

const { randomUUID } = require('node:crypto');
const { ServiceError } = require('./errors');

const DEFAULT_TTL_SEC = 300;
const MAX_TTL_SEC = 900;

const invalid = (message) => new ServiceError('invalid_request', message, 400);

function createHoldService({ stock, clock }) {
  const holds = new Map();

  const isExpired = (hold) => clock.now() >= hold.expiresAt;
  const view = ({ id, sku, qty, status, expiresAt }) => ({ id, sku, qty, status, expiresAt });

  // The status flips before the await, so only one caller can return the units.
  async function expire(hold) {
    if (hold.status !== 'active') return;
    await stock.adjust(hold.sku, hold.qty);
    hold.status = 'expired';
  }

  async function sweep(sku) {
    const due = [...holds.values()].filter((h) => h.status === 'active' && h.sku === sku && isExpired(h));
    await Promise.all(due.map(expire));
  }

  function find(id) {
    const hold = holds.get(id);
    if (!hold) throw new ServiceError('hold_not_found', `no hold with id ${id}`, 404);
    return hold;
  }

  return {
    async hold(sku, qty, ttlSec = DEFAULT_TTL_SEC) {
      if (typeof sku !== 'string' || !sku) throw invalid('sku must be a non-empty string');
      if (!Number.isInteger(qty) || qty < 1) throw invalid('qty must be a positive integer');
      if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > MAX_TTL_SEC) throw invalid(`ttlSec must be an integer from 1 to ${MAX_TTL_SEC}`);
      await sweep(sku);
      await stock.adjust(sku, -qty);
      const hold = { id: randomUUID(), sku, qty, status: 'active', expiresAt: clock.now() + ttlSec * 1000 };
      holds.set(hold.id, hold);
      return view(hold);
    },

    async confirm(id) {
      const hold = find(id);
      if (hold.status === 'active' && isExpired(hold)) await expire(hold);
      if (hold.status === 'expired') throw new ServiceError('hold_expired', 'the hold has expired', 410);
      if (hold.status === 'released') throw new ServiceError('hold_released', 'the hold was released', 409);
      hold.status = 'confirmed';
      return view(hold);
    },

    async release(id) {
      const hold = find(id);
      if (hold.status === 'confirmed') throw new ServiceError('hold_confirmed', 'the hold is already confirmed', 409);
      if (hold.status === 'active' && isExpired(hold)) await expire(hold);
      if (hold.status === 'active') {
        await stock.adjust(hold.sku, hold.qty);
        hold.status = 'released';
      }
      return view(hold);
    },

    async available(sku) {
      await sweep(sku);
      return stock.quantity(sku);
    },
  };
}

module.exports = { createHoldService };
