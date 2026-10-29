'use strict';

const service = require('../services/inventoryService');
const { getQty } = require('../util/format');
const config = require('../config');

function isAdmin(req) {
  return Boolean(req.headers) && req.headers['x-admin-token'] === config.adminToken;
}

function bad(message) {
  return { status: 400, body: { error: message } };
}

async function getItem(req) {
  const id = req.params.id;
  if (!id) return { status: 400, body: { error: 'id required' } };
  const item = await service.getItem(id);
  if (!item) return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: { id: item.id, name: item.name, qty: getQty(item) } };
}

async function createItem(req) {
  if (!isAdmin(req)) return { status: 403, body: { error: 'forbidden' } };
  const { name, qty } = req.body || {};
  if (typeof name !== 'string' || name.trim() === '' || name.length > 100) {
    return bad('name must be a non-empty string of at most 100 characters');
  }
  if (!Number.isInteger(qty) || qty < 0) return bad('qty must be a non-negative integer');
  const item = await service.createItem({ name, qty });
  return { status: 201, body: item };
}

async function adjustStock(req) {
  const delta = req.body && req.body.delta;
  if (!Number.isInteger(delta)) return bad('delta must be an integer');
  const current = await service.getItem(req.params.id);
  if (!current) return { status: 404, body: { error: 'not found' } };
  if (current.qty + delta < 0) return bad('stock cannot go below zero');
  const item = await service.adjustStock(req.params.id, delta);
  return { status: 200, body: item };
}

async function search(req) {
  const results = await service.search(req.query.q || '');
  return { status: 200, body: results };
}

async function reorderReport() {
  return { status: 200, body: await service.reorderReport() };
}

module.exports = { getItem, createItem, adjustStock, search, reorderReport };
