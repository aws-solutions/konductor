'use strict';

class TaxAdapter {
  constructor(client) { this.client = client; }
  quote({ customer, amountCents, currency = 'USD' }) {
    const result = this.client.getQuote({ country: customer.country, postalCode: customer.postalCode, amountCents, currency });
    return { amountCents: result.taxCents || 0, jurisdiction: result.jurisdiction || null };
  }
}
module.exports = { TaxAdapter };
