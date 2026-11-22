import { getProduct } from '../src/catalog/product-service.js';

const product = await getProduct('p-100');
if (!product) throw new Error('sample product is missing');
console.log(`${product.id}: ${product.displayName}`);
