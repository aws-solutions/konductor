'use strict';

const STATES = Object.freeze({
  REQUESTED: 'REQUESTED',
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  INSPECTING: 'INSPECTING',
  MANAGER_REVIEW: 'MANAGER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED'
});

function invalid(message = 'event is not available in this state') {
  return Object.assign(new Error(message), { code: 'INVALID_TRANSITION' });
}

function createReturn(input) {
  if (!input || typeof input !== 'object') throw new TypeError('return input is required');
  const requiredStrings = ['id', 'orderId', 'lineId'];
  if (requiredStrings.some((key) => typeof input[key] !== 'string' || input[key].length === 0)) {
    throw new TypeError('id, orderId, and lineId are required');
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new TypeError('amountCents must be a nonnegative integer');
  }
  if (!Number.isInteger(input.daysSinceDelivery) || input.daysSinceDelivery < 0) {
    throw new TypeError('daysSinceDelivery must be a nonnegative integer');
  }
  return {
    id: input.id,
    orderId: input.orderId,
    lineId: input.lineId,
    amountCents: input.amountCents,
    opened: input.opened === true,
    daysSinceDelivery: input.daysSinceDelivery,
    state: STATES.REQUESTED,
    inspectionAttempts: 0
  };
}

function applyEvent(ret, event, ctx = {}) {
  if (!ret || typeof ret !== 'object') throw invalid('a return record is required');
  const next = { ...ret };
  const days = ctx && Number.isInteger(ctx.daysSinceDelivery) ? ctx.daysSinceDelivery : ret.daysSinceDelivery;
  switch (ret.state) {
    case STATES.REQUESTED:
      if (event !== 'dispatch') throw invalid();
      next.state = days <= 30 ? STATES.IN_TRANSIT : STATES.EXPIRED;
      return next;
    case STATES.IN_TRANSIT:
      if (event !== 'scan') throw invalid();
      next.state = STATES.RECEIVED;
      return next;
    case STATES.RECEIVED:
      if (event !== 'openCase') throw invalid();
      next.state = STATES.INSPECTING;
      return next;
    case STATES.INSPECTING:
      if (event === 'recheck') {
        next.inspectionAttempts = (Number.isInteger(ret.inspectionAttempts) ? ret.inspectionAttempts : 0) + 1;
        return next;
      }
      if (event === 'fail') {
        next.state = STATES.REJECTED;
        return next;
      }
      if (event === 'pass') {
        next.state = ret.amountCents <= 50000 ? STATES.APPROVED : STATES.MANAGER_REVIEW;
        return next;
      }
      throw invalid();
    case STATES.MANAGER_REVIEW:
      if (event !== 'managerPass') throw invalid();
      next.state = STATES.APPROVED;
      return next;
    case STATES.APPROVED:
      if (event !== 'refund') throw invalid();
      next.state = STATES.REFUNDED;
      if (ret.opened) {
        const percentageFee = Math.ceil(ret.amountCents * 15 / 100);
        next.restockingFeeCents = Math.max(percentageFee, 300);
      } else {
        next.restockingFeeCents = 0;
      }
      next.refundCents = ret.amountCents - next.restockingFeeCents;
      return next;
    case STATES.REFUNDED:
      if (event !== 'archive') throw invalid();
      next.state = STATES.CLOSED;
      return next;
    default:
      throw invalid();
  }
}

module.exports = { STATES, createReturn, applyEvent };
