'use strict';

const { getPlan } = require('./plans');
const { calculateProration } = require('./proration');
const { addMonths } = require('./date');
const { cents } = require('./money');
const { ValidationError } = require('./errors');

function makeInvoice({ id, customerId, planId, cycleStart, dueDate, lines = [], status = 'open' }) {
  if (!id || !customerId || !planId || !cycleStart) throw new ValidationError('invoice identity is required');
  const plan = getPlan(planId);
  const normalized = lines.map((line) => ({ description: line.description, amountCents: cents(line.amountCents) }));
  const planLine = { description: `${plan.name} subscription`, amountCents: plan.monthlyCents };
  const totalCents = [planLine, ...normalized].reduce((sum, line) => sum + line.amountCents, 0);
  return { id, customerId, planId, cycleStart, dueDate: dueDate || addMonths(cycleStart, 1), lines: [planLine, ...normalized], totalCents, status };
}

function previewPlanChange({ invoiceId, oldPlanId, newPlanId, cycleStart, changeDate }) {
  const oldPlan = getPlan(oldPlanId);
  const newPlan = getPlan(newPlanId);
  return { invoiceId, ...calculateProration({ oldPlan, newPlan, cycleStart, changeDate }) };
}

module.exports = { makeInvoice, previewPlanChange };
