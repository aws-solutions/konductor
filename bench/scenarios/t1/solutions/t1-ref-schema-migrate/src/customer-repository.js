const { cleanText, isPresent } = require('./utils');

const addressKeys = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'];

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function hasModernAddressTable(db) { return hasTable(db, 'addresses'); }

function mapAddress(row) {
  const values = [row.line1, row.line2, row.city, row.region, row.postal_code, row.country];
  if (!values.some(isPresent)) return null;
  return { line1: row.line1 ?? null, line2: row.line2 ?? null, city: row.city ?? null, region: row.region ?? null, postalCode: row.postal_code ?? null, country: row.country ?? null };
}

function mapCustomer(row, modern) {
  if (!row) return null;
  if (modern) {
    const { line1, line2, city, region, postal_code, country, ...customer } = row;
    return { ...customer, address: mapAddress({ line1, line2, city, region, postal_code, country }) };
  }
  const { address_line1, address_line2, address_city, address_region, address_postal_code, address_country, ...customer } = row;
  return { ...customer, address: mapAddress({ line1: address_line1, line2: address_line2, city: address_city, region: address_region, postal_code: address_postal_code, country: address_country }) };
}

function addressValues(address) {
  const a = address || {};
  return addressKeys.map((key) => {
    const value = key === 'postalCode' ? a.postalCode : a[key];
    return isPresent(value) ? cleanText(value) : null;
  });
}

function createCustomer(db, input) {
  const modern = hasModernAddressTable(db);
  const result = db.prepare('INSERT INTO customers (name, email, status) VALUES (?, ?, ?)').run(cleanText(input.name), cleanText(input.email), cleanText(input.status) || 'active');
  const id = Number(result.lastInsertRowid);
  const values = addressValues(input.address);
  if (modern) {
    if (values.some(isPresent)) db.prepare('INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ...values);
  } else {
    db.prepare('UPDATE customers SET address_line1 = ?, address_line2 = ?, address_city = ?, address_region = ?, address_postal_code = ?, address_country = ? WHERE id = ?').run(...values, id);
  }
  return getCustomer(db, id);
}

function getCustomer(db, id) {
  const modern = hasModernAddressTable(db);
  const sql = modern
    ? 'SELECT c.*, a.line1, a.line2, a.city, a.region, a.postal_code, a.country FROM customers c LEFT JOIN addresses a ON a.customer_id = c.id WHERE c.id = ?'
    : 'SELECT * FROM customers WHERE id = ?';
  return mapCustomer(db.prepare(sql).get(id), modern);
}

function listCustomers(db) {
  const modern = hasModernAddressTable(db);
  const sql = modern
    ? 'SELECT c.*, a.line1, a.line2, a.city, a.region, a.postal_code, a.country FROM customers c LEFT JOIN addresses a ON a.customer_id = c.id ORDER BY c.id'
    : 'SELECT * FROM customers ORDER BY id';
  return db.prepare(sql).all().map((row) => mapCustomer(row, modern));
}

function updateCustomer(db, id, input) {
  const current = getCustomer(db, id);
  if (!current) return null;
  if (input.name !== undefined || input.email !== undefined || input.status !== undefined) {
    db.prepare('UPDATE customers SET name = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(input.name === undefined ? current.name : cleanText(input.name), input.email === undefined ? current.email : cleanText(input.email), input.status === undefined ? current.status : cleanText(input.status), id);
  }
  if (input.address !== undefined) {
    const values = addressValues(input.address);
    if (hasModernAddressTable(db)) {
      db.prepare('DELETE FROM addresses WHERE customer_id = ?').run(id);
      if (values.some(isPresent)) db.prepare('INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ...values);
    } else {
      db.prepare('UPDATE customers SET address_line1 = ?, address_line2 = ?, address_city = ?, address_region = ?, address_postal_code = ?, address_country = ? WHERE id = ?').run(...values, id);
    }
  }
  return getCustomer(db, id);
}

function deleteCustomer(db, id) {
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = { createCustomer, getCustomer, listCustomers, updateCustomer, deleteCustomer, hasModernAddressTable };
