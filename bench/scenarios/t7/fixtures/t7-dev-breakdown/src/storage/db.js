class DbClient {
  async query(_sql, _params = []) { return { rows: [] }; }
}
module.exports = { DbClient };
