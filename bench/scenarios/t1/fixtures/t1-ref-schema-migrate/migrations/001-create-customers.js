function up(db) {
  db.exec(`CREATE TABLE customers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
    address_line1 TEXT, address_line2 TEXT, address_city TEXT, address_region TEXT, address_postal_code TEXT, address_country TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}
function down(db) { db.exec('DROP TABLE IF EXISTS customers'); }
module.exports = { up, down };
