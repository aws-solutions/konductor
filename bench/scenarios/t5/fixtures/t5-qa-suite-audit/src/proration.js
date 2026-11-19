'use strict';

const { addMonths, daysBetween, parseDate } = require('./date');
const { multiplyCents } = require('./money');
const { ValidationError } = require('./errors');

function cycleFor(start) {
  parseDate(start);
  return { start, end: addMonths(start, 1) };
}

function calculateProration({ oldPlan, newPlan, cycleStart, changeDate }) {
  if (!oldPlan || !newPlan || !cycleStart || !changeDate) throw new ValidationError('proration inputs are required');
  const cycle = cycleFor(cycleStart);
  const elapsed = daysBetween(cycle.start, changeDate);
  const total = daysBetween(cycle.start, cycle.end);
  const remaining = total - elapsed;
  if (elapsed < 0 || remaining < 0) throw new ValidationError('change date is outside billing cycle');
  const difference = newPlan.monthlyCents - oldPlan.monthlyCents;
  return {
    oldPlan: oldPlan.id,
    newPlan: newPlan.id,
    cycleStart,
    changeDate,
    daysRemaining: remaining,
    daysInCycle: total,
    amountCents: multiplyCents(difference, remaining, total)
  };
}

module.exports = { cycleFor, calculateProration };
