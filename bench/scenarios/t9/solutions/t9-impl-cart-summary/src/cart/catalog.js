import products from '../../data/catalog.json' with { type: 'json' };

const promotions = [
  { code: 'SAVE15', kind: 'percent', percent: 15, minimumSpendMinor: 1000, expiresOn: '2027-08-15' },
  { code: 'TAKE750', kind: 'fixed', amountMinor: 750, minimumSpendMinor: 100, expiresOn: '2027-12-31' },
  { code: 'SHIPDAY', kind: 'free-shipping', minimumSpendMinor: 6000, expiresOn: '2027-10-31' }
];

export function productById(id) {
  return products.find((product) => product.id === id);
}

export function allProducts() {
  return products.map((product) => ({ ...product }));
}

export function findPromotion(code) {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return promotions.find((promotion) => promotion.code === normalized);
}

export function promotionCatalogue() {
  return promotions.map((promotion) => ({ ...promotion }));
}
