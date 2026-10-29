'use strict';

const db = require('../db');

async function get(id) {
  const row = db.rows.find((r) => r.id === String(id));
  return row ? { ...row } : null;
}

async function list() {
  return db.rows.map((r) => ({ ...r }));
}

async function save(item) {
  const i = db.rows.findIndex((r) => r.id === item.id);
  if (i === -1) db.rows.push({ ...item });
  else db.rows[i] = { ...item };
  return { ...item };
}

async function searchByName(term) {
  return db.query('SELECT id, name, qty FROM items WHERE name LIKE ?', ['%' + term + '%']);
}

module.exports = { get, list, save, searchByName };
