const { Pool } = require('pg');
const pool = new Pool();
module.exports = {
  query: (sql) => pool.query(sql).then((r) => r.rows),
  getUser: (id) => pool.query('SELECT * FROM users WHERE id = $1', [id]).then((r) => r.rows[0]),
  findUserByEmail: (email) => pool.query('SELECT * FROM users WHERE email = $1', [email]).then((r) => r.rows[0]),
  deleteUser: (id) => pool.query('DELETE FROM users WHERE id = $1', [id]),
};
