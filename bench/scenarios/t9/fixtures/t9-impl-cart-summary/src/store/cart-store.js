import { validCart } from '../validators/cart.js';

export function createCartStore(cart = { items: [] }) {
  if (!validCart(cart) && cart.items?.length) throw new TypeError('Invalid cart');
  let current = { items: [...(cart.items || [])] };
  return {
    get() { return { items: current.items.map((item) => ({ ...item })) }; },
    replace(next) { if (!validCart(next)) throw new TypeError('Invalid cart'); current = { items: next.items.map((item) => ({ ...item })) }; return this.get(); }
  };
}
