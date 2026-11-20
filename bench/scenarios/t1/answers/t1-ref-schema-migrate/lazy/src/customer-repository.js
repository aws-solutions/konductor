const { cleanText, isPresent } = require('./utils');

const addressKeys = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'];

function mapAddress(row) {
  if (!row || !isPresent(row.address_line1) && !isPresent(row.address_line2) && !isPresent(row.address_city) && !isPresent(row.address_region) && !isPresent(row.address_postal_code) && !isPresent(row.address_country)) return null;
  return { line1: row.address_line1, line2: row.address_line2, city: row.address_city, region: row.address_region, postalCode: row.address_postal_code, country: row.address_country };
}

function mapCustomer(row) {
  if (!row) return null;
  const { address_line1, address_line2, address_city, address_region, address_postal_code, address_country, ...customer } = row;
  return { ...customer, address: mapAddress({ address_line1, address_line2, address_city, address_region, address_postal_code, address_country }) };
}

function addressValues(address) {
  const a = address || {};
  return addressKeys.map((key) => {
    const value = key === 'postalCode' ? a.postalCode : a[key];
    return isPresent(value) ? cleanText(value) : null;
  });
}

function createCustomer(db, input) {
  const result = db.prepare('INSERT INTO customers (name, email, status) VALUES (?, ?, ?)').run(cleanText(input.name), cleanText(input.email), cleanText(input.status) || 'active');
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE customers SET address_line1 = ?, address_line2 = ?, address_city = ?, address_region = ?, address_postal_code = ?, address_country = ? WHERE id = ?').run(...addressValues(input.address), id);
  return getCustomer(db, id);
}

function getCustomer(db, id) { return mapCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(id)); }
function listCustomers(db) { return db.prepare('SELECT * FROM customers ORDER BY id').all().map(mapCustomer); }

function updateCustomer(db, id, input) {
  const current = getCustomer(db, id);
  if (!current) return null;
  db.prepare('UPDATE customers SET name = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(input.name === undefined ? current.name : cleanText(input.name), input.email === undefined ? current.email : cleanText(input.email), input.status === undefined ? current.status : cleanText(input.status), id);
  if (input.address !== undefined) db.prepare('UPDATE customers SET address_line1 = ?, address_line2 = ?, address_city = ?, address_region = ?, address_postal_code = ?, address_country = ? WHERE id = ?').run(...addressValues(input.address), id);
  return getCustomer(db, id);
}

function deleteCustomer(db, id) {
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = { createCustomer, getCustomer, listCustomers, updateCustomer, deleteCustomer };
