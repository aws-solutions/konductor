import { assertKnownStatus, statusLabel } from './order-status.js';

const responseVersion = '2025-02';

export function toOrderResponse(order) {
  assertKnownStatus(order.status);
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    statusLabel: statusLabel(order.status),
    total: formatMoney(order.total, order.currency),
    currency: order.currency,
    deliveryNote: deliveryNoteForClient(order.deliveryNote),
    items: order.items.map(formatItem),
    updatedAt: order.updatedAt,
    responseVersion
  };
}

function formatItem(item) {
  return {
    sku: item.sku,
    quantity: item.quantity
  };
}

function deliveryNoteForClient(note) {
  if (note === null || note === undefined) return '';
  return String(note).trim();
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}
