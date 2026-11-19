const { DbClient } = require('./db');

class ProductRepository {
  constructor(db = new DbClient()) { this.db = db; }
  async findAll() {
    const result = await this.db.query(
      'SELECT id, name, price_minor FROM products ORDER BY id'
    );
    return result.rows;
  }
}
module.exports = { ProductRepository };
