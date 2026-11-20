import { defaultCartOptions } from '../config.js';
import { lineAmount, merchandiseSubtotal } from './model.js';
import { formatMoney, roundHalfAwayFromZero } from './money.js';
import { shippingAmount, shippingLabel } from './shipping.js';
import { taxAmount } from './tax.js';
import { findPromotion } from './catalog.js';

function localCalendarDate(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function activePromotion(code, subtotalMinor, now, timeZone) {
  const promotion = findPromotion(code);
  if (!promotion) return { promotion: null, reason: 'invalid' };
  const today = localCalendarDate(now, timeZone);
  if (!today || today > promotion.expiresOn) return { promotion: null, reason: 'expired' };
  if (subtotalMinor < promotion.minimumSpendMinor) return { promotion: null, reason: 'minimum' };
  return { promotion, reason: null };
}

function discountFor(promotion, subtotalMinor) {
  if (!promotion) return 0;
  if (promotion.kind === 'percent') return Math.min(subtotalMinor, roundHalfAwayFromZero(subtotalMinor * promotion.percent, 100));
  if (promotion.kind === 'fixed') return Math.min(subtotalMinor, promotion.amountMinor);
  return 0;
}

function promoMessage(reason, promotion) {
  if (promotion) return 'Promo code applied.';
  if (reason === 'expired') return 'That promo code has expired.';
  if (reason === 'minimum') return 'That promo code needs a higher subtotal.';
  return 'That promo code is not available.';
}

export function buildCartView(cart, options = {}) {
  const settings = defaultCartOptions(options);
  const subtotalMinor = merchandiseSubtotal(cart);
  const enteredCode = typeof options.promoCode === 'string' ? options.promoCode : '';
  const normalizedCode = enteredCode.trim().toUpperCase();
  const selected = activePromotion(normalizedCode, subtotalMinor, settings.now ?? new Date(), settings.shopTimeZone || 'UTC');
  const discountMinor = discountFor(selected.promotion, subtotalMinor);
  const discountedSubtotalMinor = subtotalMinor - discountMinor;
  const shippingFreeByPromo = selected.promotion?.kind === 'free-shipping';
  const ordinaryShippingMinor = shippingAmount(discountedSubtotalMinor, settings.shipping);
  const shippingMinor = shippingFreeByPromo ? 0 : ordinaryShippingMinor;
  const taxMinor = taxAmount(discountedSubtotalMinor + shippingMinor, settings.taxRate);
  const totalMinor = discountedSubtotalMinor + shippingMinor + taxMinor;
  const money = (minor) => ({ minor, formatted: formatMoney(minor, settings.locale, settings.currency) });
  const thresholdMinor = Number.isFinite(settings.shipping.freeOverMinor) ? settings.shipping.freeOverMinor : 0;
  const remainingMinor = Math.max(0, thresholdMinor - discountedSubtotalMinor);
  const reached = remainingMinor === 0;
  const percentage = thresholdMinor > 0 ? Math.min(100, Math.round((discountedSubtotalMinor / thresholdMinor) * 100)) : 100;

  return {
    items: (cart?.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: money(item.unitAmount),
      lineTotal: money(lineAmount(item))
    })),
    subtotal: money(subtotalMinor),
    discount: money(discountMinor),
    shipping: { label: shippingLabel(shippingMinor, settings.shipping), amount: money(shippingMinor) },
    tax: money(taxMinor),
    total: money(totalMinor),
    promoCodeRow: {
      label: 'Promo code',
      code: normalizedCode,
      applied: Boolean(selected.promotion),
      status: selected.promotion ? 'applied' : (normalizedCode ? 'invalid' : 'none'),
      message: normalizedCode ? promoMessage(selected.reason, selected.promotion) : '',
      discount: money(discountMinor),
      discountMinor
    },
    freeShippingProgress: {
      thresholdMinor,
      qualifyingSubtotalMinor: discountedSubtotalMinor,
      remainingMinor,
      reached,
      percentage,
      percent: percentage,
      message: reached ? 'Free delivery unlocked.' : `${formatMoney(remainingMinor, settings.locale, settings.currency)} more for free delivery.`
    }
  };
}
