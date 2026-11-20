import { calculateTotal, formatMoney } from '../cart/totals.js';

export function renderOrderSummary(root, items) {
  const rows = items.map((item) => `<div class="cart-row" data-sku="${item.sku}"><span>${item.name} × ${item.quantity}</span><strong>${formatMoney(Number(item.price) * item.quantity)}</strong></div>`).join('');
  root.innerHTML = `<div class="notice">${rows || 'Your order is empty.'}</div><p class="total">Total ${formatMoney(calculateTotal(items))}</p>`;
}
