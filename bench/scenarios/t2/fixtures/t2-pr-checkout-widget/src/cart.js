export function addLine(lines, productId, quantity = 1) {
  const existing = lines.find((line) => line.productId === productId);
  if (existing) {
    return lines.map((line) => line.productId === productId
      ? { ...line, quantity: line.quantity + quantity }
      : line);
  }
  return [...lines, { productId, quantity }];
}

export function removeLine(lines, productId) {
  return lines.filter((line) => line.productId !== productId);
}

export function getCartTotal(lines, products) {
  return lines.reduce((total, line) => {
    const product = products.find((entry) => entry.id === line.productId);
    return total + (product?.priceCents ?? 0) * line.quantity;
  }, 0);
}
