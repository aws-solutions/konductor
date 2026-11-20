function up(db) { db.exec('ALTER TABLE customers ADD COLUMN phone TEXT'); }
function down(db) { db.exec('ALTER TABLE customers DROP COLUMN phone'); }
module.exports = { up, down };
