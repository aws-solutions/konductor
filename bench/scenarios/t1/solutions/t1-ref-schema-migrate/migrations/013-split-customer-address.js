function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function up(db) {
  if (tableExists(db, 'addresses')) return;

  db.exec(`CREATE TABLE addresses (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL UNIQUE,
    line1 TEXT,
    line2 TEXT,
    city TEXT,
    region TEXT,
    postal_code TEXT,
    country TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  )`);

  db.exec(`INSERT INTO addresses (customer_id, line1, line2, city, region, postal_code, country)
    SELECT id, NULLIF(TRIM(address_line1), ''), NULLIF(TRIM(address_line2), ''),
      NULLIF(TRIM(address_city), ''), NULLIF(TRIM(address_region), ''),
      NULLIF(TRIM(address_postal_code), ''), NULLIF(TRIM(address_country), '')
    FROM customers
    WHERE NULLIF(TRIM(COALESCE(address_line1, '')), '') IS NOT NULL
       OR NULLIF(TRIM(COALESCE(address_line2, '')), '') IS NOT NULL
       OR NULLIF(TRIM(COALESCE(address_city, '')), '') IS NOT NULL
       OR NULLIF(TRIM(COALESCE(address_region, '')), '') IS NOT NULL
       OR NULLIF(TRIM(COALESCE(address_postal_code, '')), '') IS NOT NULL
       OR NULLIF(TRIM(COALESCE(address_country, '')), '') IS NOT NULL`);

  for (const column of ['address_line1', 'address_line2', 'address_city', 'address_region', 'address_postal_code', 'address_country']) {
    db.exec(`ALTER TABLE customers DROP COLUMN ${column}`);
  }
}

function down(db) {
  if (!tableExists(db, 'addresses')) return;

  for (const column of ['address_line1', 'address_line2', 'address_city', 'address_region', 'address_postal_code', 'address_country']) {
    db.exec(`ALTER TABLE customers ADD COLUMN ${column} TEXT`);
  }

  db.exec(`UPDATE customers SET
    address_line1 = (SELECT line1 FROM addresses WHERE addresses.customer_id = customers.id),
    address_line2 = (SELECT line2 FROM addresses WHERE addresses.customer_id = customers.id),
    address_city = (SELECT city FROM addresses WHERE addresses.customer_id = customers.id),
    address_region = (SELECT region FROM addresses WHERE addresses.customer_id = customers.id),
    address_postal_code = (SELECT postal_code FROM addresses WHERE addresses.customer_id = customers.id),
    address_country = (SELECT country FROM addresses WHERE addresses.customer_id = customers.id)`);

  db.exec('DROP TABLE addresses');
}

module.exports = { up, down };
