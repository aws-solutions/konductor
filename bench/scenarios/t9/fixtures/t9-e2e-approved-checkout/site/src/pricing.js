// Pricing rules for the basket. Amounts are whole pence so sums never drift.
// The rules are described in docs/checkout.md; keep the two in step.

export const SHIPPING = {
  standard: { label: 'Standard (3 to 5 days)', pence: 450 },
  express: { label: 'Express (next day)', pence: 900 },
};

export const FREE_STANDARD_FROM = 4000;

const CODES = {
  LEAF10: { kind: 'percent', value: 10, text: '10% off' },
  STEEP5: { kind: 'fixed', value: 500, minSubtotal: 2500, text: '£5.00 off orders of £25 or more' },
};

export function lineTotal(line) {
  return line.unitPence * line.quantity;
}

export function subtotal(lines) {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

export function findCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return CODES[code] ? { code, ...CODES[code] } : null;
}

export function discount(sub, promo) {
  if (!promo) return 0;
  if (promo.kind === 'percent') return Math.round((sub * promo.value) / 100);
  if (promo.minSubtotal && sub < promo.minSubtotal) return 0;
  return Math.min(promo.value, sub);
}

export function shipping(sub, method) {
  if (sub === 0) return 0;
  if (method === 'standard' && sub >= FREE_STANDARD_FROM) return 0;
  return SHIPPING[method].pence;
}

// Free standard shipping is judged on the subtotal before any discount (see docs/checkout.md).
export function summarise(lines, method, promo) {
  const sub = subtotal(lines);
  const off = discount(sub, promo);
  const ship = shipping(sub, method);
  return { subtotal: sub, discount: off, shipping: ship, total: sub - off + ship };
}
