const { cleanText, isPresent } = require('./utils');

const addressKeys = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'];

function mapAddress(row) {
  if (!row || !isPresent(row.line1) && !isPresent(row.line2) && !isPresent(row.city) && !isPresent(row.region) && !isPresent(row.postal_code) && !isPresent(row.country)) return null;
  return { line1: row.line1, line2: row.line2, city: row.city, region: row.region, postalCode: row.postal_code, country: row.country };
}

function mapCustomer(row, db) {
  if (!row) return null;
  const customer = { ...row };
  delete customer.address_line1;
  delete customer.address_line2;
  delete customer.address_city;
  delete customer.address_region;
  delete customer.address_postal_code;
  delete customer.address_country;
  const addrRow = db ? db.prepare('SELECT * FROM addresses WHERE customer_id = ?').get(row.id) : null;
  return { ...customer, address: mapAddress(addrRow) };
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
  const [line1, line2, city, region, postalCode, country] = addressValues(input.address);
  if (line1 || line2 || city || region || postalCode || country) {
    db.prepare('INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, line1, line2, city, region, postalCode, country);
  }
  return getCustomer(db, id);
}

function getCustomer(db, id) { 
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  return mapCustomer(row, db); 
}

function listCustomers(db) { 
  return db.prepare('SELECT * FROM customers ORDER BY id').all().map(row => mapCustomer(row, db)); 
}

function updateCustomer(db, id, input) {
  const current = getCustomer(db, id);
  if (!current) return null;
  db.prepare('UPDATE customers SET name = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    input.name === undefined ? current.name : cleanText(input.name), 
    input.email === undefined ? current.email : cleanText(input.email), 
    input.status === undefined ? current.status : cleanText(input.status), 
    id
  );
  if (input.address !== undefined) {
    const [line1, line2, city, region, postalCode, country] = addressValues(input.address);
    const existing = db.prepare('SELECT id FROM addresses WHERE customer_id = ?').get(id);
    if (line1 || line2 || city || region || postalCode || country) {
      if (existing) {
        db.prepare('UPDATE addresses SET line1 = ?, line2 = ?, city = ?, region = ?, postal_code = ?, country = ? WHERE customer_id = ?').run(line1, line2, city, region, postalCode, country, id);
      } else {
        db.prepare('INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, line1, line2, city, region, postalCode, country);
      }
    } else if (existing) {
      db.prepare('DELETE FROM addresses WHERE customer_id = ?').run(id);
    }
  }
  return getCustomer(db, id);
}

function deleteCustomer(db, id) {
  db.prepare('DELETE FROM addresses WHERE customer_id = ?').run(id);
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = { createCustomer, getCustomer, listCustomers, updateCustomer, deleteCustomer };
