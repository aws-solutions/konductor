const router = require('express').Router();
const db = require('../db');

router.delete('/users/:id', async (req, res) => {
  if (req.headers['x-role'] !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  await db.deleteUser(req.params.id);
  res.status(204).end();
});

module.exports = router;
