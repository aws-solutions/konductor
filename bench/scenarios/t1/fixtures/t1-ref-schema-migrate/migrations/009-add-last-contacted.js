function up(db) { db.exec('ALTER TABLE customers ADD COLUMN last_contacted_at TEXT'); }
function down(db) { db.exec('ALTER TABLE customers DROP COLUMN last_contacted_at'); }
module.exports = { up, down };
