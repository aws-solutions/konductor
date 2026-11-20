function up(db) { db.exec('ALTER TABLE customers ADD COLUMN archived_at TEXT'); }
function down(db) { db.exec('ALTER TABLE customers DROP COLUMN archived_at'); }
module.exports = { up, down };
