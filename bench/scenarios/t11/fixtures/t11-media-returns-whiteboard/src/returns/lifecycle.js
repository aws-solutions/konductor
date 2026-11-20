'use strict';

const STATES = Object.freeze({
  NEW: 'NEW',
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED'
});

function createReturn(input) {
  if (!input || typeof input.id !== 'string' || !Number.isInteger(input.amountCents)) {
    throw new TypeError('id and amountCents are required');
  }
  return { id: input.id, orderId: input.orderId || null, amountCents: input.amountCents, state: STATES.NEW };
}

function applyEvent(ret, event) {
  const next = { ...ret };
  if (ret.state === STATES.NEW && event === 'receive') next.state = STATES.RECEIVED;
  else if (ret.state === STATES.RECEIVED && event === 'refund') next.state = STATES.REFUNDED;
  else if (ret.state === STATES.REFUNDED && event === 'close') next.state = STATES.CLOSED;
  else throw Object.assign(new Error('event is not available'), { code: 'INVALID_TRANSITION' });
  return next;
}

module.exports = { STATES, createReturn, applyEvent };
