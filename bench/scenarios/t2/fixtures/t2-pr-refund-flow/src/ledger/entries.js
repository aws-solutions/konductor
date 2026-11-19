export const entryTypes = Object.freeze({
  capture: 'capture',
  payout: 'payout',
  refund: 'refund'
});

export function isKnownEntryType(type) {
  return Object.hasOwn(entryTypes, type);
}
