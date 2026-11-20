function up(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL UNIQUE,
    line1 TEXT, line2 TEXT, city TEXT, region TEXT, postal_code TEXT, country TEXT
  )`);
  const rows = db.prepare('SELECT id, address_line1, address_line2, address_city, address_region, address_postal_code, address_country FROM customers').all();
  for (const row of rows) {
    if (row.address_line1 || row.address_line2 || row.address_city || row.address_region || row.address_postal_code || row.address_country) {
      db.prepare('INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        row.id, row.address_line1, row.address_line2, row.address_city, row.address_region, row.address_postal_code, row.address_country
      );
    }
  }
  db.exec('ALTER TABLE customers DROP COLUMN address_line1');
  db.exec('ALTER TABLE customers DROP COLUMN address_line2');
  db.exec('ALTER TABLE customers DROP COLUMN address_city');
  db.exec('ALTER TABLE customers DROP COLUMN address_region');
  db.exec('ALTER TABLE customers DROP COLUMN address_postal_code');
  db.exec('ALTER TABLE customers DROP COLUMN address_country');
}

function down(db) {
  db.exec('ALTER TABLE customers ADD COLUMN address_line1 TEXT');
  db.exec('ALTER TABLE customers ADD COLUMN address_line2 TEXT');
  db.exec('ALTER TABLE customers ADD COLUMN address_city TEXT');
  db.exec('ALTER TABLE customers ADD COLUMN address_region TEXT');
  db.exec('ALTER TABLE customers ADD COLUMN address_postal_code TEXT');
  db.exec('ALTER TABLE customers ADD COLUMN address_country TEXT');
  const addresses = db.prepare('SELECT * FROM addresses').all();
  for (const a of addresses) {
    db.prepare('UPDATE customers SET address_line1 = ?, address_line2 = ?, address_city = ?, address_region = ?, address_postal_code = ?, address_country = ? WHERE id = ?').run(
      a.line1, a.line2, a.city, a.region, a.postal_code, a.country, a.customer_id
    );
  }
  db.exec('DROP TABLE IF EXISTS addresses');
}

module.exports = { up, down };
