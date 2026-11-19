function up(db) { db.exec('CREATE TABLE customer_notes (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(customer_id) REFERENCES customers(id))'); }
function down(db) { db.exec('DROP TABLE IF EXISTS customer_notes'); }
module.exports = { up, down };
