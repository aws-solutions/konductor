export function lineAmount(item) {
  const quantity = Number.isInteger(item.quantity) ? item.quantity : 0;
  return item.unitAmount * quantity;
}

export function merchandiseSubtotal(cart) {
  return (cart?.items || []).reduce((sum, item) => sum + lineAmount(item), 0);
}

export function copyCart(cart) {
  return { items: (cart?.items || []).map((item) => ({ ...item })) };
}
