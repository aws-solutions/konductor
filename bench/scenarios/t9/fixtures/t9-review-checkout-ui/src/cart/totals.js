export function calculateSubtotal(items) {
  return items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}

export function calculateTax(subtotal, rate = 0.0825) { return subtotal * rate; }
export function calculateTotal(items, rate = 0.0825) { return calculateSubtotal(items) + calculateTax(calculateSubtotal(items), rate); }
export function formatMoney(amount, currency = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount); }
