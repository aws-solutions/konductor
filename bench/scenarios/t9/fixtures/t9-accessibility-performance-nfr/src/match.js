// Text matching for the order list. Search is accent-insensitive and
// case-insensitive, and every word the user types has to be found somewhere in
// the order (id, customer, city or an item name).

// Letters that Unicode does not split into base letter + mark.
const SPECIAL = { 'ø': 'o', 'ł': 'l', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd' };

export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[øłßæœđ]/g, (ch) => SPECIAL[ch]);
}

export function searchableText(order) {
  const parts = [order.id, order.customer, order.city];
  for (const item of order.items || []) parts.push(item.name);
  return fold(parts.join(' '));
}

export function matchesQuery(order, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = searchableText(order);
  return words.every((word) => haystack.includes(word));
}
