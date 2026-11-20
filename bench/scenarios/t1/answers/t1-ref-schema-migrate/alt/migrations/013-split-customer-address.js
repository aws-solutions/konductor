const { isPresent } = require('../src/utils');

function hasAnyAddressField(row) {
  return isPresent(row.address_line1) || isPresent(row.address_line2) || 
         isPresent(row.address_city) || isPresent(row.address_region) || 
         isPresent(row.address_postal_code) || isPresent(row.address_country);
}

function up(db) {
  // Check if addresses table already exists (idempotent)
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addresses'").get();
  if (tableExists) return;
  
  // Create the addresses table
  db.exec(`CREATE TABLE addresses (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL UNIQUE,
    line1 TEXT,
    line2 TEXT,
    city TEXT,
    region TEXT,
    postal_code TEXT,
    country TEXT
  )`);
  
  // Migrate existing address data from customers to addresses
  const customers = db.prepare(`
    SELECT id, address_line1, address_line2, address_city, address_region, address_postal_code, address_country 
    FROM customers
  `).all();
  
  const insertAddress = db.prepare(`
    INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const customer of customers) {
    if (hasAnyAddressField(customer)) {
      insertAddress.run(
        customer.id,
        isPresent(customer.address_line1) ? customer.address_line1 : null,
        isPresent(customer.address_line2) ? customer.address_line2 : null,
        isPresent(customer.address_city) ? customer.address_city : null,
        isPresent(customer.address_region) ? customer.address_region : null,
        isPresent(customer.address_postal_code) ? customer.address_postal_code : null,
        isPresent(customer.address_country) ? customer.address_country : null
      );
    }
  }
  
  // Remove the legacy address columns from customers
  db.exec('ALTER TABLE customers DROP COLUMN address_line1');
  db.exec('ALTER TABLE customers DROP COLUMN address_line2');
  db.exec('ALTER TABLE customers DROP COLUMN address_city');
  db.exec('ALTER TABLE customers DROP COLUMN address_region');
  db.exec('ALTER TABLE customers DROP COLUMN address_postal_code');
  db.exec('ALTER TABLE customers DROP COLUMN address_country');
}

function down(db) {
  // Check if addresses table exists (idempotent)
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addresses'").get();
  if (!tableExists) return;
  
  // Check if legacy columns already exist
  const tableInfo = db.prepare('PRAGMA table_info(customers)').all();
  const columnNames = tableInfo.map(col => col.name);
  
  // Add back the legacy address columns if they don't exist
  if (!columnNames.includes('address_line1')) {
    db.exec('ALTER TABLE customers ADD COLUMN address_line1 TEXT');
  }
  if (!columnNames.includes('address_line2')) {
    db.exec('ALTER TABLE customers ADD COLUMN address_line2 TEXT');
  }
  if (!columnNames.includes('address_city')) {
    db.exec('ALTER TABLE customers ADD COLUMN address_city TEXT');
  }
  if (!columnNames.includes('address_region')) {
    db.exec('ALTER TABLE customers ADD COLUMN address_region TEXT');
  }
  if (!columnNames.includes('address_postal_code')) {
    db.exec('ALTER TABLE customers ADD COLUMN address_postal_code TEXT');
  }
  if (!columnNames.includes('address_country')) {
    db.exec('ALTER TABLE customers ADD COLUMN address_country TEXT');
  }
  
  // Restore address data from addresses table back to customers
  const addresses = db.prepare('SELECT * FROM addresses').all();
  const updateCustomer = db.prepare(`
    UPDATE customers SET 
      address_line1 = ?, 
      address_line2 = ?, 
      address_city = ?, 
      address_region = ?, 
      address_postal_code = ?, 
      address_country = ? 
    WHERE id = ?
  `);
  
  for (const addr of addresses) {
    updateCustomer.run(
      addr.line1, addr.line2, addr.city, addr.region, addr.postal_code, addr.country, addr.customer_id
    );
  }
  
  // Drop the addresses table
  db.exec('DROP TABLE IF EXISTS addresses');
}

module.exports = { up, down };
