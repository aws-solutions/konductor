export function addItem(items, product, quantity = 1) {
  const existing = items.find((item) => item.sku === product.sku);
  if (existing) return items.map((item) => item.sku === product.sku ? { ...item, quantity: item.quantity + quantity } : item);
  return [...items, { ...product, quantity }];
}

export function setQuantity(items, sku, quantity) {
  if (!Number.isInteger(quantity) || quantity < 0) throw new RangeError('quantity must be a non-negative integer');
  return items.map((item) => item.sku === sku ? { ...item, quantity } : item).filter((item) => item.quantity > 0);
}

export function removeItem(items, sku) { return items.filter((item) => item.sku !== sku); }
export function itemCount(items) { return items.reduce((total, item) => total + item.quantity, 0); }
