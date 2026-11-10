'use strict';

const { toOrderResponse } = require('../schema');
const { saveOrder, loadOrder, markCancelled } = require('../repo/store');

async function create(req, res) {
  const tenantId = req.get('x-tenant-id');
  if (!tenantId) return res.status(400).json({ code: 'TENANT_REQUIRED' });
  const order = await saveOrder({ tenantId, sku: req.body.sku, quantity: req.body.quantity, giftWrap: req.body.giftWrap });
  return res.status(201).json(toOrderResponse(order));
}

async function get(req, res) {
  const order = await loadOrder(req.params.id);
  if (!order) return res.status(404).json({ code: 'NOT_FOUND' });
  return res.json(toOrderResponse(order));
}

async function cancel(req, res) {
  const order = await markCancelled(req.params.id);
  if (typeof req.body.reason !== 'string' || req.body.reason.length > 200) {
    return res.status(400).json({ code: 'INVALID_REQUEST' });
  }
  return res.json(toOrderResponse(order));
}

module.exports = { create, get, cancel };
