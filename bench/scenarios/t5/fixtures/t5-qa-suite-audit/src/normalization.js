'use strict';

function customerKey(value) { return String(value || '').trim().toLowerCase(); }
function compactInvoice(invoice) { return { id: invoice.id, customerId: customerKey(invoice.customerId), totalCents: invoice.totalCents, status: invoice.status }; }
module.exports = { customerKey, compactInvoice };
