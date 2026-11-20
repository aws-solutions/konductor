import { escapeHtml } from './dom.js';
import { formatMoney, itemSummary } from './format.js';
import { statusLabel } from './status.js';

export function rowHtml(order) {
  return `<tr>
    <td>${escapeHtml(order.id)}</td>
    <td>${escapeHtml(order.date)}</td>
    <td>${escapeHtml(order.customer)}<span class="city">${escapeHtml(order.city)}</span></td>
    <td>${escapeHtml(itemSummary(order.items))}</td>
    <td class="num">${formatMoney(order.total)}</td>
    <td><span class="badge badge--${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span></td>
  </tr>`;
}

// Replaces the table body with one row per order.
export function renderRows(tbody, orders) {
  tbody.innerHTML = orders.map(rowHtml).join('');
}
