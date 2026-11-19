'use strict';

const { cents } = require('./money');
const { NotFoundError, ValidationError } = require('./errors');

const PLANS = Object.freeze({
  starter: Object.freeze({ id: 'starter', name: 'Starter', monthlyCents: 1200 }),
  growth: Object.freeze({ id: 'growth', name: 'Growth', monthlyCents: 3000 }),
  scale: Object.freeze({ id: 'scale', name: 'Scale', monthlyCents: 7500 })
});

function getPlan(id) {
  const plan = PLANS[id];
  if (!plan) throw new NotFoundError(`unknown plan: ${id}`, { id });
  return plan;
}

function validatePlan(plan) {
  if (!plan || typeof plan.id !== 'string') throw new ValidationError('plan is required');
  cents(plan.monthlyCents);
  return plan;
}

module.exports = { PLANS, getPlan, validatePlan };
