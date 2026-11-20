'use strict';

// 2023 exporter, frozen (payments team). Two customers still call it through the old endpoint.
function legacyCsv(invoices) {
  return invoices.map((inv) => `${inv.id};${inv.customer};${inv.issuedAt.slice(0, 10)};${inv.amountCents}`).join('\n');
}

module.exports = { legacyCsv };
