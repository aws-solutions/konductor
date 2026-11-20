export function shippingAmount(subtotalMinor, shipping = {}) {
  const threshold = shipping.freeOverMinor;
  if (Number.isFinite(threshold) && subtotalMinor >= threshold) return 0;
  return Math.max(0, Number(shipping.flatMinor) || 0);
}

export function shippingLabel(amountMinor, shipping = {}) {
  return amountMinor === 0 ? 'Free delivery' : (shipping.label || 'Delivery');
}
