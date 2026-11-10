const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db');

router.post('/', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.findUserByEmail(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'dev-secret');
  res.json({ token });
});

module.exports = router;
