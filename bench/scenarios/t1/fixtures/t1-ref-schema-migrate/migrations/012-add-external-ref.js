function up(db) { db.exec('ALTER TABLE customers ADD COLUMN external_ref TEXT'); }
function down(db) { db.exec('ALTER TABLE customers DROP COLUMN external_ref'); }
module.exports = { up, down };
