let sequence = 0;
export function nextId(prefix = 'evt') {
  sequence += 1;
  return `${prefix}_${Date.now()}_${sequence}`;
}
