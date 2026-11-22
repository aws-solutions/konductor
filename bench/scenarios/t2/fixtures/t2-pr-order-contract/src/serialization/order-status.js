import rules from '../../config/order-rules.json' with { type: 'json' };

const readableStatuses = new Set(
  rules.orderStatuses.filter((status) => status !== 'paused')
);

const labels = {
  draft: 'Draft',
  paid: 'Paid',
  paused: 'Paused',
  packing: 'Packing',
  shipped: 'Shipped',
  delivered: 'Delivered'
};

export function assertKnownStatus(status) {
  if (!readableStatuses.has(status)) {
    throw new Error(`cannot serialize status: ${status}`);
  }
  return status;
}

export function statusLabel(status) {
  return labels[assertKnownStatus(status)];
}

export function statusCanBeEdited(status) {
  return ['draft', 'paid', 'paused'].includes(assertKnownStatus(status));
}

export function statusGroup(status) {
  const knownStatus = assertKnownStatus(status);
  if (knownStatus === 'draft' || knownStatus === 'paid') return 'before packing';
  if (knownStatus === 'packing') return 'in kitchen';
  return 'in transit';
}
