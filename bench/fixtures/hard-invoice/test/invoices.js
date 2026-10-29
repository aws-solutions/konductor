'use strict';

const basic = {
  number: 'INV-1001',
  customer: { name: 'Northwind Traders', country: 'DE', vatId: 'DE123456789' },
  currency: 'USD',
  issuedAt: '2025-03-14T09:30:00Z',
  lines: [
    { sku: 'B-200', description: 'Standing desk frame', qty: 2, unitPrice: 349.5 },
    { sku: 'A-100', description: 'Cable tray', qty: 10, unitPrice: 4.25 },
  ],
  shipping: 15,
  notes: 'Payment due within 30 days of the invoice date. Late payments accrue interest.',
};

const discounted = {
  number: 'INV-1002',
  customer: { name: 'Contoso Ltd', country: 'GB' },
  currency: 'GBP',
  issuedAt: '2025-12-01T00:00:00Z',
  lines: [
    { sku: 'S-1', description: 'Support plan, annual, premium tier with extended hours', qty: 1, unitPrice: 1200, discountPct: 12.5 },
    { sku: 'S-2', description: 'Training day', qty: 3, unitPrice: 450, taxable: false },
  ],
};

const yen = {
  number: 'INV-1003',
  customer: { name: 'Tokyo Parts KK', country: 'JP' },
  currency: 'JPY',
  issuedAt: '2025-01-31T23:59:59Z',
  lines: [{ sku: 'P-9', description: 'Bearing', qty: 12, unitPrice: 1480 }],
  shipping: 800,
};

const credit = {
  number: 'CN-77',
  customer: { name: 'Fabrikam' },
  currency: 'USD',
  issuedAt: '2025-06-30T12:00:00Z',
  lines: [{ sku: 'R-1', description: 'Returned adapter', qty: -3, unitPrice: 2.5 }],
};

module.exports = { basic, discounted, yen, credit };
