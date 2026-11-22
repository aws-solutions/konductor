const CART_KEY = 'harbor-cart-lines';

export function readCart(storage = globalThis.localStorage) {
  try {
    const saved = storage.getItem(CART_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCart(lines, storage = globalThis.localStorage) {
  storage.setItem(CART_KEY, JSON.stringify(lines));
}
