export function subtotal(lines) {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

export function taxFor(subtotalCents, rate) {
  return Math.round(subtotalCents * rate);
}

export function totalWithTax(subtotalCents, rate) {
  return subtotalCents + taxFor(subtotalCents, rate);
}
