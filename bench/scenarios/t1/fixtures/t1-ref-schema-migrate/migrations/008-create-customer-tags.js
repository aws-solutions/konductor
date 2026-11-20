function up(db) { db.exec('CREATE TABLE customer_tags (customer_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(customer_id, tag), FOREIGN KEY(customer_id) REFERENCES customers(id))'); }
function down(db) { db.exec('DROP TABLE IF EXISTS customer_tags'); }
module.exports = { up, down };
