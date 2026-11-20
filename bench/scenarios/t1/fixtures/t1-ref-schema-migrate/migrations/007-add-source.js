function up(db) { db.exec("ALTER TABLE customers ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'"); }
function down(db) { db.exec('ALTER TABLE customers DROP COLUMN source'); }
module.exports = { up, down };
