'use strict';

const service = require('../services/inventoryService');
const config = require('../config');

function isAdmin(req) {
  return Boolean(req.headers) && req.headers['x-admin-token'] === config.adminToken;
}

async function getItem(req) {
  const id = req.params.id;
  if (!id) return { status: 400, body: { error: 'id required' } };
  const item = await service.getItem(id);
  if (!item) return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: { id: item.id, name: item.name, qty: item.qty } };
}

async function createItem(req) {
  if (!isAdmin(req)) return { status: 403, body: { error: 'forbidden' } };
  const item = await service.createItem(req.body);
  return { status: 201, body: item };
}

async function adjustStock(req) {
  const delta = Number(req.body.delta);
  const item = await service.adjustStock(req.params.id, delta);
  if (!item) return { status: 404, body: { error: 'not found' } };
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
