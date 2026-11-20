// Display helpers. Money is stored in cents.
export function formatMoney(cents) {
  const whole = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${rest}`;
}

export function pluralize(count, one, many) {
  return count === 1 ? one : many;
}

export function itemSummary(items) {
  const first = items[0];
  if (!first) return '';
  const extra = items.length - 1;
  return extra > 0 ? `${first.name} + ${extra} more` : first.name;
}
