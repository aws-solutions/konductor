import products from '../../data/catalog.json' with { type: 'json' };

export function productById(id) {
  return products.find((product) => product.id === id);
}

export function allProducts() {
  return products.map((product) => ({ ...product }));
}
