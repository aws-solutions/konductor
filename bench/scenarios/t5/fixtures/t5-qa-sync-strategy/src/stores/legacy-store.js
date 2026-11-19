class LegacyStore {
  constructor(rows = []) { this.rows = rows; }
  async page(afterId = null, limit = 100) {
    const start = afterId === null ? 0 : this.rows.findIndex(row => row.id === afterId) + 1;
    return this.rows.slice(start, start + limit);
  }
  async count() { return this.rows.length; }
  async changesSince(cursor = 0) { return this.rows.filter(row => row.sequence > cursor); }
}

module.exports = { LegacyStore };
