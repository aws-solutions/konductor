const { ProductRepository } = require('../storage/product-repository');
const { ProductCache } = require('../cache/product-cache');
const { serializeProduct } = require('../http/serializers/product');

const repository = new ProductRepository();
const cache = new ProductCache();

async function getProducts() {
  const products = await repository.findAll();
  return products.map((product) => {
    const old = cache.get(product.id);
    if (old) return serializeProduct(old);
    cache.put(product.id, product);
    return serializeProduct(product);
  });
}
module.exports = { getProducts };
