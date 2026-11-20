function up(db) { db.exec('CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)'); }
function down(db) { db.exec('DROP INDEX IF EXISTS idx_customers_email'); }
module.exports = { up, down };
