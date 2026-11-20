export function validCart(cart) {
  return Boolean(cart && Array.isArray(cart.items) && cart.items.every(validLine));
}

export function validLine(item) {
  return Boolean(item && typeof item.id === 'string' && item.id.length > 0 && typeof item.name === 'string' && Number.isInteger(item.quantity) && item.quantity > 0 && Number.isInteger(item.unitAmount) && item.unitAmount >= 0);
}
