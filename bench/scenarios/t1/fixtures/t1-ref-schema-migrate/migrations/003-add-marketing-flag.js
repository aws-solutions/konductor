function up(db) { db.exec('ALTER TABLE customers ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0'); }
function down(db) { db.exec('ALTER TABLE customers DROP COLUMN marketing_opt_in'); }
module.exports = { up, down };
