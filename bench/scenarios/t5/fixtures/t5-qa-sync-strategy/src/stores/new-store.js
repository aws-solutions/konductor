class NewStore {
  constructor() { this.rows = new Map(); }
  async upsert(row) { this.rows.set(row.id, { ...row }); return row; }
  async get(id) { return this.rows.get(id) || null; }
  async count() { return this.rows.size; }
  async all() { return [...this.rows.values()]; }
}

module.exports = { NewStore };
