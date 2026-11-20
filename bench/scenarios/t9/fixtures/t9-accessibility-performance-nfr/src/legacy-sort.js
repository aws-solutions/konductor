// Column sorting from the first version of the page. The header links were
// removed when the table became fixed-order, nothing imports this now.
export function sortOrders(orders, key, direction = 'asc') {
  const sign = direction === 'asc' ? 1 : -1;
  return [...orders].sort((a, b) => {
    if (a[key] < b[key]) return -1 * sign;
    if (a[key] > b[key]) return 1 * sign;
    return 0;
  });
}
