function up(db) { db.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'); }
function down(db) { db.exec('DROP TABLE IF EXISTS audit_log'); }
module.exports = { up, down };
