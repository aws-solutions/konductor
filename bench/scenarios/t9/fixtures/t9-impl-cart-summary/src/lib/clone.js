export function shallowRecord(value) {
  return value && typeof value === 'object' ? { ...value } : value;
}
