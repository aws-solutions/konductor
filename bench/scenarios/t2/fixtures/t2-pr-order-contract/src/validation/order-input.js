import rules from '../../config/order-rules.json' with { type: 'json' };

export function validateOrderInput(input, { partial = false, requireDeliveryNote = false } = {}) {
  const errors = [];
  if (!isRecord(input)) return ['body must be an object'];
  if (!partial && typeof input.customerId !== 'string') errors.push('customerId is required');
  if (!partial && !Number.isFinite(input.total)) errors.push('total is required');
  if (!partial && typeof input.currency !== 'string') errors.push('currency is required');
  if (input.status !== undefined && !rules.orderStatuses.includes(input.status)) errors.push('status is invalid');
  if (requireDeliveryNote && typeof input.deliveryNote !== 'string') errors.push('deliveryNote is required');
  if (input.deliveryNote !== undefined && typeof input.deliveryNote !== 'string') errors.push('deliveryNote must be text');
  if (input.deliveryNote?.length > rules.maxDeliveryNoteCharacters) errors.push('deliveryNote is too long');
  errors.push(...validateItems(input.items));
  return errors;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateItems(items) {
  if (!Array.isArray(items)) return ['items must be an array'];
  const errors = [];
  if (items.length > rules.maxItemsPerOrder) errors.push('too many items');
  for (const item of items) {
    if (!isRecord(item) || typeof item.sku !== 'string') errors.push('item sku is required');
    if (isRecord(item) && !Number.isInteger(item.quantity)) errors.push('item quantity must be an integer');
  }
  return errors;
}

export function coerceDeliveryNote(input) {
  if (!isRecord(input) || input.deliveryNote === undefined) return input;
  return { ...input, deliveryNote: String(input.deliveryNote).trim() };
}
