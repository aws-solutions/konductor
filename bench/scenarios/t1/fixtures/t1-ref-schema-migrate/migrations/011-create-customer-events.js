function up(db) { db.exec('CREATE TABLE customer_events (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(customer_id) REFERENCES customers(id))'); }
function down(db) { db.exec('DROP TABLE IF EXISTS customer_events'); }
module.exports = { up, down };
