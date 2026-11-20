// The basket the checkout page opens with. The real shop loads this from the
// basket service; the static demo build ships a fixed copy.

export const STARTING_BASKET = [
  { sku: 'TEA-ASSAM-250', name: 'Assam breakfast tea, 250 g', unitPence: 850, quantity: 2 },
  { sku: 'TEA-SENCHA-100', name: 'Sencha green tea, 100 g', unitPence: 1200, quantity: 1 },
  { sku: 'POT-GLASS-600', name: 'Glass teapot, 600 ml', unitPence: 1999, quantity: 1 },
];

export const MAX_QUANTITY = 9;
