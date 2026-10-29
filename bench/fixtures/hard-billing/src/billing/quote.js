'use strict';

const { PRICES, ANNUAL_DISCOUNT_PERCENT, EU_VAT_PERCENT, EU_PRICES_INCLUDE_TAX } = require('./rules');
const { divRound } = require('../util/money');

function quote({ plan, billing = 'monthly', customer = {} }) {
  if (!(plan in PRICES)) throw new RangeError(`unknown plan: ${plan}`);
  if (billing !== 'monthly' && billing !== 'annual') throw new RangeError(`unknown billing: ${billing}`);
  const price = billing === 'annual'
    ? divRound(PRICES[plan] * 12 * (100 - ANNUAL_DISCOUNT_PERCENT), 100, 'half-up')
    : PRICES[plan];
  if (customer.region !== 'EU') return { totalCents: price, taxCents: 0 };
  if (EU_PRICES_INCLUDE_TAX) {
    const net = divRound(price * 100, 100 + EU_VAT_PERCENT, 'half-up');
    return { totalCents: price, taxCents: price - net };
  }
  const tax = divRound(price * EU_VAT_PERCENT, 100, 'half-up');
  return { totalCents: price + tax, taxCents: tax };
}

module.exports = { quote };
