const seen = new Set<string>();
export function firstDelivery(id: string) {
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}
export function clearDeliveries() { seen.clear(); }
