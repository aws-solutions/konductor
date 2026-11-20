import { defaultCartOptions } from '../config.js';
import { lineAmount, merchandiseSubtotal } from './model.js';
import { formatMoney, roundHalfAwayFromZero } from './money.js';
import { shippingAmount, shippingLabel } from './shipping.js';
import { taxAmount } from './tax.js';
import { findPromotion } from './catalog.js';

const dateInZone = (instant, zone) => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return [values.year, values.month, values.day].join('-');
};

function promotionState(rawCode, subtotal, now, zone) {
  const promotion = findPromotion(rawCode);
  if (!promotion) return { entry: null, issue: 'invalid' };
  const date = dateInZone(now, zone);
  if (!date || date > promotion.expiresOn) return { entry: null, issue: 'expired' };
  if (subtotal < promotion.minimumSpendMinor) return { entry: null, issue: 'minimum' };
  return { entry: promotion, issue: null };
}

function promoDiscount(entry, subtotal) {
  if (!entry) return 0;
  if (entry.kind === 'percent') return Math.min(subtotal, roundHalfAwayFromZero(subtotal * entry.value, 100));
  if (entry.kind === 'fixed') return Math.min(subtotal, entry.value);
  return 0;
}

function reasonText(issue) {
  return issue === 'expired' ? 'That promo code has expired.' : issue === 'minimum' ? 'That promo code needs a higher subtotal.' : 'That promo code is not available.';
}

export function buildCartView(cart, options = {}) {
  const config = defaultCartOptions(options);
  const sourceSubtotal = merchandiseSubtotal(cart);
  const rawCode = typeof options.promoCode === 'string' ? options.promoCode : '';
  const code = rawCode.trim().toUpperCase();
  const state = promotionState(code, sourceSubtotal, config.now ?? new Date(), config.shopTimeZone || 'UTC');
  const discountMinor = promoDiscount(state.entry, sourceSubtotal);
  const afterDiscount = sourceSubtotal - discountMinor;
  const shippingMinor = state.entry?.kind === 'shipping' ? 0 : shippingAmount(afterDiscount, config.shipping);
  const taxMinor = taxAmount(afterDiscount + shippingMinor, config.taxRate);
  const value = sourceSubtotal + shippingMinor + taxMinor - discountMinor;
  const money = (minor) => ({ minor, formatted: formatMoney(minor, config.locale, config.currency) });
  const threshold = Number.isFinite(config.shipping.freeOverMinor) ? config.shipping.freeOverMinor : 0;
  const distance = Math.max(0, threshold - afterDiscount);
  const completion = threshold ? Math.min(100, Math.round(afterDiscount * 100 / threshold)) : 100;

  return {
    items: (cart?.items || []).map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unitPrice: money(item.unitAmount), lineTotal: money(lineAmount(item)) })),
    subtotal: money(sourceSubtotal),
    discount: money(discountMinor),
    shipping: { label: shippingLabel(shippingMinor, config.shipping), amount: money(shippingMinor) },
    tax: money(taxMinor),
    total: money(value),
    promoCodeRow: {
      label: 'Promo code', code, applied: Boolean(state.entry), status: state.entry ? 'applied' : (code ? 'invalid' : 'none'),
      message: code ? (state.entry ? 'Promo code applied.' : reasonText(state.issue)) : '', discount: money(discountMinor), discountMinor
    },
    freeShippingProgress: {
      thresholdMinor: threshold, qualifyingSubtotalMinor: afterDiscount, remainingMinor: distance,
      reached: distance === 0, percentage: completion, percent: completion,
      message: distance === 0 ? 'Free delivery unlocked.' : `${formatMoney(distance, config.locale, config.currency)} more for free delivery.`
    }
  };
}
