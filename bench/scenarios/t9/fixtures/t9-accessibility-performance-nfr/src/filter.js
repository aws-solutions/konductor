import { matchesQuery } from './match.js';
import { parseDate } from './dates.js';

// Applies every control of the page to the order list. Dates are inclusive on
// both ends. Text that is not a real date matches nothing.
export function filterOrders(orders, { query = '', status = 'all', from = '', to = '' } = {}) {
  const fromStamp = from.trim() ? parseDate(from) : null;
  const toStamp = to.trim() ? parseDate(to) : null;
  if ((from.trim() && fromStamp === null) || (to.trim() && toStamp === null)) return [];
  return orders.filter((order) => {
    if (status !== 'all' && order.status !== status) return false;
    if (fromStamp !== null || toStamp !== null) {
      const placed = parseDate(order.date);
      if (fromStamp !== null && placed < fromStamp) return false;
      if (toStamp !== null && placed > toStamp) return false;
    }
    return matchesQuery(order, query);
  });
}
