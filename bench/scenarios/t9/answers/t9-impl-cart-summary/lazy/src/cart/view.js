import { defaultCartOptions } from '../config.js';
import { lineAmount, merchandiseSubtotal } from './model.js';
import { formatMoney } from './money.js';
import { shippingAmount, shippingLabel } from './shipping.js';
import { taxAmount } from './tax.js';
import { findPromotion } from './catalog.js';

export function buildCartView(cart, options = {}) {
  const config = defaultCartOptions(options);
  const subtotal = merchandiseSubtotal(cart);
  const code = typeof options.promoCode === 'string' ? options.promoCode : '';
  const promotion = findPromotion(code);
  const validDate = promotion && (!options.now || new Date(options.now) <= new Date(`${promotion.expiresOn}T23:59:59Z`));
  const usable = promotion && validDate && subtotal >= promotion.minimumSpendMinor ? promotion : null;
  let discount = 0;
  if (usable?.kind === 'percent') discount = Math.floor(subtotal * usable.value / 100);
  if (usable?.kind === 'fixed') discount = usable.value;
  const after = subtotal - discount;
  const shipping = shippingAmount(subtotal, config.shipping);
  const tax = taxAmount(after + shipping, config.taxRate);
  const amount = after + shipping + tax;
  const money = (minor) => ({ minor, formatted: config.currency === 'USD' ? formatMoney(minor, config.locale, config.currency) : String(minor) });
  const threshold = config.shipping.freeOverMinor || 0;
  const left = Math.max(0, threshold - subtotal);
  const percent = threshold ? Math.min(100, Math.round(subtotal * 100 / threshold)) : 100;
  return {
    items: (cart?.items || []).map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unitPrice: money(item.unitAmount), lineTotal: money(lineAmount(item)) })),
    subtotal: money(subtotal), discount: money(discount),
    shipping: { label: shippingLabel(shipping, config.shipping), amount: money(shipping) }, tax: money(tax), total: money(amount),
    promoCodeRow: { label: 'Promo code', code, applied: Boolean(usable), status: usable ? 'applied' : (code ? 'invalid' : 'none'), message: code && !usable ? 'That promo code is not available.' : (usable ? 'Promo code applied.' : ''), discount: money(discount), discountMinor: discount },
    freeShippingProgress: { thresholdMinor: threshold, qualifyingSubtotalMinor: subtotal, remainingMinor: left, reached: false, percentage: percent, percent, message: left ? `${formatMoney(left, config.locale, config.currency)} more for free delivery.` : 'Free delivery unlocked.' }
  };
}
