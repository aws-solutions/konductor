import products from '../../data/catalog.json' with { type: 'json' };

const codes = [
  { code: 'SAVE15', kind: 'percent', value: 15, minimumSpendMinor: 1000, expiresOn: '2027-08-15' },
  { code: 'TAKE750', kind: 'fixed', value: 750, minimumSpendMinor: 100, expiresOn: '2027-12-31' },
  { code: 'SHIPDAY', kind: 'shipping', value: 0, minimumSpendMinor: 6000, expiresOn: '2027-10-31' }
];
export function productById(id) { return products.find((product) => product.id === id); }
export function allProducts() { return products.map((product) => ({ ...product })); }
export function findPromotion(code) { return codes.find((entry) => entry.code === code); }
export function promotionCatalogue() { return codes.map((entry) => ({ ...entry })); }
