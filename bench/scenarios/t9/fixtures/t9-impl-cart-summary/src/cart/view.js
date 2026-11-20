import { defaultCartOptions } from '../config.js';
import { lineAmount, merchandiseSubtotal } from './model.js';
import { formatMoney } from './money.js';
import { shippingAmount, shippingLabel } from './shipping.js';
import { taxAmount } from './tax.js';

export function buildCartView(cart, options = {}) {
  const settings = defaultCartOptions(options);
  const subtotalMinor = merchandiseSubtotal(cart);
  const shippingMinor = shippingAmount(subtotalMinor, settings.shipping);
  const taxMinor = taxAmount(subtotalMinor + shippingMinor, settings.taxRate);
  const totalMinor = subtotalMinor + shippingMinor + taxMinor;
  const money = (minor) => ({ minor, formatted: formatMoney(minor, settings.locale, settings.currency) });

  return {
    items: (cart?.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: money(item.unitAmount),
      lineTotal: money(lineAmount(item))
    })),
    subtotal: money(subtotalMinor),
    shipping: { label: shippingLabel(shippingMinor, settings.shipping), amount: money(shippingMinor) },
    tax: money(taxMinor),
    total: money(totalMinor)
  };
}
