'use strict';

const { BillingError } = require('./errors');

function handle(request, service) {
  try {
    if (!request || typeof request.method !== 'string') return { status: 400, body: { error: 'invalid request' } };
    if (request.method === 'POST' && request.path === '/invoices') return { status: 201, body: service.createInvoice(request.body) };
    if (request.method === 'POST' && request.path.startsWith('/invoices/') && request.path.endsWith('/collect')) {
      const id = request.path.split('/')[2];
      return { status: 200, body: service.collect(id, request.body || {}) };
    }
    if (request.method === 'GET' && request.path.startsWith('/invoices/')) {
      const invoice = service.repository.getInvoice(request.path.split('/')[2]);
      return invoice ? { status: 200, body: invoice } : { status: 404, body: { error: 'not found' } };
    }
    return { status: 404, body: { error: 'not found' } };
  } catch (error) {
    if (error instanceof BillingError) return { status: 422, body: { error: error.code, message: error.message } };
    return { status: 500, body: { error: 'internal_error' } };
  }
}

module.exports = { handle };
