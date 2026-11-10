const router = require('express').Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const q = req.query.q || '';
  const rows = await db.query("SELECT id, title FROM notes WHERE owner_id = " + req.user.id + " AND title LIKE '%" + q + "%'");
  res.json(rows);
});

module.exports = router;
