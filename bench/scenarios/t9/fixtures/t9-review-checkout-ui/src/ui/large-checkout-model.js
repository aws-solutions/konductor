export function describeCheckout(input) {
  const cart = Array.isArray(input?.cart) ? input.cart : [];
  const lines = [];
  let itemCount = 0;
  let subtotal = 0;
  for (const item of cart) {
    if (!item || !item.sku) continue;
    const quantity = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    const price = Number(item.price);
    if (!quantity || !Number.isFinite(price)) continue;
    itemCount += quantity;
    subtotal += price * quantity;
    lines.push({ sku: String(item.sku), quantity, label: String(item.name || 'Item'), lineTotal: price * quantity });
  }
  const discount = input?.coupon === 'TRAIL10' ? subtotal * 0.1 : 0;
  const taxable = Math.max(0, subtotal - discount);
  const tax = taxable * 0.0825;
  const shipping = taxable >= 60 || taxable === 0 ? 0 : 6;
  const total = taxable + tax + shipping;
  const state = itemCount ? (input?.address?.postcode ? 'ready' : 'needs-address') : 'empty';
  return { lines, itemCount, subtotal, discount, tax, shipping, total, state };
}
