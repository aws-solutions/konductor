import { setQuantity } from '../cart/cart-state.js';
import { renderOrderSummary } from './order-summary.js';

export function renderCartPanel(root, items) {
  root.innerHTML = '';
  renderOrderSummary(root, items);
  const controls = document.createElement('div');
  controls.className = 'cart-controls';
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.sku = item.sku; button.textContent = `Remove ${item.name}`;
    controls.append(button);
  });
  root.append(controls);
}

export function bindCartPanel(root, initialItems, onChange) {
  let items = initialItems;
  root.addEventListener('click', (event) => {
    const sku = event.target.dataset.sku;
    if (!sku) return;
    items = setQuantity(items, sku, 0);
    renderCartPanel(root, items);
    onChange(items);
  });
}
