export function findProduct(products, id) {
  return products.find((product) => product.id === id) ?? null;
}

export function availableCategories(products) {
  return [...new Set(products.map((product) => product.category))].sort();
}
