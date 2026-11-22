import { findProduct, listProducts, saveProduct } from '../store/product-store.js';
import { normalizeCreateBody, normalizeStoredProduct } from './normalizers.js';
import { publishProductChanged } from '../events/product-changed.js';

function toResponse(product) {
  return {
    id: product.id,
    label: product.name,
    subtitle: product.subtitle,
    status: product.status,
    priceCents: product.priceCents,
    labels: product.labels,
    attributes: product.attributes,
    updatedAt: product.updatedAt,
    warehouseNote: product.warehouseNote ?? ''
  };
}

export async function getProduct(id) {
  const product = await findProduct(id);
  return product ? toResponse(normalizeStoredProduct(product)) : null;
}

export async function getProducts() {
  const products = await listProducts();
  return products.map((product) => toResponse(normalizeStoredProduct(product)));
}

export async function createProduct(body) {
  const product = normalizeCreateBody(body);
  await saveProduct(product);
  await publishProductChanged(product);
  return toResponse(product);
}
