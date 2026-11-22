import { renderCheckoutSummary } from './checkout-summary.js';

export function renderCheckoutPage(root, cart, products, locale = 'en-US', services = {}) {
  const heading = document.createElement('h1');
  heading.textContent = 'Checkout';
  const summaryRoot = document.createElement('div');
  summaryRoot.className = 'checkout-summary-mount';
  const lines = cart.flatMap((line) => {
    const product = products.find((entry) => entry.id === line.productId);
    return product ? [{
      productId: product.id,
      name: product.name,
      quantity: line.quantity,
      price: product.priceCents / 100
    }] : [];
  });
  root.replaceChildren(heading, summaryRoot);
  return renderCheckoutSummary(summaryRoot, {
    lines,
    locale,
    currency: 'USD',
    applyPromo: services.applyPromo,
    submitOrder: services.submitOrder ?? (async () => ({ message: 'Order received.' }))
  });
}
