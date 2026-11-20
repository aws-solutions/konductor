'use strict';

const { validateReceipt } = require('./validation');
const { parseUtc } = require('./shared/time');
const { ReceiptError } = require('./shared/errors');
const { toEnvelope } = require('./receipt-format');
const { renderPdfModel } = require('./pdf');

function createReceiptService({ store, delivery }) {
  if (!store || !delivery) throw new TypeError('store and delivery are required');
  return {
    create(input) {
      const valid = validateReceipt(input);
      const record = {
        ...valid,
        id: valid.id || `rcpt-${store.count() + 1}`,
        issuedAt: parseUtc(valid.issuedAt || new Date().toISOString()),
        currency: valid.currency || 'USD'
      };
      store.save(record);
      return record;
    },
    pdf(id) {
      const record = store.get(id);
      if (!record) throw new ReceiptError('RECEIPT_NOT_FOUND', 'receipt was not found', 404);
      return renderPdfModel(record);
    },
    envelope(id) {
      const record = store.get(id);
      if (!record) throw new ReceiptError('RECEIPT_NOT_FOUND', 'receipt was not found', 404);
      return toEnvelope(record);
    },
    send(id, destination) {
      return delivery.deliver(this.pdf(id), destination);
    }
  };
}

module.exports = { createReceiptService };
