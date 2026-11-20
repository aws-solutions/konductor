const { cleanText, isPresent } = require('./utils');

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'];

function hasAddressData(address) {
  if (!address) return false;
  return ADDRESS_KEYS.some(key => isPresent(key === 'postalCode' ? address.postalCode : address[key]));
}

function extractAddressValues(address) {
  const a = address || {};
  return ADDRESS_KEYS.map(key => {
    const value = key === 'postalCode' ? a.postalCode : a[key];
    return isPresent(value) ? cleanText(value) : null;
  });
}

function buildAddressObject(row) {
  if (!row) return null;
  if (!isPresent(row.line1) && !isPresent(row.line2) && !isPresent(row.city) && 
      !isPresent(row.region) && !isPresent(row.postal_code) && !isPresent(row.country)) {
    return null;
  }
  return {
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country
  };
}

function fetchAddressForCustomer(db, customerId) {
  return db.prepare('SELECT * FROM addresses WHERE customer_id = ?').get(customerId);
}

function buildCustomerWithAddress(customerRow, addressRow) {
  if (!customerRow) return null;
  const { ...customer } = customerRow;
  return { ...customer, address: buildAddressObject(addressRow) };
}

function createCustomer(db, input) {
  const name = cleanText(input.name);
  const email = cleanText(input.email);
  const status = cleanText(input.status) || 'active';
  
  const result = db.prepare('INSERT INTO customers (name, email, status) VALUES (?, ?, ?)').run(name, email, status);
  const customerId = Number(result.lastInsertRowid);
  
  if (hasAddressData(input.address)) {
    const [line1, line2, city, region, postalCode, country] = extractAddressValues(input.address);
    db.prepare(`
      INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(customerId, line1, line2, city, region, postalCode, country);
  }
  
  return getCustomer(db, customerId);
}

function getCustomer(db, id) {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!row) return null;
  const addressRow = fetchAddressForCustomer(db, id);
  return buildCustomerWithAddress(row, addressRow);
}

function listCustomers(db) {
  const customers = db.prepare('SELECT * FROM customers ORDER BY id').all();
  return customers.map(row => {
    const addressRow = fetchAddressForCustomer(db, row.id);
    return buildCustomerWithAddress(row, addressRow);
  });
}

function updateCustomer(db, id, input) {
  const current = getCustomer(db, id);
  if (!current) return null;
  
  const name = input.name === undefined ? current.name : cleanText(input.name);
  const email = input.email === undefined ? current.email : cleanText(input.email);
  const status = input.status === undefined ? current.status : cleanText(input.status);
  
  db.prepare('UPDATE customers SET name = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, email, status, id);
  
  if (input.address !== undefined) {
    const existingAddress = db.prepare('SELECT id FROM addresses WHERE customer_id = ?').get(id);
    
    if (hasAddressData(input.address)) {
      const [line1, line2, city, region, postalCode, country] = extractAddressValues(input.address);
      
      if (existingAddress) {
        db.prepare(`
          UPDATE addresses SET line1 = ?, line2 = ?, city = ?, region = ?, postal_code = ?, country = ? 
          WHERE customer_id = ?
        `).run(line1, line2, city, region, postalCode, country, id);
      } else {
        db.prepare(`
          INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, line1, line2, city, region, postalCode, country);
      }
    } else if (existingAddress) {
      // Clearing the address - remove the row
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
