import products from '../../data/catalog.json' with { type: 'json' };

const promotionTable = Object.freeze({
  SAVE15: Object.freeze({ code: 'SAVE15', kind: 'percent', value: 15, minimumSpendMinor: 1000, expiresOn: '2027-08-15' }),
  TAKE750: Object.freeze({ code: 'TAKE750', kind: 'fixed', value: 750, minimumSpendMinor: 100, expiresOn: '2027-12-31' }),
  SHIPDAY: Object.freeze({ code: 'SHIPDAY', kind: 'shipping', value: 0, minimumSpendMinor: 6000, expiresOn: '2027-10-31' })
});

export function productById(id) { return products.find((product) => product.id === id); }
export function allProducts() { return products.map((product) => ({ ...product })); }
export function findPromotion(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const entry = promotionTable[key];
  return entry ? { ...entry } : null;
}
export function promotionCatalogue() { return Object.values(promotionTable).map((entry) => ({ ...entry })); }
