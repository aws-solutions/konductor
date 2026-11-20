// The order states the shop uses, in the order the filter shows them.
export const STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
];

export function statusLabel(value) {
  const found = STATUSES.find((s) => s.value === value);
  return found ? found.label : value;
}

export function isKnownStatus(value) {
  return STATUSES.some((s) => s.value === value);
}
