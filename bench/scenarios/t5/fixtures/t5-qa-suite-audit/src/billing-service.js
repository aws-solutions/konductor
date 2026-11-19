'use strict';

const { makeInvoice, previewPlanChange } = require('./invoices');
const { getPlan } = require('./plans');
const { recordFailure } = require('./dunning');
const { postEntry } = require('./ledger');

class BillingService {
  constructor({ repository, paymentGateway, idFactory = () => `inv_${Date.now()}` }) {
    this.repository = repository;
    this.paymentGateway = paymentGateway;
    this.idFactory = idFactory;
  }

  createInvoice(input) {
    const invoice = makeInvoice({ ...input, id: input.id || this.idFactory() });
    this.repository.saveInvoice(invoice);
    return invoice;
  }

  changePlan(input) {
    const preview = previewPlanChange(input);
    const invoice = this.repository.getInvoice(input.invoiceId);
    if (invoice) this.repository.saveInvoice({ ...invoice, proration: preview, totalCents: invoice.totalCents + preview.amountCents });
    return preview;
  }

  collect(invoiceId, paymentDetails) {
    const invoice = this.repository.getInvoice(invoiceId);
    if (!invoice) throw new Error('invoice not found');
    const result = this.paymentGateway.charge({ invoiceId, amountCents: invoice.totalCents, ...paymentDetails });
    if (result.status === 'succeeded') {
      const paid = { ...invoice, status: 'paid', paidAt: new Date().toISOString() };
      this.repository.saveInvoice(paid);
      postEntry(this.repository, { reference: invoice.id, account: 'cash', amountCents: invoice.totalCents, direction: 'credit' });
      return paid;
    }
    const failed = recordFailure(invoice, result);
    this.repository.saveInvoice(failed);
    return failed;
  }
}

module.exports = { BillingService, getPlan };
